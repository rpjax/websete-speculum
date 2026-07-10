using System.Net;

namespace Websete.Speculum.Host.Config.Bootstrap;

public sealed class BootstrapConfig
{
    public string HttpAddress { get; }
    public string DatabasePath { get; }
    public string SidecarBaseUrl { get; }

    private BootstrapConfig(string httpAddress, string databasePath, string sidecarBaseUrl)
    {
        HttpAddress    = httpAddress;
        DatabasePath   = databasePath;
        SidecarBaseUrl = sidecarBaseUrl;
    }

    public static BootstrapConfig Load(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var httpAddress = configuration["HttpAddress"]?.Trim();
        if (string.IsNullOrEmpty(httpAddress))
            throw new InvalidOperationException("HttpAddress environment variable is required.");
        if (!IPEndPoint.TryParse(httpAddress, out _))
            throw new InvalidOperationException($"Invalid HttpAddress '{httpAddress}'.");

        var databasePath = configuration["Database:Path"]?.Trim();
        if (string.IsNullOrEmpty(databasePath))
            throw new InvalidOperationException("Database:Path environment variable is required.");

        var sidecarBaseUrl = configuration["Sidecar:BaseUrl"]?.Trim();
        if (string.IsNullOrEmpty(sidecarBaseUrl))
            throw new InvalidOperationException("Sidecar:BaseUrl environment variable is required.");

        return new BootstrapConfig(httpAddress, databasePath, sidecarBaseUrl);
    }
}
