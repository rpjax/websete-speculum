using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients.Grpc;
using Speculum.Api.Configurations.Models.Sidecar;

namespace Speculum.Api.BrowserClients;

public static class BrowserClientsServiceCollectionExtensions
{
    public static IServiceCollection AddGrpcBrowserClient(this IServiceCollection services)
    {
        services.AddSingleton<IValidateOptions<SidecarOptions>, SidecarOptionsValidator>();
        services
            .AddOptions<SidecarOptions>()
            .BindConfiguration(SidecarOptions.SectionName)
            .ValidateOnStart();

        services.AddSingleton<IBrowserClient, GrpcBrowserClient>();
        return services;
    }
}
