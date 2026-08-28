using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Speculum.Api.Presentation.Auth;
using Speculum.Api.Presentation.Bootstrap;
using Speculum.Api.Presentation.Configurations;
using Speculum.Api.Presentation.Diagnostics;
using Speculum.Api.Presentation.HostResources;
using Speculum.Api.Presentation.Maintenance;
using Speculum.Api.Presentation.Profiles;
using Speculum.Api.Presentation.Scripts;
using Speculum.Api.Presentation.Sessions;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation;

public static class PresentationServiceCollectionExtensions
{
    /// <summary>
    /// Registers SignalR session control-plane presentation.
    /// Requires host registration of <see cref="ISessionService"/> (with
    /// <see cref="IUrlResolver"/> + browser client) and <see cref="ILiveSessionService"/>.
    /// Runtime consumption is via <see cref="ILiveSession"/> from <see cref="ILiveSessionService"/>.
    /// </summary>
    public static IServiceCollection AddPresentation(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSignalR(options =>
        {
            options.MaximumReceiveMessageSize = 512 * 1024;
            options.StreamBufferCapacity = 16;
        }).AddMessagePackProtocol(options =>
        {
            options.SerializerOptions = SessionHubMessagePack.Options;
        });

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.PropertyNamingPolicy =
                System.Text.Json.JsonNamingPolicy.CamelCase;
            options.SerializerOptions.Converters.Add(
                new System.Text.Json.Serialization.JsonStringEnumConverter());
        });

        services.TryAddSingleton<IPublicClientConfigProjector, PublicClientConfigProjector>();

        return services;
    }

    /// <summary>
    /// Maps the session SignalR control hub at <c>/vhub</c>, WebTransport/WebSocket data edges, and domain HTTP APIs.
    /// </summary>
    public static IEndpointRouteBuilder MapPresentation(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapHub<SessionHub>("/vhub", options =>
        {
            options.TransportMaxBufferSize = 512 * 1024;
            options.ApplicationMaxBufferSize = 512 * 1024;
        });
        SessionWebTransportEndpoint.Map(endpoints);
        SessionWebSocketEndpoint.Map(endpoints);
        endpoints.MapAuthEndpoints();
        endpoints.MapConfigurationEndpoints();
        endpoints.MapPublicBootstrapEndpoints();
        endpoints.MapScriptEndpoints();
        endpoints.MapProfileEndpoints();
        endpoints.MapSessionEndpoints();
        endpoints.MapDomAssetEndpoints();
        endpoints.MapHostResourceEndpoints();
        endpoints.MapMaintenanceEndpoints();
        endpoints.MapDiagnosticsProfileEndpoints();
        endpoints.MapResourceMonitoringEndpoints();
        endpoints.MapTimelineEndpoints();
        endpoints.MapSessionHarness();

        return endpoints;
    }
}
