using Aidan.Core.Errors;
using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Telemetry;

namespace Speculum.Api.Sessions.Services;

internal sealed partial class LiveSession
{
    // ── Commands ─────────────────────────────────────────────────────────────

    public async Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result<SessionStatus>.Failure("Live session is released");
        }

        var status = await _connection.GetStatusAsync(ct).ConfigureAwait(false);
        if (status.IsFailure)
        {
            return status;
        }

        var current = status.Value;
        var url = current.Url;
        return Result<SessionStatus>.Success(new SessionStatus
        {
            TabCount = current.TabCount,
            Url = url,
            Resizing = current.Resizing,
            Width = current.Width,
            Height = current.Height,
            DisplayWidth = current.DisplayWidth,
            DisplayHeight = current.DisplayHeight,
            ChromeWidth = current.ChromeWidth,
            ChromeHeight = current.ChromeHeight,
            Fps = current.Fps,
            UptimeMs = Math.Max(1, Environment.TickCount64 - _startedTimestamp),
            SessionId = SessionId.ToString("D"),
            JsBridgeEnabled = _jsBridgeEnabled,
            Editing = current.Editing,
        });
    }

    public Task<IResult<NavigateResult>> NavigateAsync(NavigateSession request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithCommandGateAsync<NavigateResult>(
            async () =>
            {
                var path = request.Path ?? string.Empty;
                var query = request.Query ?? string.Empty;
                try
                {
                    _liveEvents.NavigateRequested(path, query);
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal NavigateRequested.",
                        SessionId);
                }

                var urlResult = await _connection.NavigateClientAsync(path, query, ct).ConfigureAwait(false);
                if (urlResult.IsFailure)
                {
                    TryJournalNavigateFailed("Resolve", urlResult.Errors.ToArray());
                    var first = urlResult.Errors.FirstOrDefault();
                    return Result<NavigateResult>.Success(new NavigateResult
                    {
                        Applied = false,
                        Outcome = NavigateOutcome.ResolveFailed,
                        ErrorCode = first?.Code ?? "url_resolve_failed",
                        Phase = "Resolve",
                        Message = first?.Message ?? string.Join("; ", urlResult.Errors.Select(e => e.Message)),
                    });
                }

                try
                {
                    _telemetry.Navigate.UrlResolved($"{path}{(string.IsNullOrEmpty(query) ? "" : "?" + query)}");
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal Telemetry.Sessions.Navigate.UrlResolved.",
                        SessionId);
                }

                try
                {
                    _liveEvents.NavigateCompleted($"{path}{(string.IsNullOrEmpty(query) ? "" : "?" + query)}");
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal NavigateCompleted.",
                        SessionId);
                }

                return Result<NavigateResult>.Success(new NavigateResult
                {
                    Applied = true,
                    Outcome = NavigateOutcome.Applied,
                    Url = path,
                });
            },
            ct);
    }

    public Task<IResult> NavigateToAbsoluteUrlAsync(string url, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);
        return WithCommandGateAsync(() => _connection.NavigateAsync(url, ct), ct);
    }

    private void TryJournalNavigateFailed(string phase, Error[] errors)
    {
        try
        {
            _liveEvents.NavigateFailed(phase, errors);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal NavigateFailed ({Phase}).",
                SessionId,
                phase);
        }
    }

    public Task<IResult> RefreshAsync(CancellationToken ct = default)
        => WithCommandGateAsync(() => _connection.RefreshAsync(ct), ct);

    public Task<IResult<ResizeResult>> ResizeAsync(ResizeSession request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return _resizeCoalescer.SubmitAsync(request, ResizeWithGateAsync, ct);
    }

    private async Task<IResult<ResizeResult>> ResizeWithGateAsync(
        ResizeSession request,
        CancellationToken ct)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result<ResizeResult>.Failure("Live session is released");
        }

        var requestId = string.IsNullOrWhiteSpace(request.RequestId)
            ? Guid.CreateVersion7().ToString("D")
            : request.RequestId.Trim();

        // Busy-reject: do not queue behind Navigate/Refresh/prior Resize (client retries resize_busy).
        var lease = await _commandGate.TryAcquireAsync(SessionId, ct).ConfigureAwait(false);
        if (lease is null)
        {
            var busy = new ResizeResult
            {
                Applied = false,
                Outcome = ResizeOutcome.Busy,
                Width = request.Width,
                Height = request.Height,
                ResizeId = requestId,
                ErrorCode = "resize_busy",
                Phase = "validate",
                Message = "another command is in progress",
            };
            TryJournalResize(
                request.Width,
                request.Height,
                requestId,
                Result<ResizeResult>.Success(busy));
            return Result<ResizeResult>.Success(busy);
        }

        await using (lease.ConfigureAwait(false))
        {
            if (IsReleased || !_connection.IsOpen)
            {
                return Result<ResizeResult>.Failure("Live session is released");
            }

            // Optional device: empty profile maps to no proto device (size-only resize).
            var result = await _connection.ResizeAsync(
                requestId,
                request.Width,
                request.Height,
                request.Device ?? new DeviceProfile(),
                ct).ConfigureAwait(false);

            if (result.IsSuccess && result.Value.Outcome == ResizeOutcome.Applied && !result.Value.Applied)
            {
                // Mapper may only set Applied; normalize Outcome for soft rejects/fails.
                result.Value.Outcome = string.Equals(
                        result.Value.ErrorCode,
                        "resize_busy",
                        StringComparison.Ordinal)
                    ? ResizeOutcome.Busy
                    : ResizeOutcome.Rejected;
            }

            TryJournalResize(request.Width, request.Height, requestId, result);
            return result;
        }
    }

    private void TryJournalResize(
        int requestedWidth,
        int requestedHeight,
        string requestId,
        IResult<ResizeResult> result)
    {
        try
        {
            if (result.IsSuccess && result.Value.Applied)
            {
                _telemetry.Resize.Applied(
                    result.Value.Width,
                    result.Value.Height,
                    result.Value.ResizeId ?? requestId);
                return;
            }

            if (result.IsFailure)
            {
                var first = result.Errors.FirstOrDefault();
                _telemetry.Resize.Rejected(
                    requestedWidth,
                    requestedHeight,
                    requestId,
                    first?.Code,
                    first?.Message,
                    "validate");
                return;
            }

            _telemetry.Resize.Rejected(
                requestedWidth,
                requestedHeight,
                result.Value.ResizeId ?? requestId,
                result.Value.ErrorCode,
                result.Value.Message,
                result.Value.Phase ?? "resize");
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Failed to journal resize for session {SessionId}",
                SessionId);
        }
    }

    public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        ProbeSession request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Probe);
        // Unlocked vs navigate/resize (sidecar probe is unlocked too), but still
        // fail fast after Release — same guard as GetStatusAsync.
        if (IsReleased || !_connection.IsOpen)
        {
            return Task.FromResult<IResult<DiagProbeResult>>(
                Result<DiagProbeResult>.Failure("Live session is released"));
        }

        return _connection.RequestDiagnosticsAsync(request.Probe, ct);
    }

    public async Task<IResult<VirtualResourceResponse>> GetVirtualAssetAsync(
        string key,
        CancellationToken ct = default,
        string? kind = null,
        string? rangeHeader = null)
    {
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result<VirtualResourceResponse>.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(key))
        {
            return Result<VirtualResourceResponse>.Failure("Asset key is required");
        }

        if (IsReleased || !_connection.IsOpen)
        {
            return Result<VirtualResourceResponse>.Failure("Live session is released");
        }

        var trimmed = key.Trim();
        var started = Environment.TickCount64;
        var result = await _connection
            .GetVirtualAssetAsync(trimmed, ct, kind, rangeHeader)
            .ConfigureAwait(false);
        var durationMs = Math.Max(0, Environment.TickCount64 - started);
        var urlKey = VirtualAssetUrlKey(trimmed);

        try
        {
            var miss = result.IsFailure
                || (result.IsSuccess
                    && result.Value.Body.Length == 0
                    && result.Value.StatusCode is 0 or 404);
            if (miss && _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionAssetServeMiss))
            {
                var status = result.IsSuccess ? result.Value.StatusCode : 404;
                _telemetry.PageProjection.Asset.ServeMiss(urlKey, durationMs, status <= 0 ? 404 : status);
            }
            else if (!miss
                && durationMs >= 200
                && _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionAssetServeSlow))
            {
                var status = result.Value.StatusCode is >= 200 and < 600 ? result.Value.StatusCode : 200;
                _telemetry.PageProjection.Asset.ServeSlow(urlKey, durationMs, status);
            }
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal PageProjection Asset serve telemetry.",
                SessionId);
        }

        return result;
    }

    private static string VirtualAssetUrlKey(string key)
    {
        var q = key.IndexOf('?', StringComparison.Ordinal);
        var h = key.IndexOf('#', StringComparison.Ordinal);
        var cut = key.Length;
        if (q >= 0) cut = Math.Min(cut, q);
        if (h >= 0) cut = Math.Min(cut, h);
        return cut < key.Length ? key[..cut] : key;
    }

    public async Task<IResult> RequestResyncAsync(
        uint contextId = 1,
        string? reason = null,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (IsReleased || !_connection.IsOpen)
        {
            return Result.Failure("Live session is released");
        }

        if (_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameResyncRequested))
        {
            try
            {
                _telemetry.PageProjection.Frame.ResyncRequested(contextId, 0);
            }
            catch (Exception journalEx)
            {
                _logger.LogWarning(
                    journalEx,
                    "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Frame.ResyncRequested.",
                    SessionId);
            }
        }

        return await _connection
            .RequestResyncAsync(contextId, reason, ct)
            .ConfigureAwait(false);
    }

    public async Task<IResult> PutDomUploadAsync(
        string uploadId,
        byte[] body,
        string contentType,
        string name,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(uploadId) || body is null || body.Length == 0)
        {
            return Result.Failure("Upload id and body are required");
        }

        if (IsReleased || !_connection.IsOpen)
        {
            return Result.Failure("Live session is released");
        }

        return await _connection
            .PutDomUploadAsync(uploadId.Trim(), body, contentType, name, ct)
            .ConfigureAwait(false);
    }

    // ── Hooks ────────────────────────────────────────────────────────────────

    public IResult<Guid> RegisterCameraPermission(
        Func<CancellationToken, Task<PermissionDecision>> handler)
        => IsReleased
            ? Result<Guid>.Failure("Live session is released")
            : _hooks.RegisterCameraPermission(handler);

    public IResult UnregisterCameraPermission(Guid registrationId)
        => IsReleased
            ? Result.Failure("Live session is released")
            : _hooks.UnregisterCameraPermission(registrationId);

    public IResult<Guid> RegisterMicrophonePermission(
        Func<CancellationToken, Task<PermissionDecision>> handler)
        => IsReleased
            ? Result<Guid>.Failure("Live session is released")
            : _hooks.RegisterMicrophonePermission(handler);

    public IResult UnregisterMicrophonePermission(Guid registrationId)
        => IsReleased
            ? Result.Failure("Live session is released")
            : _hooks.UnregisterMicrophonePermission(registrationId);

    public Task<PermissionDecision> EvaluateCameraPermissionPolicyAsync(CancellationToken ct = default)
        => IsReleased
            ? Task.FromResult(PermissionDecision.Deny)
            : _hooks.EvaluateCameraAsync(ct);

    public Task<PermissionDecision> EvaluateMicrophonePermissionPolicyAsync(CancellationToken ct = default)
        => IsReleased
            ? Task.FromResult(PermissionDecision.Deny)
            : _hooks.EvaluateMicrophoneAsync(ct);

    private async Task<IResult> WithCommandGateAsync(
        Func<Task<IResult>> action,
        CancellationToken ct)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result.Failure("Live session is released");
        }

        await using (await _commandGate.AcquireAsync(SessionId, ct).ConfigureAwait(false))
        {
            if (IsReleased || !_connection.IsOpen)
            {
                return Result.Failure("Live session is released");
            }

            return await action().ConfigureAwait(false);
        }
    }

    private async Task<IResult<T>> WithCommandGateAsync<T>(
        Func<Task<IResult<T>>> action,
        CancellationToken ct)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result<T>.Failure("Live session is released");
        }

        await using (await _commandGate.AcquireAsync(SessionId, ct).ConfigureAwait(false))
        {
            if (IsReleased || !_connection.IsOpen)
            {
                return Result<T>.Failure("Live session is released");
            }

            return await action().ConfigureAwait(false);
        }
    }
}
