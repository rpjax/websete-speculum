using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Speculum.Api.Sessions.Storage;

public sealed class SessionConfiguration : IEntityTypeConfiguration<SessionRecord>
{
    // SQLite cannot ORDER BY DateTimeOffset — store as round-trip UTC text (same
    // convention as ProfileConfiguration).
    private static readonly ValueConverter<DateTimeOffset, string> IsoOffsetConverter = new(
        v => v.UtcDateTime.ToString("O"),
        v => DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    private static readonly ValueConverter<DateTimeOffset?, string?> NullableIsoOffsetConverter = new(
        v => v.HasValue ? v.Value.UtcDateTime.ToString("O") : null,
        v => v == null
            ? null
            : DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    public void Configure(EntityTypeBuilder<SessionRecord> builder)
    {
        builder.Property(s => s.State)
            .HasConversion<int>();

        builder.Property(s => s.CreatedAt)
            .HasConversion(IsoOffsetConverter)
            .IsRequired();

        builder.Property(s => s.StoppedAt)
            .HasConversion(NullableIsoOffsetConverter);

        builder.Property(s => s.AbortedAt)
            .HasConversion(NullableIsoOffsetConverter);

        builder.Property(s => s.StopReason)
            .HasConversion<int?>();

        builder.Property(s => s.MirrorMode)
            .HasConversion<int?>();
    }
}
