using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Profiles.Aggregates;

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
    /// Absorbs a session export into this profile bucket (complementary upsert).
    /// Same-key entries are replaced; new keys expand the record. Nothing is wiped
    /// just because the export omitted it.
    /// </summary>
    public void MergeFrom(SessionState export)
    {
        ArgumentNullException.ThrowIfNull(export);

        foreach (var cookie in export.Cookies)
            UpsertCookie(cookie);

        foreach (var entry in export.LocalStorage)
            UpsertLocalStorage(entry);

        foreach (var record in export.IdbRecords)
            UpsertIdb(record);

        foreach (var visit in export.History)
            UpsertHistory(visit);
    }

    private void UpsertCookie(BrowserCookieState cookie)
    {
        for (var i = 0; i < Cookies.Count; i++)
        {
            var existing = Cookies[i];
            if (string.Equals(existing.Name, cookie.Name, StringComparison.Ordinal)
                && string.Equals(existing.Domain, cookie.Domain, StringComparison.OrdinalIgnoreCase)
                && string.Equals(existing.Path, cookie.Path, StringComparison.Ordinal))
            {
                Cookies[i] = cookie;
                return;
            }
        }

        Cookies.Add(cookie);
    }

    private void UpsertLocalStorage(BrowserLocalStorageState entry)
    {
        for (var i = 0; i < LocalStorage.Count; i++)
        {
            var existing = LocalStorage[i];
            if (string.Equals(existing.Origin, entry.Origin, StringComparison.Ordinal)
                && string.Equals(existing.Key, entry.Key, StringComparison.Ordinal))
            {
                LocalStorage[i] = entry;
                return;
            }
        }

        LocalStorage.Add(entry);
    }

    private void UpsertIdb(BrowserIdbRecordState record)
    {
        for (var i = 0; i < IdbRecords.Count; i++)
        {
            var existing = IdbRecords[i];
            if (string.Equals(existing.Origin, record.Origin, StringComparison.Ordinal)
                && string.Equals(existing.DatabaseName, record.DatabaseName, StringComparison.Ordinal)
                && string.Equals(existing.StoreName, record.StoreName, StringComparison.Ordinal)
                && string.Equals(existing.KeyJson, record.KeyJson, StringComparison.Ordinal))
            {
                IdbRecords[i] = record;
                return;
            }
        }

        IdbRecords.Add(record);
    }

    private void UpsertHistory(BrowserHistoryState visit)
    {
        for (var i = 0; i < History.Count; i++)
        {
            var existing = History[i];
            if (!string.Equals(existing.Url, visit.Url, StringComparison.Ordinal))
                continue;

            // Same URL: keep the newer visit.
            if (visit.VisitedAtMs >= existing.VisitedAtMs)
                History[i] = visit;
            return;
        }

        History.Add(visit);
    }
}
