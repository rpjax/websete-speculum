using Speculum.Api.HostResources.Models;

namespace Speculum.Api.HostResources.Services.Contracts;

public interface IHostResourceProvisionService
{
    Task<Aidan.Core.Patterns.IResult<HostResourceStatus>> GetStatusAsync(CancellationToken ct = default);

    Task<Aidan.Core.Patterns.IResult<HostResourceProvisionPlan>> PreviewAsync(
        HostResourceProvisionParams parameters,
        CancellationToken ct = default);

    Task<Aidan.Core.Patterns.IResult<HostResourceApplyResult>> ApplyAsync(
        HostResourceProvisionParams parameters,
        CancellationToken ct = default);
}
