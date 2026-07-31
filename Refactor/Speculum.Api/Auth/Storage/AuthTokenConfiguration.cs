using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Speculum.Api.Auth.Storage;

public sealed class AuthTokenConfiguration : IEntityTypeConfiguration<AuthTokenRecord>
{
    public void Configure(EntityTypeBuilder<AuthTokenRecord> builder)
    {
        builder.HasIndex(t => t.TokenHash).IsUnique();
        builder.HasIndex(t => new { t.UserId, t.Kind });
        builder.Property(t => t.Kind).HasMaxLength(16);
        builder.Property(t => t.TokenHash).HasMaxLength(128);
    }
}
