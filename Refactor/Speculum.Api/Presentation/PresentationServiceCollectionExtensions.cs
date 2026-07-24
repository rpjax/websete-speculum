using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Presentation.Sessions;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation;

public static class PresentationServiceCollectionExtensions
{
    /// <summary>
    /// Registers SignalR session control-plane presentation.
    /// Requires host registration of <see cref="ISessionService"/> (and its deps).
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

        return services;
    }

    /// <summary>
    /// Maps the session SignalR control hub at <c>/vhub</c>.
    /// </summary>
    public static IEndpointRouteBuilder MapPresentation(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapHub<SessionHub>("/vhub", options =>
        {
            options.TransportMaxBufferSize = 512 * 1024;
            options.ApplicationMaxBufferSize = 512 * 1024;
        });

        return endpoints;
    }
}
