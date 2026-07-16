namespace Speculum.Api.BrowserPersistence;

/// <summary>
/// Merges CDP navigation exports into a durable session timeline.
/// Chromium profiles are ephemeral on reattach, so each export is only the
/// latest live stack — this helper accumulates rather than replacing.
/// </summary>
internal static class BrowserHistoryMerge
{
    public const int DefaultMaxEntries = 500;

    public static IReadOnlyList<BrowserHistoryState> Merge(
        IReadOnlyList<BrowserHistoryState> existing,
        IReadOnlyList<BrowserHistoryState> exported,
        int maxEntries = DefaultMaxEntries)
    {
        if (maxEntries < 1)
            throw new ArgumentOutOfRangeException(nameof(maxEntries), maxEntries, "Must be >= 1.");

        // Fresh Chromium stacks often start with about:blank — drop non-http noise from the export only.
        var incoming = FilterPersistable(exported);
        if (incoming.Count == 0)
            return CapAndReindex(existing, maxEntries);

        if (existing.Count == 0)
            return CapAndReindex(incoming, maxEntries);

        // Overlap by URL only: reattach stacks reuse the tip URL with a different CDP transitionType.
        var overlap = LongestSuffixPrefixOverlap(existing, incoming);
        var merged = new List<BrowserHistoryState>(existing.Count + incoming.Count - overlap);
        merged.AddRange(existing);
        for (var i = overlap; i < incoming.Count; i++)
            merged.Add(incoming[i]);

        return CapAndReindex(merged, maxEntries);
    }

    private static List<BrowserHistoryState> FilterPersistable(IReadOnlyList<BrowserHistoryState> exported)
    {
        var list = new List<BrowserHistoryState>(exported.Count);
        foreach (var e in exported)
        {
            if (IsPersistableUrl(e.Url))
                list.Add(e);
        }

        return list;
    }

    private static bool IsPersistableUrl(string url)
        => url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
           || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

    private static int LongestSuffixPrefixOverlap(
        IReadOnlyList<BrowserHistoryState> existing,
        IReadOnlyList<BrowserHistoryState> exported)
    {
        var max = Math.Min(existing.Count, exported.Count);
        for (var len = max; len >= 1; len--)
        {
            var match = true;
            for (var i = 0; i < len; i++)
            {
                if (!SameUrl(existing[existing.Count - len + i], exported[i]))
                {
                    match = false;
                    break;
                }
            }

            if (match)
                return len;
        }

        return 0;
    }

    private static bool SameUrl(BrowserHistoryState a, BrowserHistoryState b)
        => string.Equals(a.Url, b.Url, StringComparison.Ordinal);

    private static IReadOnlyList<BrowserHistoryState> CapAndReindex(
        IReadOnlyList<BrowserHistoryState> entries,
        int maxEntries)
    {
        IReadOnlyList<BrowserHistoryState> capped = entries.Count <= maxEntries
            ? entries
            : entries.Skip(entries.Count - maxEntries).ToList();

        var result = new List<BrowserHistoryState>(capped.Count);
        for (var i = 0; i < capped.Count; i++)
        {
            var e = capped[i];
            result.Add(new BrowserHistoryState
            {
                Url            = e.Url,
                Title          = e.Title,
                VisitedAtMs    = e.VisitedAtMs,
                TransitionType = e.TransitionType,
                IndexOrder     = i,
            });
        }

        return result;
    }
}
