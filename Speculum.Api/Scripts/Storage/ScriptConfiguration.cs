using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Speculum.Api.Scripts.Storage;

public sealed class ScriptConfiguration : IEntityTypeConfiguration<ScriptRecord>
{
    private static readonly ValueConverter<DateTimeOffset, string> IsoOffsetConverter = new(
        v => v.UtcDateTime.ToString("O"),
        v => DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    public void Configure(EntityTypeBuilder<ScriptRecord> builder)
    {
        builder.Property(p => p.Name)
            .IsRequired();

        builder.Property(p => p.Content)
            .IsRequired();

        builder.Property(p => p.Sha256)
            .IsRequired();

        builder.Property(p => p.CreatedAtUtc)
            .HasConversion(IsoOffsetConverter)
            .IsRequired();

        builder.Property(p => p.UpdatedAtUtc)
            .HasConversion(IsoOffsetConverter)
            .IsRequired();

        builder.HasIndex(p => p.Name);
        builder.HasIndex(p => p.Sha256);
    }
}
