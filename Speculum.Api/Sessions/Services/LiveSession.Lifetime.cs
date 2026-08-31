using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

internal sealed partial class LiveSession
{
    internal LiveSessionTelemetrySnapshot GetTelemetrySnapshot()
        => new(
            SessionId,
            _profileId,
            _jsBridgeEnabled,
            _connection.IsOpen && !IsReleased,
            Math.Max(1, Environment.TickCount64 - _startedTimestamp));

    internal void Release()
    {
        if (Interlocked.Exchange(ref _released, 1) != 0)
        {
            return;
        }

        lock (_attachmentGate)
        {
            if (_attachmentId is not null)
            {
                _collector.Release(SessionId);
            }

            _attachmentId = null;
            _attachedClient = null;
            _mux.SetAttachedConsumer(null);
        }

        var lifetime = Interlocked.Exchange(ref _lifetime, null);
        if (lifetime is not null)
        {
            try
            {
                lifetime.Cancel();
            }
            finally
            {
                lifetime.Dispose();
            }
        }

        _featureNotifications?.Dispose();
        _featureNotifications = null;
        _connection.BindPageProjectionFrameTelemetry(null);
        _hooks.Unbind(_connection.IsOpen ? _connection : null);
        var videoPipe = Interlocked.Exchange(ref _videoStreamingInputPipe, null);
        videoPipe?.Writer.TryComplete();
        var domPipe = Interlocked.Exchange(ref _pageProjectionInputPipe, null);
        domPipe?.Writer.TryComplete();
        _mux.Dispose();
    }

    private bool IsReleased => Volatile.Read(ref _released) != 0;

    /// <summary>
    /// Pushes <c>SessionEnded</c> once and schedules Faulted stop. Idempotent.
    /// Not tied to the feature-loop token — TearDown must not cancel abandon mid-flight.
    /// </summary>
    private async Task AbandonAsync(StopReason reason, string? errorCode, string? message)
    {
        if (Interlocked.Exchange(ref _abandoned, 1) != 0 || IsReleased)
        {
            return;
        }

        try
        {
            _liveEvents.LiveSessionAbandoned(
                reason.ToStableString(),
                errorCode,
                message);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal LiveSessionAbandoned.",
                SessionId);
        }

        IAttachedSessionClient? client;
        lock (_attachmentGate)
        {
            client = _attachedClient;
        }

        if (client is not null)
        {
            try
            {
                await client.SessionEndedAsync(
                        SessionId,
                        reason.ToStableString(),
                        errorCode,
                        message,
                        CancellationToken.None)
                    .ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(
                    ex,
                    "Session {SessionId} failed to push SessionEnded to attached client.",
                    SessionId);
                try
                {
                    _telemetry.Client.AttachedCommandFailed("SessionEnded", ex);
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal AttachedClientCommandFailed.",
                        SessionId);
                }
            }
        }

        _faults.RequestStop(SessionId, reason);
    }

    private bool TryGetLifetimeToken(out CancellationToken token)
    {
        token = default;
        var lifetime = Volatile.Read(ref _lifetime);
        if (lifetime is null)
        {
            return false;
        }

        try
        {
            token = lifetime.Token;
            return true;
        }
        catch (ObjectDisposedException)
        {
            return false;
        }
    }
}
