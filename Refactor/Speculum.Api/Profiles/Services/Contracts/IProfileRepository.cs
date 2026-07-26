using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Responses;

namespace Speculum.Api.Profiles.Services.Contracts;

public interface IProfileRepository
{
    Task<bool> ExistsAsync(Guid profileId, CancellationToken ct = default);

    Task<Profile?> LoadAsync(Guid profileId, CancellationToken ct = default);

    Task SaveAsync(Profile profile, CancellationToken ct = default);

    Task<ProfileSummary?> GetSummaryAsync(Guid profileId, CancellationToken ct = default);

    Task<(IReadOnlyList<ProfileListItem> Items, int Total)> ListAsync(
        int skip,
        int take,
        CancellationToken ct = default);

    Task<bool> DeleteAsync(Guid profileId, CancellationToken ct = default);
}
