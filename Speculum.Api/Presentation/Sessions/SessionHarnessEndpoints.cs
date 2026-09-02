using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Session harness HTTP surface (input / evaluate / resize) for lab and SessionsTest.
/// Always mapped; API auth gated by <c>SPECULUM_BYPASS_API_AUTH</c>.
/// Requires the session token (binding) — sessionId alone is not enough.
/// </summary>
public static class SessionHarnessEndpoints
{
    public const string InputPath = "/api/sessions/{sessionId:guid}/input";
    public const string EvaluatePath = "/api/sessions/{sessionId:guid}/evaluate";
    public const string ResizePath = "/api/sessions/{sessionId:guid}/resize";

    public static IEndpointRouteBuilder MapSessionHarness(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPost(InputPath, async (
            Guid sessionId,
            SessionHarnessVideoStreamingInputRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (string.IsNullOrWhiteSpace(body.Type) || string.IsNullOrWhiteSpace(body.Payload))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["Type"] = ["Type and Payload are required."],
                });
            }

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            var admit = live.AdmitVideoStreamingInput(new VideoStreamingInput
            {
                Type = body.Type.Trim(),
                Payload = body.Payload,
            });
            if (admit.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "input_admit_failed",
                    message = string.Join("; ", admit.Errors.Select(e => e.Message)),
                });
            }

            live.TraceVideoStreamingInputControlReceived(body.Type.Trim());
            return Results.Ok(new { ok = true });
        }).WithTags("Sessions");

        endpoints.MapPost(EvaluatePath, async (
            Guid sessionId,
            SessionHarnessEvaluateRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (string.IsNullOrWhiteSpace(body.Expression))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["Expression"] = ["Expression is required."],
                });
            }

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            var result = await live.RequestDiagnosticsAsync(
                new ProbeSession
                {
                    SessionId = sessionId,
                    Probe = new DiagProbeRequest
                    {
                        Ops = ["evaluate"],
                        EvaluateExpression = body.Expression,
                    },
                },
                ct).ConfigureAwait(false);

            if (result.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "evaluate_failed",
                    message = string.Join("; ", result.Errors.Select(e => e.Message)),
                });
            }

            if (!result.Value.Ok)
            {
                return Results.BadRequest(new
                {
                    ok = false,
                    errorCode = result.Value.ErrorCode ?? "evaluate_failed",
                    message = result.Value.Message,
                    data = result.Value.Data,
                });
            }

            object? evaluate = null;
            if (result.Value.Data is { } data
                && data.ValueKind == System.Text.Json.JsonValueKind.Object
                && data.TryGetProperty("evaluate", out var evaluateEl))
            {
                evaluate = evaluateEl.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.String => evaluateEl.GetString(),
                    System.Text.Json.JsonValueKind.True => true,
                    System.Text.Json.JsonValueKind.False => false,
                    System.Text.Json.JsonValueKind.Number => evaluateEl.GetDouble(),
                    System.Text.Json.JsonValueKind.Null => null,
                    _ => evaluateEl.ToString(),
                };
            }

            return Results.Ok(new
            {
                ok = true,
                evaluate,
                data = result.Value.Data,
            });
        }).WithTags("Sessions");

        endpoints.MapPost(ResizePath, async (
            Guid sessionId,
            SessionHarnessResizeRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            var result = await live.ResizeAsync(
                new ResizeSession
                {
                    SessionId = sessionId,
                    Width = body.Width,
                    Height = body.Height,
                    RequestId = body.RequestId ?? string.Empty,
                    Device = body.Device,
                },
                ct).ConfigureAwait(false);

            if (result.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "resize_failed",
                    message = string.Join("; ", result.Errors.Select(e => e.Message)),
                });
            }

            return Results.Ok(result.Value);
        }).WithTags("Sessions");

        endpoints.MapPost("/api/sessions/{sessionId:guid}/screenshot", async (
            Guid sessionId,
            SessionHarnessScreenshotRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            var result = await live.RequestDiagnosticsAsync(
                new ProbeSession
                {
                    SessionId = sessionId,
                    Probe = new DiagProbeRequest
                    {
                        Ops = ["screenshot"],
                        MaxProbeResponseBytes = 4 * 1024 * 1024,
                    },
                },
                ct).ConfigureAwait(false);

            if (result.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "screenshot_failed",
                    message = string.Join("; ", result.Errors.Select(e => e.Message)),
                });
            }

            if (!result.Value.Ok)
            {
                return Results.BadRequest(new
                {
                    ok = false,
                    errorCode = result.Value.ErrorCode ?? "screenshot_failed",
                    message = result.Value.Message,
                    data = result.Value.Data,
                });
            }

            return Results.Ok(new
            {
                ok = true,
                data = result.Value.Data,
            });
        }).WithTags("Sessions");

        endpoints.MapPost("/api/sessions/{sessionId:guid}/page-projection/wait-frame", async (
            Guid sessionId,
            SessionHarnessPageProjectionWaitFrameRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            if (live.MirrorMode != Speculum.Api.Configurations.Models.Sessions.MirrorMode.PageProjection)
            {
                return Results.BadRequest(new
                {
                    errorCode = "mirror_mode_mismatch",
                    message = "PageProjection wait-frame requires MirrorMode.PageProjection.",
                });
            }

            var opened = live.OpenPageProjectionFramesStream(Guid.NewGuid());
            if (opened.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "frame_stream_open_failed",
                    message = string.Join("; ", opened.Errors.Select(e => e.Message)),
                });
            }

            using var stream = opened.Value;
            var channel = stream.GetPageProjectionFramesChannel();
            if (channel.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "frame_channel_failed",
                    message = string.Join("; ", channel.Errors.Select(e => e.Message)),
                });
            }

            var timeoutMs = body.TimeoutMs is > 0 and <= 120_000 ? body.TimeoutMs.Value : 45_000;
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(timeoutMs));
            const uint ResyncFlag = 1u << 1;

            try
            {
                while (!timeoutCts.Token.IsCancellationRequested)
                {
                    var reader = channel.Value;
                    while (reader.Completion.IsCompleted && !timeoutCts.Token.IsCancellationRequested)
                    {
                        await Task.Delay(25, timeoutCts.Token).ConfigureAwait(false);
                        channel = stream.GetPageProjectionFramesChannel();
                        if (channel.IsFailure)
                        {
                            return Results.BadRequest(new
                            {
                                errorCode = "frame_channel_failed",
                                message = string.Join("; ", channel.Errors.Select(e => e.Message)),
                            });
                        }

                        reader = channel.Value;
                    }

                    await foreach (var frame in reader.ReadAllAsync(timeoutCts.Token)
                        .ConfigureAwait(false))
                    {
                        var bodyLen = frame.Body?.Length ?? 0;
                        if (bodyLen <= 0)
                        {
                            continue;
                        }

                        var isResync = (frame.Flags & ResyncFlag) != 0;
                        if (body.RequireResync == true && !isResync)
                        {
                            continue;
                        }

                        return Results.Ok(new
                        {
                            ok = true,
                            sequence = frame.Sequence,
                            contextId = frame.ContextId,
                            generation = frame.Generation,
                            flags = frame.Flags,
                            resync = isResync,
                            bodyLen,
                            partIndex = frame.PartIndex,
                            partCount = frame.PartCount,
                            version = frame.Version,
                        });
                    }

                    if (timeoutCts.Token.IsCancellationRequested)
                    {
                        break;
                    }
                }
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                return Results.BadRequest(new
                {
                    errorCode = "frame_wait_timeout",
                    phase = "wait_frame",
                    message = body.RequireResync == true
                        ? "Timed out waiting for a resync-flagged PageProjection frame."
                        : "Timed out waiting for a PageProjection frame with body.",
                });
            }

            return Results.BadRequest(new
            {
                errorCode = "frame_stream_ended",
                phase = "wait_frame",
                message = "PageProjection frame stream ended before a matching frame.",
            });
        }).WithTags("Sessions");

        endpoints.MapPost("/api/sessions/{sessionId:guid}/permissions/register", async (
            Guid sessionId,
            SessionHarnessPermissionRegisterRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            Guid? cameraId = null;
            Guid? microphoneId = null;

            if (body.Camera)
            {
                var camera = live.RegisterCameraPermission(
                    static _ => Task.FromResult(PermissionDecision.Allow));
                if (camera.IsFailure)
                {
                    return Results.BadRequest(new
                    {
                        errorCode = "permission_register_failed",
                        message = string.Join("; ", camera.Errors.Select(e => e.Message)),
                    });
                }

                cameraId = camera.Value;
            }

            if (body.Microphone)
            {
                var microphone = live.RegisterMicrophonePermission(
                    static _ => Task.FromResult(PermissionDecision.Allow));
                if (microphone.IsFailure)
                {
                    if (cameraId is Guid cam)
                    {
                        live.UnregisterCameraPermission(cam);
                    }

                    return Results.BadRequest(new
                    {
                        errorCode = "permission_register_failed",
                        message = string.Join("; ", microphone.Errors.Select(e => e.Message)),
                    });
                }

                microphoneId = microphone.Value;
            }

            var cameraPolicy = await live.EvaluateCameraPermissionPolicyAsync(ct).ConfigureAwait(false);
            var microphonePolicy = await live.EvaluateMicrophonePermissionPolicyAsync(ct).ConfigureAwait(false);

            return Results.Ok(new
            {
                ok = true,
                cameraRegistrationId = cameraId,
                microphoneRegistrationId = microphoneId,
                cameraPolicy = cameraPolicy.ToString(),
                microphonePolicy = microphonePolicy.ToString(),
            });
        }).WithTags("Sessions");

        endpoints.MapPost("/api/sessions/{sessionId:guid}/probe", async (
            Guid sessionId,
            SessionHarnessProbeRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (body.Ops is not { Count: > 0 })
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["Ops"] = ["At least one probe op is required."],
                });
            }

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            var result = await live.RequestDiagnosticsAsync(
                new ProbeSession
                {
                    SessionId = sessionId,
                    Probe = new DiagProbeRequest
                    {
                        Ops = body.Ops,
                        EvaluateExpression = body.EvaluateExpression,
                        ElementSelector = body.ElementSelector,
                    },
                },
                ct).ConfigureAwait(false);

            if (result.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "probe_failed",
                    phase = "probe",
                    message = string.Join("; ", result.Errors.Select(e => e.Message)),
                });
            }

            if (!result.Value.Ok)
            {
                return Results.BadRequest(new
                {
                    ok = false,
                    errorCode = result.Value.ErrorCode ?? "probe_failed",
                    phase = "probe",
                    message = result.Value.Message,
                    data = result.Value.Data,
                });
            }

            return Results.Ok(new
            {
                ok = true,
                data = result.Value.Data,
            });
        }).WithTags("Sessions");

        endpoints.MapPost("/api/sessions/{sessionId:guid}/page-projection/resolve-click", async (
            Guid sessionId,
            SessionHarnessPageProjectionResolveClickRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (string.IsNullOrWhiteSpace(body.Selector))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["Selector"] = ["Selector is required."],
                });
            }

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            if (live.MirrorMode != Speculum.Api.Configurations.Models.Sessions.MirrorMode.PageProjection)
            {
                return Results.BadRequest(new
                {
                    errorCode = "mirror_mode_mismatch",
                    message = "PageProjection resolve-click requires MirrorMode.PageProjection.",
                });
            }

            var result = await live.RequestDiagnosticsAsync(
                new ProbeSession
                {
                    SessionId = sessionId,
                    Probe = new DiagProbeRequest
                    {
                        Ops = ["resolveAndClick"],
                        ElementSelector = body.Selector.Trim(),
                    },
                },
                ct).ConfigureAwait(false);

            if (result.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "resolve_click_failed",
                    phase = "probe",
                    message = string.Join("; ", result.Errors.Select(e => e.Message)),
                });
            }

            if (!result.Value.Ok)
            {
                return Results.BadRequest(new
                {
                    ok = false,
                    errorCode = result.Value.ErrorCode ?? "resolve_click_failed",
                    phase = "dispatch",
                    message = result.Value.Message,
                    data = result.Value.Data,
                });
            }

            return Results.Ok(new
            {
                ok = true,
                data = result.Value.Data,
            });
        }).WithTags("Sessions");

        endpoints.MapPost("/api/sessions/{sessionId:guid}/page-projection-intent", async (
            Guid sessionId,
            SessionHarnessPageProjectionIntentRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
                return Results.Unauthorized();

            if (string.IsNullOrWhiteSpace(body.Type))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["Type"] = ["Type is required."],
                });
            }

            if (!bindings.TryGetLive(sessionId, body.Token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            if (live.MirrorMode != Speculum.Api.Configurations.Models.Sessions.MirrorMode.PageProjection)
            {
                return Results.BadRequest(new
                {
                    errorCode = "mirror_mode_mismatch",
                    message = "PageProjection intent admit requires MirrorMode.PageProjection.",
                });
            }

            var admit = live.AdmitPageProjectionInput(new PageProjectionIntent
            {
                Generation = body.Generation,
                Type = body.Type.Trim(),
                Anchor = body.Anchor,
                TargetId = body.TargetId,
                ContextId = body.ContextId,
                TimestampClient = body.TimestampClient,
                TraceId = body.TraceId,
                Payload = body.Payload ?? "{}",
                SchemaVersion = body.SchemaVersion,
                ViewportW = body.ViewportW,
                ViewportH = body.ViewportH,
                Census = body.Census,
            });
            if (admit.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "page_projection_intent_admit_failed",
                    message = string.Join("; ", admit.Errors.Select(e => e.Message)),
                });
            }

            return Results.Ok(new { ok = true });
        }).WithTags("Sessions");

        return endpoints;
    }
}

