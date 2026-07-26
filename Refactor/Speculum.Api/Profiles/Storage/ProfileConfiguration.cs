using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Speculum.Api.Profiles.Storage;

public sealed class ProfileConfiguration : IEntityTypeConfiguration<ProfileRecord>
{
    private static readonly ValueConverter<DateTimeOffset, string> IsoOffsetConverter = new(
        v => v.UtcDateTime.ToString("O"),
        v => DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    public void Configure(EntityTypeBuilder<ProfileRecord> builder)
    {
        builder.Property(p => p.StateJson)
            .IsRequired();

        // SQLite cannot ORDER BY DateTimeOffset; store as round-trip UTC text.
        builder.Property(p => p.CreatedAt)
            .HasConversion(IsoOffsetConverter)
            .IsRequired();

        builder.Property(p => p.UpdatedAt)
            .HasConversion(IsoOffsetConverter)
            .IsRequired();
    }
}

