using Speculum.Api.BrowserSessions.Models;

namespace Speculum.Api.BrowserProfiles.Aggregates;

public class ProfileState
{
    /// <summary>
    /// Absorbs a session export into this profile bucket.
    /// Schema TBD — no-op until state fields exist.
    /// </summary>
    public void MergeFrom(SessionState export)
    {
        _ = export;
    }
}
