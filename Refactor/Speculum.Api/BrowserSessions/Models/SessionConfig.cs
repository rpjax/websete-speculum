namespace Speculum.Api.BrowserSessions.Models;

public sealed class ScreenResolution
{
    public int Width { get; set; }
    public int Height { get; set; }
}

/// <summary>
/// Launch-time policy for a live browser session (resolved values, not admin config sections).
/// </summary>
public sealed class SessionConfig
{
    public ScreenResolution? Resolution { get; set; }

    public DeviceProfile? Device { get; set; }

    /// <summary>Scripts with content already resolved (connection does not load sources).</summary>
    public IReadOnlyList<ScriptInjection>? Scripts { get; set; }

    public bool JsBridgeEnabled { get; set; }

    public IReadOnlyList<string>? AllowedNavigationDomains { get; set; }
}
