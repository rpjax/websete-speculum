using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Telemetry;

/// <summary>
/// Telemetry-owned Journal fact types. Enablement is driven by
/// <see cref="TelemetryConfiguration"/> on config Apply — not by the Journal events map.
/// </summary>
public static class TelemetryJournalFacts
{
    public const string SampleCollected = "Telemetry.Sampling.SampleCollected";
    public const string SessionSampleCollected = "Telemetry.Sampling.SessionSampleCollected";
    public const string VideoStreamingInputDataPlaneReceived =
        "Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived";
    public const string VideoStreamingInputControlReceived =
        "Telemetry.Sessions.VideoStreamingInput.ControlReceived";
    public const string VideoStreamingInputSidecarPushWritten =
        "Telemetry.Sessions.VideoStreamingInput.SidecarPushWritten";
    public const string VideoStreamingInputSidecarAdmitted =
        "Telemetry.Sessions.VideoStreamingInput.SidecarAdmitted";
    public const string VideoStreamingInputApplied =
        "Telemetry.Sessions.VideoStreamingInput.Applied";
    public const string VideoStreamingInputRejected =
        "Telemetry.Sessions.VideoStreamingInput.Rejected";
    public const string DomProjectionDiffFrameReceived =
        "Telemetry.Sessions.DomProjection.Diff.FrameReceived";
    public const string DomProjectionDiffGenerationBumped =
        "Telemetry.Sessions.DomProjection.Diff.GenerationBumped";
    public const string DomProjectionInputDataPlaneReceived =
        "Telemetry.Sessions.DomProjection.Input.DataPlaneReceived";
    public const string DomProjectionInputAdmissionDropped =
        "Telemetry.Sessions.DomProjection.Input.AdmissionDropped";
    public const string DomProjectionInputSidecarPushWritten =
        "Telemetry.Sessions.DomProjection.Input.SidecarPushWritten";
    public const string DomProjectionInputSidecarAdmitted =
        "Telemetry.Sessions.DomProjection.Input.SidecarAdmitted";
    public const string DomProjectionInputCdpDropped =
        "Telemetry.Sessions.DomProjection.Input.CdpDropped";
    public const string DomProjectionInputApplied =
        "Telemetry.Sessions.DomProjection.Input.Applied";
    public const string DomProjectionInputRejected =
        "Telemetry.Sessions.DomProjection.Input.Rejected";

    public static bool Owns(string type)
        => !string.IsNullOrWhiteSpace(type)
            && type.StartsWith("Telemetry.", StringComparison.Ordinal);

    /// <summary>
    /// Maps Telemetry toggles onto the Journal catalog (sampling + event facts).
    /// </summary>
    public static void ApplyToCatalog(IJournalCatalog catalog, TelemetryConfiguration telemetry)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(telemetry);

        // Sampling
        catalog.SetEnabled(SampleCollected, telemetry.IsEnabled);
        catalog.SetEnabled(
            SessionSampleCollected,
            telemetry.IsEnabled && telemetry.Sessions.IncludePerSession);

        // Event facts — default off unless explicitly listed true in Events map.
        foreach (var descriptor in catalog.Types)
        {
            if (!Owns(descriptor.Type))
                continue;
            if (descriptor.Type is SampleCollected or SessionSampleCollected)
                continue;

            var enabled = telemetry.Events.TryGetValue(descriptor.Type, out var flag) && flag;
            catalog.SetEnabled(descriptor.Type, enabled);
        }

        foreach (var (type, _) in telemetry.Events)
        {
            if (string.IsNullOrWhiteSpace(type))
                continue;
            if (!Owns(type))
            {
                throw new InvalidOperationException(
                    $"Telemetry.Events cannot enable non-Telemetry fact type '{type}'.");
            }

            if (!catalog.Types.Any(d => string.Equals(d.Type, type, StringComparison.Ordinal)))
            {
                throw new InvalidOperationException(
                    $"Telemetry.Events references unknown Journal fact type '{type}'.");
            }
        }
    }
}
