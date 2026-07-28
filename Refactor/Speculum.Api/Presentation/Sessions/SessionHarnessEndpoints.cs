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
            SessionHarnessUserInputRequest body,
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

            var admit = live.AdmitUserInput(new UserInput
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

            live.TraceInputPathControlReceived(body.Type.Trim());
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

        return endpoints;
    }
}

public sealed class SessionHarnessUserInputRequest
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
