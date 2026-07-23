using Microsoft.EntityFrameworkCore;
using Speculum.Api.Profiles.Storage;
using Speculum.Api.Sessions.Storage;

namespace Speculum.Api.Database;

/// <summary>
/// Unified Speculum SQLite store. Domain modules contribute entities via
/// <see cref="IEntityTypeConfiguration{TEntity}"/> in this assembly.
/// </summary>
public sealed class SpeculumDbContext : DbContext
{
    public SpeculumDbContext(DbContextOptions<SpeculumDbContext> options)
        : base(options)
    {
    }

    public DbSet<SessionRecord> Sessions => Set<SessionRecord>();

    public DbSet<ProfileRecord> Profiles => Set<ProfileRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SpeculumDbContext).Assembly);
    }
}
