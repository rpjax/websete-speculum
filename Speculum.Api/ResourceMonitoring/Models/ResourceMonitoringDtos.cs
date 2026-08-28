using Speculum.Api.Telemetry.Events.Models.Sampling;

namespace Speculum.Api.ResourceMonitoring.Models;

public sealed class ResourceChartHint
{
    public DateTimeOffset From { get; init; }
    public DateTimeOffset To { get; init; }
    public IReadOnlyList<string> MetricKeys { get; init; } = Array.Empty<string>();
}

public sealed class ResourceSignalDto
{
    public Guid Id { get; init; }
    public ResourceSignalKind Kind { get; init; }
    public ResourceSignalSeverity Severity { get; init; }
    public ResourceSignalStatus Status { get; init; }
    public string Phase { get; init; } = "";
    public string Summary { get; init; } = "";
    public DateTimeOffset DetectedAt { get; init; }
    public DateTimeOffset? ResolvedAt { get; init; }
    public IReadOnlyList<Guid> EvidenceSampleIds { get; init; } = Array.Empty<Guid>();
    public IReadOnlyDictionary<string, double?> Metrics { get; init; }
        = new Dictionary<string, double?>();
    public ResourceChartHint? ChartHint { get; init; }
}

public sealed class ResourceReportChapterDto
{
    public string Title { get; init; } = "";
    public string Body { get; init; } = "";
    public IReadOnlyList<Guid>? RelatedSignalIds { get; init; }
    public IReadOnlyList<Guid>? RelatedSampleIds { get; init; }
    public IReadOnlyDictionary<string, ResourceSeriesStatDto>? SeriesSummary { get; init; }
}

public sealed class ResourceSeriesStatDto
{
    public double? Min { get; init; }
    public double? Avg { get; init; }
    public double? Max { get; init; }
    public double? Last { get; init; }
}

public sealed class ResourceReportErrorDto
{
    public string ErrorCode { get; init; } = "";
    public string Phase { get; init; } = "";
}

public sealed class ResourceReportDto
{
    public Guid Id { get; init; }
    public ResourceReportKind Kind { get; init; }
    public ResourceReportStatus Status { get; init; }
    public DateTimeOffset From { get; init; }
    public DateTimeOffset To { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? ReadyAt { get; init; }
    public string Summary { get; init; } = "";
    public IReadOnlyList<ResourceReportChapterDto> Chapters { get; init; }
        = Array.Empty<ResourceReportChapterDto>();
    public ResourceReportErrorDto? Error { get; init; }
}

public sealed class CreateResourceReportRequest
{
    public ResourceReportKind Kind { get; init; }
    public DateTimeOffset From { get; init; }
    public DateTimeOffset To { get; init; }
}

public sealed class ResourceSectionReadiness
{
    public bool Host { get; init; }
    public bool ApiProcess { get; init; }
    public bool Sessions { get; init; }
    public bool Sidecar { get; init; }
    public bool Profiles { get; init; }
    public bool Journal { get; init; }
    public bool Docker { get; init; }
}

public sealed class ResourceLatestResponse
{
    public bool TelemetryEnabled { get; init; }
    public SampleCollected? Sample { get; init; }
    public ResourceSectionReadiness Sections { get; init; } = new();
    public DateTimeOffset CollectedAt { get; init; }
}

public sealed class ResourceHistoryItem
{
    public Guid Id { get; init; }
    public long Sequence { get; init; }
    public DateTimeOffset PublishedAt { get; init; }
    public SampleCollected Sample { get; init; } = null!;
}

public sealed class ResourceHistoryResponse
{
    public IReadOnlyList<ResourceHistoryItem> Items { get; init; } = Array.Empty<ResourceHistoryItem>();
    public string? NextCursor { get; init; }
    public int? BucketSeconds { get; init; }
}

public sealed class ResourceListResponse<T>
{
    public IReadOnlyList<T> Items { get; init; } = Array.Empty<T>();
    public int Total { get; init; }
}
