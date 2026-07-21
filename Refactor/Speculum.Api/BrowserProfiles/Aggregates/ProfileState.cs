using Speculum.Api.BrowserSessions.Models;

namespace Speculum.Api.BrowserProfiles.Aggregates;

/// <summary>
/// Durable browser state owned by a <see cref="Profile"/>.
/// </summary>
public sealed class ProfileState
{
    public List<BrowserCookieState> Cookies { get; } = [];

    public List<BrowserLocalStorageState> LocalStorage { get; } = [];

    public List<BrowserIdbRecordState> IdbRecords { get; } = [];

    public List<BrowserHistoryState> History { get; } = [];

    /// <summary>
    /// Absorbs a session export into this profile bucket.
    /// Replace strategy: each bucket is cleared then replaced by the export snapshot.
    /// </summary>
    public void MergeFrom(SessionState export)
    {
        ArgumentNullException.ThrowIfNull(export);

        Cookies.Clear();
        Cookies.AddRange(export.Cookies);

        LocalStorage.Clear();
        LocalStorage.AddRange(export.LocalStorage);

        IdbRecords.Clear();
        IdbRecords.AddRange(export.IdbRecords);

        History.Clear();
        History.AddRange(export.History);
    }
}
