using Speculum.Api.Profiles.Aggregates;

namespace Speculum.Api.Profiles.Services.Contracts;

public interface IProfileRepository
{
    Task<bool> ExistsAsync(Guid profileId, CancellationToken ct = default);
    Task<Profile?> LoadAsync(Guid profileId, CancellationToken ct = default);
    Task SaveAsync(Profile profile, CancellationToken ct = default);
}