public sealed class SessionHarnessVideoStreamingInputRequest
{
    public required string Token { get; init; }
    public required string Type { get; init; }
    public required string Payload { get; init; }
}

public sealed class SessionHarnessEvaluateRequest
{
    public required string Token { get; init; }
    public required string Expression { get; init; }
}

public sealed class SessionHarnessResizeRequest
{
    public required string Token { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }
    public string? RequestId { get; init; }
    public DeviceProfile? Device { get; init; }
}

public sealed class SessionHarnessScreenshotRequest
{
    public required string Token { get; init; }
}

public sealed class SessionHarnessPageProjectionWaitFrameRequest
{
    public required string Token { get; init; }

    /// <summary>Optional timeout (ms). Default 45000; capped at 120000.</summary>
    public int? TimeoutMs { get; init; }

    /// <summary>When true, wait for a frame with the resync flag bit set.</summary>
    public bool? RequireResync { get; init; }
}

public sealed class SessionHarnessPageProjectionResolveClickRequest
{
    public required string Token { get; init; }

    public required string Selector { get; init; }
}

public sealed class SessionHarnessPageProjectionIntentRequest
{
    public required string Token { get; init; }

    public required string Type { get; init; }

    public long Generation { get; init; }

    public string? Anchor { get; init; }

    public uint? TargetId { get; init; }

    public uint ContextId { get; init; } = 1;

    public double? TimestampClient { get; init; }

    public string? TraceId { get; init; }

    public string? Payload { get; init; }

    public int SchemaVersion { get; init; }

    public int? ViewportW { get; init; }

    public int? ViewportH { get; init; }

    public string? Census { get; init; }
}

public sealed class SessionHarnessProbeRequest
{
    public required string Token { get; init; }

    public required IReadOnlyList<string> Ops { get; init; }

    public string? EvaluateExpression { get; init; }

    public string? ElementSelector { get; init; }
}

public sealed class SessionHarnessPermissionRegisterRequest
{
    public required string Token { get; init; }

    public bool Camera { get; init; } = true;

    public bool Microphone { get; init; } = true;
}
