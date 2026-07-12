using System.Net;

namespace Speculum.Api.Config.Bootstrap;

public sealed class BootstrapConfig
{
    private static readonly string[] DefaultDevCorsOrigins =
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://speculum.localhost:8080",
    ];

    public string HttpAddress { get; }
    public string DatabasePath { get; }
    public string SidecarBaseUrl { get; }
    public IReadOnlyList<string> DevCorsOrigins { get; }
    public bool IsDevelopment { get; }

    private BootstrapConfig(
        string httpAddress,
        string databasePath,
        string sidecarBaseUrl,
        IReadOnlyList<string> devCorsOrigins,
        bool isDevelopment)
    {
        HttpAddress     = httpAddress;
        DatabasePath    = databasePath;
        SidecarBaseUrl  = sidecarBaseUrl;
        DevCorsOrigins  = devCorsOrigins;
        IsDevelopment   = isDevelopment;
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

        var env = configuration["ASPNETCORE_ENVIRONMENT"]?.Trim() ?? "Production";
        var isDev = env.Equals("Development", StringComparison.OrdinalIgnoreCase);

        var corsRaw = configuration["Cors:AllowedOrigins"]?.Trim();
        IReadOnlyList<string> devCors;
        if (string.IsNullOrEmpty(corsRaw))
        {
            devCors = DefaultDevCorsOrigins;
        }
        else
        {
            devCors = corsRaw
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(o => !string.IsNullOrWhiteSpace(o))
                .ToArray();
            if (devCors.Count == 0)
                devCors = DefaultDevCorsOrigins;
        }

        return new BootstrapConfig(httpAddress, databasePath, sidecarBaseUrl, devCors, isDev);
    }
}
