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
    public const string PageProjectionFrameReceived =
        "Telemetry.Sessions.PageProjection.Frame.FrameReceived";
    public const string PageProjectionFrameGenerationBumped =
        "Telemetry.Sessions.PageProjection.Frame.GenerationBumped";
    public const string PageProjectionFrameSoftNavObserved =
        "Telemetry.Sessions.PageProjection.Frame.SoftNavObserved";
    public const string PageProjectionFrameQueueDropped =
        "Telemetry.Sessions.PageProjection.Frame.QueueDropped";
    public const string PageProjectionFrameWireDelivered =
        "Telemetry.Sessions.PageProjection.Frame.WireDelivered";
    public const string PageProjectionFrameFanOutEnqueued =
        "Telemetry.Sessions.PageProjection.Frame.FanOutEnqueued";
    public const string PageProjectionFrameStreamDequeued =
        "Telemetry.Sessions.PageProjection.Frame.StreamDequeued";
    public const string PageProjectionFrameOutputStreamOpened =
        "Telemetry.Sessions.PageProjection.Frame.OutputStreamOpened";
    public const string PageProjectionFrameOutputStreamClosed =
        "Telemetry.Sessions.PageProjection.Frame.OutputStreamClosed";
    public const string PageProjectionFrameResyncRequested =
        "Telemetry.Sessions.PageProjection.Frame.ResyncRequested";
    public const string PageProjectionFrameResyncServed =
        "Telemetry.Sessions.PageProjection.Frame.ResyncServed";
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

    public const string PageProjectionVirtualBootMarked =
        "Telemetry.Sessions.PageProjection.Virtual.BootMarked";
    public const string PageProjectionVirtualNavCommit =
        "Telemetry.Sessions.PageProjection.Virtual.NavCommit";
    public const string PageProjectionVirtualNavTiming =
        "Telemetry.Sessions.PageProjection.Virtual.NavTiming";
    public const string PageProjectionVirtualResourceSummary =
        "Telemetry.Sessions.PageProjection.Virtual.ResourceSummary";
    public const string PageProjectionVirtualPageError =
        "Telemetry.Sessions.PageProjection.Virtual.PageError";
    public const string PageProjectionVirtualLifecycle =
        "Telemetry.Sessions.PageProjection.Virtual.Lifecycle";

    public const string PageProjectionEstablishStylesWaitStarted =
        "Telemetry.Sessions.PageProjection.Establish.StylesWaitStarted";
    public const string PageProjectionEstablishStylesWaitCompleted =
        "Telemetry.Sessions.PageProjection.Establish.StylesWaitCompleted";
    public const string PageProjectionEstablishDomMapStarted =
        "Telemetry.Sessions.PageProjection.Establish.DomMapStarted";
    public const string PageProjectionEstablishDomMapCompleted =
        "Telemetry.Sessions.PageProjection.Establish.DomMapCompleted";
    public const string PageProjectionEstablishCssomInstallStarted =
        "Telemetry.Sessions.PageProjection.Establish.CssomInstallStarted";
    public const string PageProjectionEstablishCssomInstallCompleted =
        "Telemetry.Sessions.PageProjection.Establish.CssomInstallCompleted";
    public const string PageProjectionEstablishFirstFrameEmitted =
        "Telemetry.Sessions.PageProjection.Establish.FirstFrameEmitted";
    public const string PageProjectionEstablishCompleted =
        "Telemetry.Sessions.PageProjection.Establish.EstablishCompleted";
    public const string PageProjectionEstablishFailed =
        "Telemetry.Sessions.PageProjection.Establish.EstablishFailed";

    public const string PageProjectionAssetRewriteSummary =
        "Telemetry.Sessions.PageProjection.Asset.RewriteSummary";
    public const string PageProjectionAssetFetchFinished =
        "Telemetry.Sessions.PageProjection.Asset.FetchFinished";
    public const string PageProjectionAssetServeMiss =
        "Telemetry.Sessions.PageProjection.Asset.ServeMiss";
    public const string PageProjectionAssetServeSlow =
        "Telemetry.Sessions.PageProjection.Asset.ServeSlow";

    public const string PageProjectionFrameRateChanged =
        "Telemetry.Sessions.PageProjection.Frame.RateChanged";
    public const string PageProjectionFrameClockStalled =
        "Telemetry.Sessions.PageProjection.Frame.ClockStalled";
    public const string PageProjectionFrameApplyOverrun =
        "Telemetry.Sessions.PageProjection.Frame.ApplyOverrun";
    public const string PageProjectionFrameAggregate =
        "Telemetry.Sessions.PageProjection.Frame.Aggregate";
    public const string PageProjectionSessionPoolAcquired =
        "Telemetry.Sessions.PageProjection.Session.PoolAcquired";
    public const string PageProjectionSessionPoolReleased =
        "Telemetry.Sessions.PageProjection.Session.PoolReleased";

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
