using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Telemetry;

/// <summary>
/// Telemetry-owned Journal fact types. Enablement is driven by
/// <see cref="TelemetryConfiguration"/> on config Apply — not by the Journal events map.
/// </summary>
public static class TelemetryJournalFacts
{
    public const string SampleCollected = "Telemetry.SampleCollected";
    public const string SessionSampleCollected = "Telemetry.SessionSampleCollected";

    public static bool Owns(string type)
        => string.Equals(type, SampleCollected, StringComparison.Ordinal)
            || string.Equals(type, SessionSampleCollected, StringComparison.Ordinal);

    /// <summary>
    /// Maps Telemetry toggles onto the Journal catalog.
    /// <list type="bullet">
    /// <item><description><see cref="TelemetryConfiguration.IsEnabled"/> → <c>Telemetry.SampleCollected</c></description></item>
    /// <item><description><c>IsEnabled &amp;&amp; Sessions.IncludePerSession</c> → <c>Telemetry.SessionSampleCollected</c></description></item>
    /// </list>
    /// </summary>
    public static void ApplyToCatalog(IJournalCatalog catalog, TelemetryConfiguration telemetry)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(telemetry);

        catalog.SetEnabled(SampleCollected, telemetry.IsEnabled);
        catalog.SetEnabled(
            SessionSampleCollected,
            telemetry.IsEnabled && telemetry.Sessions.IncludePerSession);
    }
}
