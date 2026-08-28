using System.Text.Json;
using System.Text.Json.Serialization;
using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Storage;

namespace Speculum.Api.ResourceMonitoring.Storage;

internal static class ResourceMonitoringJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static ResourceSignalDto ToDto(ResourceSignalRecord record)
    {
        var evidence = JsonSerializer.Deserialize<List<Guid>>(record.EvidenceSampleIdsJson, Options)
            ?? new List<Guid>();
        var metrics = JsonSerializer.Deserialize<Dictionary<string, double?>>(record.MetricsJson, Options)
            ?? new Dictionary<string, double?>();
        ResourceChartHint? hint = null;
        if (!string.IsNullOrWhiteSpace(record.ChartHintJson))
            hint = JsonSerializer.Deserialize<ResourceChartHint>(record.ChartHintJson, Options);

        return new ResourceSignalDto
        {
            Id = record.Id,
            Kind = DeserializeEnum<ResourceSignalKind>(record.Kind),
            Severity = DeserializeEnum<ResourceSignalSeverity>(record.Severity),
            Status = DeserializeEnum<ResourceSignalStatus>(record.Status),
            Phase = record.Phase,
            Summary = record.Summary,
            DetectedAt = record.DetectedAt,
            ResolvedAt = record.ResolvedAt,
            EvidenceSampleIds = evidence,
            Metrics = metrics,
            ChartHint = hint,
        };
    }

    public static ResourceReportDto ToDto(ResourceReportRecord record)
    {
        var chapters = JsonSerializer.Deserialize<List<ResourceReportChapterDto>>(record.ChaptersJson, Options)
            ?? new List<ResourceReportChapterDto>();
        ResourceReportErrorDto? error = null;
        if (!string.IsNullOrWhiteSpace(record.ErrorJson))
            error = JsonSerializer.Deserialize<ResourceReportErrorDto>(record.ErrorJson, Options);

        return new ResourceReportDto
        {
            Id = record.Id,
            Kind = DeserializeEnum<ResourceReportKind>(record.Kind),
            Status = DeserializeEnum<ResourceReportStatus>(record.Status),
            From = record.From,
            To = record.To,
            CreatedAt = record.CreatedAt,
            ReadyAt = record.ReadyAt,
            Summary = record.Summary,
            Chapters = chapters,
            Error = error,
        };
    }

    public static string SerializeEnum<TEnum>(TEnum value)
        where TEnum : struct, Enum
        => JsonSerializer.Serialize(value, Options).Trim('"');

    public static TEnum DeserializeEnum<TEnum>(string value)
        where TEnum : struct, Enum
        => JsonSerializer.Deserialize<TEnum>($"\"{value}\"", Options);
}
