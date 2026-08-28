using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Presentation.Bootstrap;

/// <summary>
/// Public bootstrap endpoints (no Bearer). V1 client-config.
/// </summary>
public static class PublicBootstrapEndpoints
{
    public static IEndpointRouteBuilder MapPublicBootstrapEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(
            "/api/public/client-config",
            (
                HttpContext http,
                IConfigurationService configuration,
                IPublicClientConfigProjector projector) =>
            {
                var dto = projector.Project(
                    configuration.GetCurrent(),
                    configuration.AreMandatorySettingsSatisfied,
                    configuration.MissingRequired,
                    http.Request.Host.Host);
                return Results.Ok(dto);
            }).WithTags("Public");

        return endpoints;
    }
}
