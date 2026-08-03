using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Speculum.Api.ResourceMonitoring.Storage;

public sealed class ResourceSignalConfiguration : IEntityTypeConfiguration<ResourceSignalRecord>
{
    private static readonly ValueConverter<DateTimeOffset, string> IsoOffsetConverter = new(
        v => v.UtcDateTime.ToString("O"),
        v => DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    private static readonly ValueConverter<DateTimeOffset?, string?> NullableIsoOffsetConverter = new(
        v => v.HasValue ? v.Value.UtcDateTime.ToString("O") : null,
        v => string.IsNullOrEmpty(v)
            ? null
            : DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    public void Configure(EntityTypeBuilder<ResourceSignalRecord> builder)
    {
        builder.Property(p => p.Kind).IsRequired();
        builder.Property(p => p.Severity).IsRequired();
        builder.Property(p => p.Status).IsRequired();
        builder.Property(p => p.Phase).IsRequired();
        builder.Property(p => p.Summary).IsRequired();
        builder.Property(p => p.EvidenceSampleIdsJson).IsRequired();
        builder.Property(p => p.MetricsJson).IsRequired();
        builder.Property(p => p.DetectedAt).HasConversion(IsoOffsetConverter).IsRequired();
        builder.Property(p => p.ResolvedAt).HasConversion(NullableIsoOffsetConverter);

        builder.HasIndex(p => new { p.Status, p.DetectedAt });
        builder.HasIndex(p => new { p.Kind, p.Status });
    }
}
