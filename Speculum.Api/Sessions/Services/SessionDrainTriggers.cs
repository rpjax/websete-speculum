using Speculum.Api.Configurations.Persistence;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Which configuration PUTs require a session drain before ReplaceApplied.
/// ResourceManagement / Sessions / Journal / Telemetry do not drain.
/// </summary>
public static class SessionDrainTriggers
{
    public static readonly TimeSpan ConfigForceAfter = TimeSpan.FromSeconds(30);

    public static readonly TimeSpan ShutdownForceAfter = TimeSpan.FromSeconds(20);

    public const string ShutdownTrigger = "Shutdown";

    public static bool RequiresDrain(string sectionKey)
        => string.Equals(sectionKey, ConfigSectionKeys.Navigation, StringComparison.Ordinal)
            || string.Equals(sectionKey, ConfigSectionKeys.Hosting, StringComparison.Ordinal);
}
