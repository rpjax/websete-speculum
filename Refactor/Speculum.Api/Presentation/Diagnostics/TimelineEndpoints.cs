using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Presentation.Diagnostics;

/// <summary>
/// Admin timeline over durable Journal facts (operational event log).
/// Not the legacy Diagnostics ring-buffer <c>/events</c> contract.
/// </summary>
public static class TimelineEndpoints
{
    private const int DefaultLimit = 200;
    private const int MaxLimit = 500;

    public static IEndpointRouteBuilder MapTimelineEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var g = endpoints.MapGroup("/api/admin/diagnostics/v1").WithTags("Diagnostics.Timeline");

        g.MapGet("/timeline", async (
            DateTimeOffset? since,
            DateTimeOffset? until,
            string? type,
            string? typePrefix,
            string? sessionId,
            long? afterSequence,
            long? beforeSequence,
            int? limit,
            IJournalReader journal,
            CancellationToken ct) =>
        {
            var take = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);
            // Over-fetch when prefix-filtering in memory so the page still fills.
            var readLimit = string.IsNullOrWhiteSpace(typePrefix) ? take : Math.Min(MaxLimit, take * 4);

            var indexKeys = new List<JournalIndexKey>();
            if (!string.IsNullOrWhiteSpace(sessionId))
                indexKeys.Add(new JournalIndexKey("session", sessionId.Trim()));

            var filter = new JournalQueryFilter
            {
                PublishedSince = since,
                PublishedUntil = until,
                AfterSequence = afterSequence,
                BeforeSequence = beforeSequence,
                Type = string.IsNullOrWhiteSpace(type) ? null : type.Trim(),
                IndexKeys = indexKeys,
            };

            IReadOnlyList<JournalEntry> entries;
            try
            {
                entries = await journal.ReadAsync(
                    new JournalQuery
                    {
                        Limit = readLimit,
                        Filter = filter,
                        Orders =
                        [
                            new JournalQueryOrder
                            {
                                Property = JournalOrderProperty.Sequence,
                                Direction = JournalSortDirection.Descending,
                            },
                        ],
                    },
                    ct).ConfigureAwait(false);
            }
            catch (ArgumentOutOfRangeException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }

            var prefix = typePrefix?.Trim();
            IEnumerable<JournalEntry> filtered = entries;
            if (!string.IsNullOrEmpty(prefix))
            {
                filtered = filtered.Where(e =>
                    e.Type.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
            }

            var page = filtered.Take(take).ToArray();
            var items = page.Select(ToDto).ToArray();

            long? nextBeforeSequence = page.Length == 0
                ? null
                : page[^1].Sequence;

            long? latestSequence = page.Length == 0
                ? null
                : page[0].Sequence;

            return Results.Ok(new
            {
                items,
                latestSequence,
                nextBeforeSequence,
                truncated = entries.Count >= readLimit,
            });
        });

        return endpoints;
    }

    private static TimelineEventDto ToDto(JournalEntry entry)
    {
        var keys = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var key in entry.IndexKeys)
            keys[key.Type] = key.Value;

        object? payload = null;
        if (!string.IsNullOrWhiteSpace(entry.Payload))
        {
            try
            {
                payload = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(entry.Payload);
            }
            catch (System.Text.Json.JsonException)
            {
                payload = entry.Payload;
            }
        }

        return new TimelineEventDto(
            entry.Id.ToString("D"),
            entry.Sequence,
            entry.PublishedAt,
            entry.Type,
            entry.SchemaVersion,
            entry.PublishPolicy.ToString(),
            keys,
            payload);
    }

    private sealed record TimelineEventDto(
        string Id,
        long Sequence,
        DateTimeOffset PublishedAt,
        string Type,
        int SchemaVersion,
        string PublishPolicy,
        IReadOnlyDictionary<string, string> IndexKeys,
        object? Payload);
}
