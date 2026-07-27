using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Speculum.Api.Configurations.Persistence;

public sealed class ConfigSectionConfiguration : IEntityTypeConfiguration<ConfigSectionRecord>
{
    public void Configure(EntityTypeBuilder<ConfigSectionRecord> builder)
    {
        builder.ToTable("config_sections");
        builder.HasKey(x => x.Key);
        builder.Property(x => x.Key).HasMaxLength(128).IsRequired();
        builder.Property(x => x.ValueJson);
        builder.Property(x => x.UpdatedAt).IsRequired();
    }
}
