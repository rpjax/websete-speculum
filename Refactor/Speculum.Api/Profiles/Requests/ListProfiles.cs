namespace Speculum.Api.Profiles.Requests;

/// <summary>Paged operator query over persisted profiles (id + timestamps only).</summary>
public sealed class ListProfiles
{
    public const int DefaultTake = 50;
    public const int MaxTake = 200;

    public int Skip { get; set; }

    public int Take { get; set; } = DefaultTake;
}
