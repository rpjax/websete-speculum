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
    public const string PageProjectionDiffFrameReceived =
        "Telemetry.Sessions.PageProjection.Diff.FrameReceived";
    public const string PageProjectionDiffGenerationBumped =
        "Telemetry.Sessions.PageProjection.Diff.GenerationBumped";
    public const string PageProjectionDiffSoftNavObserved =
        "Telemetry.Sessions.PageProjection.Diff.SoftNavObserved";
    public const string PageProjectionDiffQueueDropped =
        "Telemetry.Sessions.PageProjection.Diff.QueueDropped";
    public const string PageProjectionDiffWireDelivered =
        "Telemetry.Sessions.PageProjection.Diff.WireDelivered";
    public const string PageProjectionDiffResyncRequested =
        "Telemetry.Sessions.PageProjection.Diff.ResyncRequested";
    public const string PageProjectionDiffResyncServed =
        "Telemetry.Sessions.PageProjection.Diff.ResyncServed";
    public const string PageProjectionIntentDataPlaneReceived =
        "Telemetry.Sessions.PageProjection.Input.DataPlaneReceived";
    public const string PageProjectionIntentAdmissionDropped =
        "Telemetry.Sessions.PageProjection.Input.AdmissionDropped";
    public const string PageProjectionIntentSidecarPushWritten =
        "Telemetry.Sessions.PageProjection.Input.SidecarPushWritten";
    public const string PageProjectionIntentSidecarAdmitted =
        "Telemetry.Sessions.PageProjection.Input.SidecarAdmitted";
    public const string PageProjectionIntentCdpDropped =
        "Telemetry.Sessions.PageProjection.Input.CdpDropped";
    public const string PageProjectionIntentApplied =
        "Telemetry.Sessions.PageProjection.Input.Applied";
    public const string PageProjectionIntentRejected =
        "Telemetry.Sessions.PageProjection.Input.Rejected";
    public const string PageProjectionIntentScrollEchoHit =
        "Telemetry.Sessions.PageProjection.Input.ScrollEchoHit";

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
