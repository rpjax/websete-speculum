using Speculum.Api.BrowserSessions.Models;

namespace Speculum.Api.BrowserProfiles.Aggregates;

public sealed class Profile
{
    public Guid Id { get; private set; }
    public ProfileState State { get; private set; } = new();

    public static Profile Create(Guid id)
        => new() { Id = id, State = new ProfileState() };

    internal static Profile Reconstitute(Guid id, ProfileState state)
        => new() { Id = id, State = state };

    /// <summary>
    /// Merges a live-session export into accumulated profile state.
    /// </summary>
    public void ApplySessionExport(SessionState export)
    {
        State.MergeFrom(export);
    }
}
