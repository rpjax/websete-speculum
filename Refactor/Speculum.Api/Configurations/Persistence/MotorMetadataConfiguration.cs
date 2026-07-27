using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Speculum.Api.Configurations.Persistence;

public sealed class MotorMetadataConfiguration : IEntityTypeConfiguration<MotorMetadataRecord>
{
    public void Configure(EntityTypeBuilder<MotorMetadataRecord> builder)
    {
        builder.ToTable("motor_metadata");
        builder.HasKey(x => x.Key);
        builder.Property(x => x.Key).HasMaxLength(128).IsRequired();
        builder.Property(x => x.Value);
        builder.Property(x => x.UpdatedAt).IsRequired();
    }
}
