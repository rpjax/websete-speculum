using System.Net;

namespace Speculum.Api.Config.Bootstrap;

public sealed class BootstrapConfig
{
    private static readonly string[] DefaultCorsOrigins =
    [
        "https://speculum.localhost",
        "http://speculum.localhost:8080",
        "http://localhost:5173",
    ];

    public string HttpAddress { get; }
    public string DatabasePath { get; }
    public string SidecarBaseUrl { get; }
    public string MotorPublicDomain { get; }
    public IReadOnlyList<string> CorsAllowedOrigins { get; }

    private BootstrapConfig(
        string httpAddress,
        string databasePath,
        string sidecarBaseUrl,
        string motorPublicDomain,
        IReadOnlyList<string> corsAllowedOrigins)
    {
        HttpAddress        = httpAddress;
        DatabasePath       = databasePath;
        SidecarBaseUrl     = sidecarBaseUrl;
        MotorPublicDomain  = motorPublicDomain;
        CorsAllowedOrigins = corsAllowedOrigins;
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

        var motorPublicDomain = configuration["Motor:PublicDomain"]?.Trim();
        if (string.IsNullOrEmpty(motorPublicDomain))
            throw new InvalidOperationException("Motor:PublicDomain environment variable is required.");

        var corsRaw = configuration["Cors:AllowedOrigins"]?.Trim();
        IReadOnlyList<string> corsOrigins;
        if (string.IsNullOrEmpty(corsRaw))
        {
            corsOrigins = DefaultCorsOrigins;
        }
        else
        {
            corsOrigins = corsRaw
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(o => !string.IsNullOrWhiteSpace(o))
                .ToArray();
            if (corsOrigins.Count == 0)
                corsOrigins = DefaultCorsOrigins;
        }

        return new BootstrapConfig(httpAddress, databasePath, sidecarBaseUrl, motorPublicDomain, corsOrigins);
    }
}
