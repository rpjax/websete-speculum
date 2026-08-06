using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Requests;
using Speculum.Api.Profiles.Responses;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Profiles.Services.Contracts;

public interface IProfileRepository
{
    Task<bool> ExistsAsync(Guid profileId, CancellationToken ct = default);

    Task<Profile?> LoadAsync(Guid profileId, CancellationToken ct = default);

    Task SaveAsync(Profile profile, CancellationToken ct = default);

    /// <summary>
    /// Reloads the profile row and merges <paramref name="export"/> into durable state
    /// (complementary upsert). Safe under concurrent session stops on the same profile.
    /// </summary>
    Task<bool> MergeSessionExportAsync(
        Guid profileId,
        SessionState export,
        CancellationToken ct = default);

    Task TouchLastUsedAsync(Guid profileId, CancellationToken ct = default);

    Task<IReadOnlyList<Guid>> ListExpiredInactiveAsync(
        DateTimeOffset olderThan,
        int take,
        IReadOnlySet<Guid> excludeLiveProfileIds,
        CancellationToken ct = default);

    Task<ProfileSummary?> GetSummaryAsync(Guid profileId, CancellationToken ct = default);

    Task<(IReadOnlyList<ProfileListItem> Items, int Total)> ListAsync(
        ListProfiles query,
        CancellationToken ct = default);

    Task<bool> DeleteAsync(Guid profileId, CancellationToken ct = default);
}
