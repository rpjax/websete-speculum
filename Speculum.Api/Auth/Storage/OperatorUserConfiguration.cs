using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Speculum.Api.Auth.Storage;

public sealed class OperatorUserConfiguration : IEntityTypeConfiguration<OperatorUserRecord>
{
    public void Configure(EntityTypeBuilder<OperatorUserRecord> builder)
    {
        builder.HasIndex(u => u.Username).IsUnique();
        builder.Property(u => u.Username).HasMaxLength(128);
        builder.Property(u => u.PasswordHash).HasMaxLength(512);
    }
}
