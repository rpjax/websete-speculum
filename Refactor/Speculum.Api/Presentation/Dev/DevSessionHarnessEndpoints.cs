using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Dev;

/// <summary>
/// Development/assert harness: push input, evaluate, resize against a live session
/// without WebTransport. Same gate as <see cref="DevEngineConfigEndpoints"/>.
/// Requires the session token (binding) — sessionId alone is not enough.
/// </summary>
public static class DevSessionHarnessEndpoints
{
    public const string InputPath = "/api/dev/sessions/{sessionId:guid}/input";
    public const string EvaluatePath = "/api/dev/sessions/{sessionId:guid}/evaluate";
    public const string ResizePath = "/api/dev/sessions/{sessionId:guid}/resize";

    public static IEndpointRouteBuilder MapDevSessionHarness(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        if (!DevBackdoorGate.IsEnabled(endpoints.ServiceProvider))
        {
            return endpoints;
        }

        endpoints.MapPost(InputPath, async (
            Guid sessionId,
            DevUserInputRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
            {
                return Results.Unauthorized();
            }

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

            var channel = Channel.CreateUnbounded<UserInput>();
            await channel.Writer.WriteAsync(
                new UserInput { Type = body.Type.Trim(), Payload = body.Payload },
                ct).ConfigureAwait(false);
            channel.Writer.Complete();

            var start = live.ConsumeUserInputAsync(channel.Reader, ct);
            if (start.IsFailure)
            {
                return Results.BadRequest(new
                {
                    errorCode = "input_pump_failed",
                    message = string.Join("; ", start.Errors.Select(e => e.Message)),
                });
            }

            await start.Value.ConfigureAwait(false);
            return Results.Ok(new { ok = true });
        }).WithTags("Dev");

        endpoints.MapPost(EvaluatePath, async (
            Guid sessionId,
            DevEvaluateRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
            {
                return Results.Unauthorized();
            }

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
        }).WithTags("Dev");

        endpoints.MapPost(ResizePath, async (
            Guid sessionId,
            DevResizeRequest body,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(body);
            if (string.IsNullOrWhiteSpace(body.Token))
            {
                return Results.Unauthorized();
            }

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
        }).WithTags("Dev");

        return endpoints;
    }
}

public sealed class DevUserInputRequest
{
    public required string Token { get; init; }
    public required string Type { get; init; }
    public required string Payload { get; init; }
}

public sealed class DevEvaluateRequest
{
    public required string Token { get; init; }
    public required string Expression { get; init; }
}

public sealed class DevResizeRequest
{
    public required string Token { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }
    public string? RequestId { get; init; }
    public DeviceProfile? Device { get; init; }
}

/// <summary>Shared Development / SPECULUM_ENABLE_DEV_BACKDOOR gate.</summary>
internal static class DevBackdoorGate
{
    public static bool IsEnabled(IServiceProvider services)
    {
        var env = services.GetRequiredService<IHostEnvironment>();
        var backdoorFlag = Environment.GetEnvironmentVariable("SPECULUM_ENABLE_DEV_BACKDOOR");
        return env.IsDevelopment()
            || string.Equals(backdoorFlag, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(backdoorFlag, "1", StringComparison.OrdinalIgnoreCase);
    }
}
