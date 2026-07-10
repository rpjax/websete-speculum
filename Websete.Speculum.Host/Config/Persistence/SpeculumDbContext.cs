using Microsoft.EntityFrameworkCore;

namespace Websete.Speculum.Host.Config.Persistence;

public sealed class SpeculumDbContext : DbContext
{
    public DbSet<ConfigSectionEntity> ConfigSections => Set<ConfigSectionEntity>();

    private readonly string _databasePath;

    public SpeculumDbContext(string databasePath)
    {
        _databasePath = databasePath;
    }

    public SpeculumDbContext(DbContextOptions<SpeculumDbContext> options) : base(options)
    {
        _databasePath = "";
    }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        if (!optionsBuilder.IsConfigured)
        {
            var directory = Path.GetDirectoryName(_databasePath);
            if (!string.IsNullOrEmpty(directory))
                Directory.CreateDirectory(directory);

            optionsBuilder.UseSqlite($"Data Source={_databasePath}");
        }
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ConfigSectionEntity>(entity =>
        {
            entity.ToTable("config_sections");
            entity.HasKey(e => e.Key);
            entity.Property(e => e.Key).HasColumnName("key");
            entity.Property(e => e.ValueJson).HasColumnName("value_json");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
        });
    }
}
