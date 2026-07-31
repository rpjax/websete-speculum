using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

public static class SessionEndpoints
{
    public static IEndpointRouteBuilder MapSessionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/sessions", (ILiveSessionService liveSessions) =>
        {
            var items = liveSessions.ListSnapshots().Select(ToResponse);
            return Results.Ok(new { items });
        }).WithTags("Sessions");

        endpoints.MapGet("/api/sessions/{sessionId:guid}", (
            Guid sessionId,
            ILiveSessionService liveSessions) =>
        {
            var snapshot = liveSessions.ListSnapshots()
                .FirstOrDefault(session => session.SessionId == sessionId);

            return snapshot is null
                ? Results.NotFound(new { error = "Session not found" })
                : Results.Ok(ToResponse(snapshot));
        }).WithTags("Sessions");

        return endpoints;
    }

    private static object ToResponse(LiveSessionTelemetrySnapshot snapshot)
        => new
        {
            sessionId = snapshot.SessionId,
            profileId = snapshot.ProfileId,
            jsBridgeEnabled = snapshot.JsBridgeEnabled,
            connectionOpen = snapshot.ConnectionOpen,
            uptimeMs = snapshot.UptimeMs,
        };
}
