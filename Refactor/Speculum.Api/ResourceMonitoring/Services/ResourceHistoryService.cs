using System.Text.Json;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services.Contracts;
using Speculum.Api.Telemetry;
using Speculum.Api.Telemetry.Events.Models.Sampling;
using Speculum.Api.Telemetry.Models;

namespace Speculum.Api.ResourceMonitoring.Services;

public sealed class ResourceHistoryService(
    ITelemetrySampleComposer composer,
    IConfigurationService configuration,
    IJournalReader journalReader,
    TimeProvider time) : IResourceHistoryService
{
    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public const int DefaultHistoryLimit = 500;
    public const int MaxHistoryLimit = 2000;

    public async Task<ResourceLatestResponse> GetLatestAsync(CancellationToken ct = default)
    {
        var telemetry = configuration.GetCurrent().Telemetry;
        var collectedAt = time.GetUtcNow();
        var readiness = new ResourceSectionReadiness
        {
            Host = telemetry.Host.IsEnabled,
            ApiProcess = telemetry.ApiProcess.IsEnabled,
            Sessions = telemetry.Sessions.IsEnabled,
            Sidecar = telemetry.Sidecar.IsEnabled,
            Profiles = telemetry.Profiles.IsEnabled,
            Journal = telemetry.Journal.IsEnabled,
            Docker = telemetry.Docker.IsEnabled,
        };

        if (!telemetry.IsEnabled)
        {
            return new ResourceLatestResponse
            {
                TelemetryEnabled = false,
                Sample = null,
                Sections = readiness,
                CollectedAt = collectedAt,
            };
        }

        var sample = await composer.ComposeAsync(telemetry, ct).ConfigureAwait(false);
        return new ResourceLatestResponse
        {
            TelemetryEnabled = true,
            Sample = sample,
            Sections = readiness,
            CollectedAt = collectedAt,
        };
    }

    public async Task<ResourceHistoryResponse> GetHistoryAsync(
        DateTimeOffset from,
        DateTimeOffset to,
        int? limit,
        int? bucketSeconds,
        string? cursor,
        CancellationToken ct = default)
    {
        if (to < from)
            throw new ArgumentException("to must be >= from.");

        var take = Math.Clamp(limit ?? DefaultHistoryLimit, 1, MaxHistoryLimit);
        long? afterSequence = null;
        if (!string.IsNullOrWhiteSpace(cursor)
            && long.TryParse(cursor, System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out var seq))
        {
            afterSequence = seq;
        }

        // Fetch extra when bucketing so we can still fill the window.
        var readLimit = bucketSeconds is > 0 ? Math.Min(MaxHistoryLimit, take * 4) : take;

        var entries = await journalReader.ReadAsync(new JournalQuery
        {
            Limit = readLimit,
            Filter = new JournalQueryFilter
            {
                Type = TelemetryJournalFacts.SampleCollected,
                PublishedSince = from,
                PublishedUntil = to,
                AfterSequence = afterSequence,
            },
            Orders =
            [
                new JournalQueryOrder
                {
                    Property = JournalOrderProperty.PublishedAt,
                    Direction = JournalSortDirection.Ascending,
                },
            ],
        }, ct).ConfigureAwait(false);

        var items = new List<ResourceHistoryItem>(entries.Count);
        foreach (var entry in entries)
        {
            var sample = TryDeserialize(entry.Payload);
            if (sample is null)
                continue;

            items.Add(new ResourceHistoryItem
            {
                Id = entry.Id,
                Sequence = entry.Sequence,
                PublishedAt = entry.PublishedAt,
                Sample = sample,
            });
        }

        int? effectiveBucket = null;
        if (bucketSeconds is > 0)
        {
            effectiveBucket = Math.Clamp(bucketSeconds.Value, 30, 3600);
            items = Bucket(items, effectiveBucket.Value, take);
        }
        else if (items.Count > take)
        {
            items = items.Take(take).ToList();
        }

        string? nextCursor = null;
        if (entries.Count >= readLimit && entries.Count > 0)
            nextCursor = entries[^1].Sequence.ToString(System.Globalization.CultureInfo.InvariantCulture);

        return new ResourceHistoryResponse
        {
            Items = items,
            NextCursor = nextCursor,
            BucketSeconds = effectiveBucket,
        };
    }

    internal static SampleCollected? TryDeserialize(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload))
            return null;

        try
        {
            return JsonSerializer.Deserialize<SampleCollected>(payload, PayloadOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static List<ResourceHistoryItem> Bucket(
        IReadOnlyList<ResourceHistoryItem> items,
        int bucketSeconds,
        int maxBuckets)
    {
        if (items.Count == 0)
            return new List<ResourceHistoryItem>();

        var bucketTicks = TimeSpan.FromSeconds(bucketSeconds).Ticks;
        var groups = items
            .GroupBy(i => i.PublishedAt.UtcTicks / bucketTicks)
            .OrderBy(g => g.Key)
            .Take(maxBuckets);

        var result = new List<ResourceHistoryItem>();
        foreach (var group in groups)
        {
            var list = group.ToList();
            var last = list[^1];
            result.Add(new ResourceHistoryItem
            {
                Id = last.Id,
                Sequence = last.Sequence,
                PublishedAt = last.PublishedAt,
                Sample = AggregateSamples(list.Select(x => x.Sample).ToList()),
            });
        }

        return result;
    }

    private static SampleCollected AggregateSamples(IReadOnlyList<SampleCollected> samples)
    {
        if (samples.Count == 1)
            return samples[0];

        var last = samples[^1];
        return new SampleCollected(
            AggregateHost(samples),
            AggregateApi(samples),
            last.Sessions,
            last.Sidecar,
            last.Profiles,
            last.Journal,
            last.Docker);
    }

    private static HostTelemetry? AggregateHost(IReadOnlyList<SampleCollected> samples)
    {
        var hosts = samples.Select(s => s.Host).Where(h => h is not null).Cast<HostTelemetry>().ToList();
        if (hosts.Count == 0)
            return null;

        var last = hosts[^1];
        return last with
        {
            CpuUsage = hosts.Average(h => h.CpuUsage),
            MemoryUsed = (long)hosts.Average(h => h.MemoryUsed),
            MemoryAvailable = (long)hosts.Average(h => h.MemoryAvailable),
            DiskFreeBytes = (long)hosts.Average(h => h.DiskFreeBytes),
        };
    }

    private static ApiProcessTelemetry? AggregateApi(IReadOnlyList<SampleCollected> samples)
    {
        var apis = samples.Select(s => s.ApiProcess).Where(a => a is not null).Cast<ApiProcessTelemetry>().ToList();
        if (apis.Count == 0)
            return null;

        var last = apis[^1];
        return last with
        {
            CpuUsage = apis.Average(a => a.CpuUsage),
            MemoryUsed = (long)apis.Average(a => a.MemoryUsed),
        };
    }
}
