namespace Speculum.Api.Profiles.Requests;

/// <summary>Column the operator listing can sort on — mirrors the exact-match/sort shape used by ListSessions.</summary>
public enum ProfileSortBy
{
    CreatedAt = 0,
    LastUsedAt = 1,
}

/// <summary>Paged, filterable operator query over persisted profiles (id + timestamps only).</summary>
public sealed class ListProfiles
{
    public const int DefaultTake = 50;
    public const int MaxTake = 200;

    public int Skip { get; set; }

    public int Take { get; set; } = DefaultTake;

    /// <summary>Exact-match filter — same "no free-text substring on Guid columns" rule as ListSessions.</summary>
    public Guid? ProfileId { get; set; }

    public ProfileSortBy SortBy { get; set; } = ProfileSortBy.CreatedAt;

    public bool SortDescending { get; set; } = true;
}
