using Speculum.Api.HostResources.Models;

namespace Speculum.Api.HostResources.Services.Contracts;

public interface IHostResourceApplyStore
{
    Task<HostResourceLastApplySnapshot?> GetLastAsync(CancellationToken ct = default);

    Task SaveAsync(HostResourceApplyResult result, CancellationToken ct = default);
}
