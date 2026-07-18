using Speculum.Api.BrowserProfiles.Aggregates;

namespace Speculum.Api.BrowserProfiles.Services.Contracts;

public interface IProfileRepository
{
    Task<bool> ExistsAsync(Guid profileId, CancellationToken ct = default);
    Task<Profile?> LoadAsync(Guid profileId, CancellationToken ct = default);
    Task SaveAsync(Profile profile, CancellationToken ct = default);
}
