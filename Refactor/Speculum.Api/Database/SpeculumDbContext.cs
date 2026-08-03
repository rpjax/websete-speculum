using Microsoft.EntityFrameworkCore;
using Speculum.Api.Auth.Storage;
using Speculum.Api.HostResources.Storage;
using Speculum.Api.Profiles.Storage;
using Speculum.Api.ResourceMonitoring.Storage;
using Speculum.Api.Scripts.Storage;
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

    public DbSet<ScriptRecord> Scripts => Set<ScriptRecord>();

    public DbSet<HostResourceApplyRecord> HostResourceApplies => Set<HostResourceApplyRecord>();

    public DbSet<OperatorUserRecord> OperatorUsers => Set<OperatorUserRecord>();

    public DbSet<AuthTokenRecord> AuthTokens => Set<AuthTokenRecord>();

    public DbSet<ResourceSignalRecord> ResourceSignals => Set<ResourceSignalRecord>();

    public DbSet<ResourceReportRecord> ResourceReports => Set<ResourceReportRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SpeculumDbContext).Assembly);
    }
}
