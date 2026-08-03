using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Speculum.Api.ResourceMonitoring.Storage;

public sealed class ResourceReportConfiguration : IEntityTypeConfiguration<ResourceReportRecord>
{
    private static readonly ValueConverter<DateTimeOffset, string> IsoOffsetConverter = new(
        v => v.UtcDateTime.ToString("O"),
        v => DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    private static readonly ValueConverter<DateTimeOffset?, string?> NullableIsoOffsetConverter = new(
        v => v.HasValue ? v.Value.UtcDateTime.ToString("O") : null,
        v => string.IsNullOrEmpty(v)
            ? null
            : DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    public void Configure(EntityTypeBuilder<ResourceReportRecord> builder)
    {
        builder.Property(p => p.Kind).IsRequired();
        builder.Property(p => p.Status).IsRequired();
        builder.Property(p => p.Summary).IsRequired();
        builder.Property(p => p.ChaptersJson).IsRequired();
        builder.Property(p => p.From).HasConversion(IsoOffsetConverter).IsRequired();
        builder.Property(p => p.To).HasConversion(IsoOffsetConverter).IsRequired();
        builder.Property(p => p.CreatedAt).HasConversion(IsoOffsetConverter).IsRequired();
        builder.Property(p => p.ReadyAt).HasConversion(NullableIsoOffsetConverter);

        builder.HasIndex(p => p.CreatedAt);
    }
}
