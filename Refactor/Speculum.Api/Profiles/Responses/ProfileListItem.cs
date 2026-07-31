namespace Speculum.Api.Profiles.Responses;

/// <summary>List projection — no state deserialization.</summary>
public sealed class ProfileListItem
{
    public Guid ProfileId { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset LastUsedAt { get; init; }
}
