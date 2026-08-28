using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Speculum.Api.HostResources.Storage;

public sealed class HostResourceApplyConfiguration : IEntityTypeConfiguration<HostResourceApplyRecord>
{
    private static readonly ValueConverter<DateTimeOffset, string> IsoOffsetConverter = new(
        v => v.UtcDateTime.ToString("O"),
        v => DateTimeOffset.Parse(v, null, System.Globalization.DateTimeStyles.RoundtripKind));

    public void Configure(EntityTypeBuilder<HostResourceApplyRecord> builder)
    {
        builder.Property(p => p.HostSource)
            .IsRequired();

        builder.Property(p => p.WarningsJson)
            .IsRequired();

        builder.Property(p => p.AppliedAtUtc)
            .HasConversion(IsoOffsetConverter)
            .IsRequired();
    }
}
