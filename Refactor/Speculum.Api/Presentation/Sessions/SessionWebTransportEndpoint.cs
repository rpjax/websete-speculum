#pragma warning disable CA2252 // Kestrel WebTransport server APIs remain preview in .NET 10.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// WebTransport edge for data streams (<c>/vtransport</c>).
/// Auth + Accept, then <see cref="SessionDataStreamsHost"/> over <see cref="WebTransportDataStreamSession"/>.
/// </summary>
internal static class SessionWebTransportEndpoint
{
    public static IEndpointConventionBuilder Map(IEndpointRouteBuilder endpoints)
        => endpoints.Map("/vtransport", HandleAsync);

    private static async Task HandleAsync(HttpContext context)
    {
        if (!Guid.TryParse(context.Request.Query["sessionId"], out var sessionId)
            || string.IsNullOrWhiteSpace(context.Request.Query["token"]))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var token = context.Request.Query["token"].ToString();
        var bindings = context.RequestServices.GetRequiredService<ISessionBindingRegistry>();
        var liveSessions = context.RequestServices.GetRequiredService<ILiveSessionService>();
        if (!bindings.TryGetLive(sessionId, token, out _)
            || !liveSessions.TryGet(sessionId, out var live))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var feature = context.Features.Get<IHttpWebTransportFeature>();
        if (feature is not { IsWebTransportRequest: true })
        {
            context.Response.StatusCode = StatusCodes.Status426UpgradeRequired;
            return;
        }

        var session = await feature.AcceptAsync(context.RequestAborted);
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(
            context.RequestAborted);
        var pipeId = Guid.CreateVersion7();
        var registration = bindings.RegisterPipe(
            sessionId,
            token,
            pipeId,
            new CancellationResource(lifetime));
        if (registration.IsFailure)
        {
            session.Abort(0x010c);
            return;
        }

        try
        {
            var carrier = new WebTransportDataStreamSession(session);
            await SessionDataStreamsHost.RunAsync(live, carrier, lifetime).ConfigureAwait(false);
        }
        finally
        {
            lifetime.Cancel();
            bindings.UnregisterPipe(pipeId);
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
#pragma warning restore CA2252
