using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.HostResources.Models;
using Speculum.Api.HostResources.Services.Contracts;

namespace Speculum.Api.Presentation.HostResources;

public static class HostResourceEndpoints
{
    public static IEndpointRouteBuilder MapHostResourceEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/admin/host-resources", async (
            IHostResourceProvisionService service,
            CancellationToken ct) =>
        {
            var result = await service.GetStatusAsync(ct).ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Host resources status failed" });
        }).WithTags("HostResources");

        endpoints.MapPost("/api/admin/host-resources/preview", async (
            HostResourceProvisionParams? body,
            IHostResourceProvisionService service,
            CancellationToken ct) =>
        {
            var parameters = body ?? new HostResourceProvisionParams();
            var result = await service.PreviewAsync(parameters, ct).ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Host resources preview failed" });
        }).WithTags("HostResources");

        endpoints.MapPost("/api/admin/host-resources/apply", async (
            HostResourceProvisionParams? body,
            IHostResourceProvisionService service,
            CancellationToken ct) =>
        {
            var parameters = body ?? new HostResourceProvisionParams();
            var result = await service.ApplyAsync(parameters, ct).ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Host resources apply failed" });
        }).WithTags("HostResources");

        return endpoints;
    }
}
