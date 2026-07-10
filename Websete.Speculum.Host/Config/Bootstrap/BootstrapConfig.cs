using System.Net;

namespace Websete.Speculum.Host.Config.Bootstrap;

public sealed class BootstrapConfig
{
    public string HttpAddress { get; }
    public string DatabasePath { get; }
    public string SidecarBaseUrl { get; }
    public string AdminApiKey { get; }

    private BootstrapConfig(string httpAddress, string databasePath, string sidecarBaseUrl, string adminApiKey)
    {
        HttpAddress    = httpAddress;
        DatabasePath   = databasePath;
        SidecarBaseUrl = sidecarBaseUrl;
        AdminApiKey    = adminApiKey;
    }

    public static BootstrapConfig Load(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var httpAddress = configuration["HttpAddress"]?.Trim();
        if (string.IsNullOrEmpty(httpAddress))
            throw new InvalidOperationException("HttpAddress is required in configuration.");
        if (!IPEndPoint.TryParse(httpAddress, out _))
            throw new InvalidOperationException($"Invalid HttpAddress '{httpAddress}'.");

        var databasePath = configuration["Database:Path"]?.Trim();
        if (string.IsNullOrEmpty(databasePath))
            throw new InvalidOperationException("Database:Path is required in configuration.");

        var sidecarBaseUrl = configuration["Sidecar:BaseUrl"]?.Trim();
        if (string.IsNullOrEmpty(sidecarBaseUrl))
            throw new InvalidOperationException("Sidecar:BaseUrl is required in configuration.");

        var adminApiKey = configuration["Admin:ApiKey"]?.Trim();
        if (string.IsNullOrEmpty(adminApiKey))
            throw new InvalidOperationException("Admin:ApiKey is required in configuration.");

        return new BootstrapConfig(httpAddress, databasePath, sidecarBaseUrl, adminApiKey);
    }
}
