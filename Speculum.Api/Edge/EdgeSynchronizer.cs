using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Edge;

public sealed class EdgeSynchronizer : IEdgeSynchronizer
{
    private readonly Lazy<ISpeculumConfigStore> _configStore;
    private readonly BootstrapConfig _bootstrap;
    private readonly TraefikReloader _reloader;
    private readonly DevelopmentEdgeProfile _developmentProfile;
    private readonly ProductionEdgeProfile _productionProfile;
    private readonly ILogger<EdgeSynchronizer> _logger;
    private readonly string _traefikRoot;
    private readonly string _dynamicDir;
    private readonly string _certsDir;

    public EdgeSynchronizer(
        Lazy<ISpeculumConfigStore> configStore,
        BootstrapConfig bootstrap,
        TraefikReloader reloader,
        IConfiguration configuration,
        ILogger<EdgeSynchronizer> logger)
    {
        _configStore  = configStore;
        _bootstrap    = bootstrap;
        _reloader     = reloader;
        _logger       = logger;
        _developmentProfile = new DevelopmentEdgeProfile();
        _productionProfile  = new ProductionEdgeProfile();
        _traefikRoot = configuration["Traefik:Root"]?.Trim()
                       ?? Path.Combine(Path.GetDirectoryName(bootstrap.DatabasePath) ?? "/data", "traefik");
        _dynamicDir = configuration["Traefik:DynamicDir"]?.Trim()
                      ?? Path.Combine(_traefikRoot, "dynamic");
        _certsDir   = Path.Combine(_traefikRoot, "certs");
    }

    public async Task SynchronizeAsync(CancellationToken ct = default)
    {
        try
        {
            Directory.CreateDirectory(_dynamicDir);
            Directory.CreateDirectory(_certsDir);
            Directory.CreateDirectory(_traefikRoot);

            var hosting    = _configStore.Value.Current.Hosting;
            var forwarding = _configStore.Value.Current.Forwarding;

            var context = new EdgeMaterializationContext
            {
                DynamicDir  = _dynamicDir,
                TraefikRoot = _traefikRoot,
                CertsDir    = _certsDir,
                Hosting     = hosting,
                Forwarding  = forwarding,
            };

            var staticPath = Path.Combine(_traefikRoot, "traefik.static.yml");
            var staticBefore = File.Exists(staticPath) ? await File.ReadAllTextAsync(staticPath, ct) : null;

            var profile = _bootstrap.IsDevelopment ? (IEdgeProfile)_developmentProfile : _productionProfile;
            profile.Materialize(context);

            var staticAfter = File.Exists(staticPath) ? await File.ReadAllTextAsync(staticPath, ct) : null;
            var staticChanged = !string.Equals(staticBefore, staticAfter, StringComparison.Ordinal);

            try
            {
                await _reloader.ReloadAsync(restartForStaticConfig: staticChanged && staticAfter is not null, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Traefik reload/restart signal failed after edge materialization.");
            }

            _logger.LogInformation("Edge configuration materialized under {Root}.", _traefikRoot);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to write Traefik edge configuration.");
        }
    }
}
