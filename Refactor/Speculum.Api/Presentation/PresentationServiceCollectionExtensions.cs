using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Presentation.Configurations;
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
            options.SerializerOptions.Converters.Add(
                new System.Text.Json.Serialization.JsonStringEnumConverter());
        });

        return services;
    }

    /// <summary>
    /// Maps the session SignalR control hub at <c>/vhub</c>, WebTransport, and domain HTTP APIs.
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
        endpoints.MapConfigurationEndpoints();
        endpoints.MapScriptEndpoints();
        endpoints.MapSessionHarness();

        return endpoints;
    }
}
