using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Services;

namespace Speculum.Api.Presentation.Bootstrap;

/// <summary>
/// Public bootstrap endpoints (no Bearer). V1 client-config.
/// </summary>
public static class PublicBootstrapEndpoints
{
    public static IEndpointRouteBuilder MapPublicBootstrapEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/public/client-config", (HttpContext http, IConfigurationService configuration) =>
        {
            var engine = configuration.GetCurrent();
            var missing = configuration.MissingRequired;
            var requestHost = http.Request.Host.Host;

            var domains = engine.Hosting.Domains
                .Select(d => new
                {
                    domain = d.Domain,
                    subdomainMirroringEnabled = d.IsSubdomainMirroringEnabled,
                })
                .ToList();

            var matched = domains.FirstOrDefault(d =>
                string.Equals(d.domain, requestHost, StringComparison.OrdinalIgnoreCase));

            return Results.Ok(new
            {
                schemaVersion = 1,
                operational = configuration.AreMandatorySettingsSatisfied,
                missing,
                nsoParamName = UrlResolver.NavigationStateParameterName,
                navigation = new
                {
                    defaultTargetHost = engine.Navigation.DefaultTargetHost,
                },
                sessions = new
                {
                    detachedSessionTimeoutSeconds =
                        (int)Math.Clamp(engine.Sessions.DetachedSessionTimeout.TotalSeconds, 0, int.MaxValue),
                    dataStreamTransport = ToClientTransport(engine.Sessions.DataStreamTransport),
                    screencastMaxEncodeScale = Math.Clamp(
                        double.IsFinite(engine.Sessions.ScreencastPolicy.MaxEncodeScale)
                            && engine.Sessions.ScreencastPolicy.MaxEncodeScale > 0
                            ? engine.Sessions.ScreencastPolicy.MaxEncodeScale
                            : 2,
                        1,
                        2),
                },
                resourceManagement = new
                {
                    maxConcurrentSessions = engine.ResourceManagement.Sessions.MaxConcurrentSessions,
                },
                hosting = new
                {
                    required = false,
                    domains,
                    // Informational only — subdomain mirroring ops are 1.1 (no mirroringOperational).
                    currentDomain = matched?.domain,
                },
            });
        }).WithTags("Public");

        return endpoints;
    }

    private static string ToClientTransport(DataStreamTransportKind kind)
        => kind == DataStreamTransportKind.WebSocket ? "webSocket" : "webTransport";
}
