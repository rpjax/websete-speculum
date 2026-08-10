using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Services;

namespace Speculum.Api.Presentation.Bootstrap;

/// <summary>
/// Projects engine configuration into the public PreStart client-config DTO.
/// Everything the SPA must know before <c>StartSession</c> lives here.
/// </summary>
public interface IPublicClientConfigProjector
{
    PublicClientConfig Project(
        EngineConfiguration engine,
        bool operational,
        IReadOnlyList<string> missing,
        string requestHost);
}

public sealed class PublicClientConfigProjector : IPublicClientConfigProjector
{
    public PublicClientConfig Project(
        EngineConfiguration engine,
        bool operational,
        IReadOnlyList<string> missing,
        string requestHost)
    {
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(missing);

        var domains = engine.Hosting.Domains
            .Select(d => new PublicHostingDomainDto
            {
                Domain = d.Domain,
                SubdomainMirroringEnabled = d.IsSubdomainMirroringEnabled,
            })
            .ToList();

        var matched = domains.FirstOrDefault(d =>
            string.Equals(d.Domain, requestHost, StringComparison.OrdinalIgnoreCase));

        var vp = engine.Sessions.ViewportPolicy;
        var observation = engine.Telemetry.ClientObservation;

        return new PublicClientConfig
        {
            SchemaVersion = 1,
            Operational = operational,
            Missing = missing.ToList(),
            NsoParamName = UrlResolver.NavigationStateParameterName,
            Navigation = new PublicNavigationConfig
            {
                DefaultTargetHost = engine.Navigation.DefaultTargetHost,
            },
            Sessions = new PublicSessionsConfig
            {
                DetachedSessionTimeoutSeconds = (int)Math.Clamp(
                    engine.Sessions.DetachedSessionTimeout.TotalSeconds,
                    0,
                    int.MaxValue),
                DataStreamTransport = ToClientTransport(engine.Sessions.DataStreamTransport),
                MirrorMode = ToClientMirrorMode(engine.Sessions.MirrorMode),
                ViewportPolicy = new PublicViewportPolicyConfig
                {
                    MinWidth = vp.Minimum.Width,
                    MinHeight = vp.Minimum.Height,
                    MaxWidth = vp.Maximum.Width,
                    MaxHeight = vp.Maximum.Height,
                    DefaultWidth = vp.Default.Width,
                    DefaultHeight = vp.Default.Height,
                },
                ScreencastMaxEncodeScale = ClampEncodeScale(
                    engine.Sessions.ScreencastPolicy.MaxEncodeScale),
            },
            ResourceManagement = new PublicResourceManagementConfig
            {
                MaxConcurrentSessions = engine.ResourceManagement.Sessions.MaxConcurrentSessions,
            },
            Telemetry = new PublicTelemetryConfig
            {
                ClientObservation = new PublicClientObservationConfig
                {
                    IsEnabled = observation.IsEnabled,
                    SessionWire = observation.SessionWire,
                    VideoStreamingInput = observation.VideoStreamingInput,
                    PageProjectionDiff = observation.PageProjectionDiff,
                    PageProjectionIntent = observation.PageProjectionIntent,
                },
            },
            Hosting = new PublicHostingConfig
            {
                Required = false,
                Domains = domains,
                CurrentDomain = matched?.Domain,
            },
        };
    }

    private static string ToClientTransport(DataStreamTransportKind kind)
        => kind == DataStreamTransportKind.WebSocket ? "webSocket" : "webTransport";

    private static string ToClientMirrorMode(MirrorMode mode)
        => mode == MirrorMode.PageProjection ? "pageProjection" : "videoStreaming";

    private static double ClampEncodeScale(double value)
    {
        if (!double.IsFinite(value) || value <= 0)
        {
            return 2;
        }

        return Math.Clamp(value, 1, 2);
    }
}

/// <summary>Wire DTO for <c>GET /api/public/client-config</c> (camelCase JSON).</summary>
public sealed class PublicClientConfig
{
    public int SchemaVersion { get; init; }
    public bool Operational { get; init; }
    public List<string> Missing { get; init; } = [];
    public string NsoParamName { get; init; } = "";
    public PublicNavigationConfig Navigation { get; init; } = new();
    public PublicSessionsConfig Sessions { get; init; } = new();
    public PublicResourceManagementConfig ResourceManagement { get; init; } = new();
    public PublicTelemetryConfig Telemetry { get; init; } = new();
    public PublicHostingConfig Hosting { get; init; } = new();
}

public sealed class PublicNavigationConfig
{
    public string DefaultTargetHost { get; init; } = "";
}

public sealed class PublicSessionsConfig
{
    public int DetachedSessionTimeoutSeconds { get; init; }
    public string DataStreamTransport { get; init; } = "webTransport";
    public string MirrorMode { get; init; } = "videoStreaming";
    public PublicViewportPolicyConfig ViewportPolicy { get; init; } = new();
    public double ScreencastMaxEncodeScale { get; init; } = 2;
}

public sealed class PublicViewportPolicyConfig
{
    public int MinWidth { get; init; }
    public int MinHeight { get; init; }
    public int MaxWidth { get; init; }
    public int MaxHeight { get; init; }
    public int DefaultWidth { get; init; }
    public int DefaultHeight { get; init; }
}

public sealed class PublicResourceManagementConfig
{
    public int MaxConcurrentSessions { get; init; }
}

public sealed class PublicTelemetryConfig
{
    public PublicClientObservationConfig ClientObservation { get; init; } = new();
}

public sealed class PublicClientObservationConfig
{
    public bool IsEnabled { get; init; }
    public bool SessionWire { get; init; }
    public bool VideoStreamingInput { get; init; }
    public bool PageProjectionDiff { get; init; }
    public bool PageProjectionIntent { get; init; }
}

public sealed class PublicHostingConfig
{
    public bool Required { get; init; }
    public List<PublicHostingDomainDto> Domains { get; init; } = [];
    public string? CurrentDomain { get; init; }
}

public sealed class PublicHostingDomainDto
{
    public string Domain { get; init; } = "";
    public bool SubdomainMirroringEnabled { get; init; }
}
