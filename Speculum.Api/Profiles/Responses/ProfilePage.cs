namespace Speculum.Api.Profiles.Responses;

public sealed class ProfilePage
{
    public required IReadOnlyList<ProfileListItem> Items { get; init; }

    public int Total { get; init; }
}
