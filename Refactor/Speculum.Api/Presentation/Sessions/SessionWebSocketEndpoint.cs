using Microsoft.AspNetCore.Http;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// WebSocket edge for data streams (<c>/vstream</c>).
/// Auth + Accept, then <see cref="SessionDataStreamsHost"/> over <see cref="WebSocketDataStreamSession"/>.
/// </summary>
internal static class SessionWebSocketEndpoint
{
    public static IEndpointConventionBuilder Map(IEndpointRouteBuilder endpoints)
        => endpoints.Map("/vstream", HandleAsync);

    private static async Task HandleAsync(HttpContext context)
    {
        if (!Guid.TryParse(context.Request.Query["sessionId"], out var sessionId))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var bindings = context.RequestServices.GetRequiredService<ISessionBindingRegistry>();
        var liveSessions = context.RequestServices.GetRequiredService<ILiveSessionService>();
        if (!SessionBindingAuth.TryAuthorize(
                context.Request,
                bindings,
                liveSessions,
                out var live,
                out var token,
                expectedSessionId: sessionId))
        {
            context.Response.StatusCode = token is null
                ? StatusCodes.Status400BadRequest
                : StatusCodes.Status401Unauthorized;
            return;
        }

        if (!bindings.TryGetLive(sessionId, token, out var binding))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsync("WebSocket upgrade required").ConfigureAwait(false);
            return;
        }

        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(
            context.RequestAborted);
        var carrierId = Guid.CreateVersion7();
        var registration = bindings.RegisterCarrier(
            sessionId,
            token,
            carrierId,
            new CancellationResource(lifetime));
        if (registration.IsFailure)
        {
            context.Response.StatusCode = StatusCodes.Status409Conflict;
            return;
        }

        var socket = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
        await using var carrier = new WebSocketDataStreamSession(socket);
        try
        {
            await SessionDataStreamsHost
                .RunAsync(live, carrier, binding.AttachmentId, lifetime)
                .ConfigureAwait(false);
        }
        finally
        {
            lifetime.Cancel();
            bindings.UnregisterCarrier(carrierId);
        }
    }

    private sealed class CancellationResource : IDisposable
    {
        private readonly CancellationTokenSource _source;

        public CancellationResource(CancellationTokenSource source)
        {
            _source = source;
        }

        public void Dispose()
        {
            try
            {
                _source.Cancel();
            }
            catch (ObjectDisposedException)
            {
            }
        }
    }
}
