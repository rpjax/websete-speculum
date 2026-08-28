namespace Speculum.Api.Profiles.Responses;

/// <summary>Detail projection including state bucket counts (one JSON parse).</summary>
public sealed class ProfileSummary
{
    public Guid ProfileId { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset LastUsedAt { get; init; }

    public int CookieCount { get; init; }

    public int LocalStorageCount { get; init; }

    public int IdbRecordCount { get; init; }

    public int HistoryCount { get; init; }
}
