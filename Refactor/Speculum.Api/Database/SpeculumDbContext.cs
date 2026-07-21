using Microsoft.EntityFrameworkCore;

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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SpeculumDbContext).Assembly);
    }
}
