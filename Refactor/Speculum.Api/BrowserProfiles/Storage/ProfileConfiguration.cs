using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Speculum.Api.BrowserProfiles.Storage;

public sealed class ProfileConfiguration : IEntityTypeConfiguration<ProfileRecord>
{
    public void Configure(EntityTypeBuilder<ProfileRecord> builder)
    {
        builder.Property(p => p.StateJson)
            .IsRequired();
    }
}
