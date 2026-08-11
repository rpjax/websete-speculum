using Aidan.Core.Errors;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry.Events.Models;
using Speculum.Api.Telemetry.Events.Models.Sessions.Browse;
using Speculum.Api.Telemetry.Events.Models.Sessions.Capacity;
using Speculum.Api.Telemetry.Events.Models.Sessions.Client;
using Speculum.Api.Telemetry.Events.Models.Sessions.Persist;
using Speculum.Api.Telemetry.Events.Models.Sessions.Sidecar;
using Speculum.Api.Telemetry.Events.Services.Contracts;
using PageProjectionDiffFrameReceived = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.FrameReceived;
using PageProjectionDiffGenerationBumped = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.GenerationBumped;
using PageProjectionDiffSoftNavObserved = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.SoftNavObserved;
using PageProjectionDiffQueueDropped = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.QueueDropped;
using PageProjectionDiffWireDelivered = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.WireDelivered;
using PageProjectionDiffFanOutEnqueued = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.FanOutEnqueued;
using PageProjectionDiffStreamDequeued = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.StreamDequeued;
using PageProjectionDiffOutputStreamOpened = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.OutputStreamOpened;
using PageProjectionDiffOutputStreamClosed = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.OutputStreamClosed;
using PageProjectionDiffResyncRequested = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.ResyncRequested;
using PageProjectionDiffResyncServed = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.ResyncServed;
using PageProjectionVirtualBootMarked = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual.BootMarked;
using PageProjectionVirtualNavCommit = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual.NavCommit;
using PageProjectionVirtualNavTiming = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual.NavTiming;
using PageProjectionVirtualResourceSummary = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual.ResourceSummary;
using PageProjectionVirtualPageError = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual.PageError;
using PageProjectionVirtualLifecycle = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual.Lifecycle;
using PageProjectionEstablishStylesWaitStarted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.StylesWaitStarted;
using PageProjectionEstablishStylesWaitCompleted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.StylesWaitCompleted;
using PageProjectionEstablishDomMapStarted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.DomMapStarted;
using PageProjectionEstablishDomMapCompleted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.DomMapCompleted;
using PageProjectionEstablishCssomInstallStarted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.CssomInstallStarted;
using PageProjectionEstablishCssomInstallCompleted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.CssomInstallCompleted;
using PageProjectionEstablishFirstDiffEmitted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.FirstDiffEmitted;
using PageProjectionEstablishCompleted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.EstablishCompleted;
using PageProjectionEstablishFailed = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish.EstablishFailed;
using PageProjectionAssetRewriteSummary = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Asset.RewriteSummary;
using PageProjectionAssetFetchFinished = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Asset.FetchFinished;
using PageProjectionAssetServeMiss = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Asset.ServeMiss;
using PageProjectionAssetServeSlow = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Asset.ServeSlow;
using DomInputAdmissionDropped = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.AdmissionDropped;
using DomInputApplied = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.Applied;
using DomInputCdpDropped = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.CdpDropped;
using DomInputDataPlaneReceived = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.DataPlaneReceived;
using DomInputRejected = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.Rejected;
using DomInputSidecarAdmitted = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.SidecarAdmitted;
using DomInputSidecarPushWritten = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.SidecarPushWritten;
using DomInputScrollEchoHit = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input.ScrollEchoHit;
using NavigateUrlResolved = Speculum.Api.Telemetry.Events.Models.Sessions.Navigate.UrlResolved;
using ResizeApplied = Speculum.Api.Telemetry.Events.Models.Sessions.Resize.Applied;
using ResizeRejected = Speculum.Api.Telemetry.Events.Models.Sessions.Resize.Rejected;
using StartUrlResolved = Speculum.Api.Telemetry.Events.Models.Sessions.Start.UrlResolved;
using StartUrlResolveFailed = Speculum.Api.Telemetry.Events.Models.Sessions.Start.UrlResolveFailed;
using VsiApplied = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.Applied;
using VsiControlReceived = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.ControlReceived;
using VsiDataPlaneReceived = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.DataPlaneReceived;
using VsiRejected = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.Rejected;
using VsiSidecarAdmitted = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.SidecarAdmitted;
using VsiSidecarPushWritten = Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput.SidecarPushWritten;

namespace Speculum.Api.Telemetry.Events.Services;

internal sealed class SessionTelemetryEvents : ISessionTelemetryEvents
{
    public SessionTelemetryEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
    {
        Capacity = new CapacityEvents(writer, sessionId, profileId);
        Start = new StartEvents(writer, sessionId, profileId);
        Navigate = new NavigateEvents(writer, sessionId, profileId);
        Persist = new PersistEvents(writer, sessionId, profileId);
        VideoStreamingInput = new VideoStreamingInputEvents(writer, sessionId, profileId);
        PageProjection = new PageProjectionEvents(writer, sessionId, profileId);
        Resize = new ResizeEvents(writer, sessionId, profileId);
        Browse = new BrowseEvents(writer, sessionId, profileId);
        Client = new ClientEvents(writer, sessionId, profileId);
        Sidecar = new SidecarEvents(writer, sessionId, profileId);
    }

    public ISessionCapacityTelemetryEvents Capacity { get; }
    public ISessionStartTelemetryEvents Start { get; }
    public ISessionNavigateTelemetryEvents Navigate { get; }
    public ISessionPersistTelemetryEvents Persist { get; }
    public ISessionVideoStreamingInputTelemetryEvents VideoStreamingInput { get; }
    public ISessionPageProjectionTelemetryEvents PageProjection { get; }
    public ISessionResizeTelemetryEvents Resize { get; }
    public ISessionBrowseTelemetryEvents Browse { get; }
    public ISessionClientTelemetryEvents Client { get; }
    public ISessionSidecarTelemetryEvents Sidecar { get; }

    private abstract class Scoped(IJournalWriter writer, Guid sessionId, Guid profileId)
    {
        protected readonly IJournalWriter Writer = writer;
        protected readonly Guid SessionId = sessionId;
        protected readonly Guid ProfileId = profileId;

        protected static string? NullIfEmpty(string? value)
            => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        protected static string Truncate(string? value, int max)
        {
            if (string.IsNullOrEmpty(value)) return "";
            return value.Length <= max ? value : value[..max];
        }
    }

    private sealed class CapacityEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionCapacityTelemetryEvents
    {
        public void SlotAcquired()
            => Writer.Append(new SlotAcquired { SessionId = SessionId, ProfileId = ProfileId });

        public void SlotReleased()
            => Writer.Append(new SlotReleased { SessionId = SessionId, ProfileId = ProfileId });

        public void NoSlotAvailable()
            => Writer.Append(new NoSlotAvailable { SessionId = SessionId, ProfileId = ProfileId });
    }

    private sealed class StartEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionStartTelemetryEvents
    {
        public void UrlResolved(string url)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(url);
            Writer.Append(new StartUrlResolved
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Url = url.Trim(),
            });
        }

        public void UrlResolveFailed(Error[] errors)
            => Writer.Append(new StartUrlResolveFailed
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Errors = TelemetryJournalError.From(errors),
            });
    }

    private sealed class NavigateEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionNavigateTelemetryEvents
    {
        public void UrlResolved(string url)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(url);
            Writer.Append(new NavigateUrlResolved
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Url = url.Trim(),
            });
        }
    }

    private sealed class PersistEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionPersistTelemetryEvents
    {
        public void SkippedNoConnection()
            => Writer.Append(new SkippedNoConnection { SessionId = SessionId, ProfileId = ProfileId });

        public void SkippedProfileNotFound()
            => Writer.Append(new SkippedProfileNotFound { SessionId = SessionId, ProfileId = ProfileId });

        public void Succeeded()
            => Writer.Append(new Succeeded { SessionId = SessionId, ProfileId = ProfileId });
    }

    private sealed class VideoStreamingInputEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionVideoStreamingInputTelemetryEvents
    {
        public void Applied(string kind, string? phase, string? traceId = null, long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new VsiApplied
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Phase = phase,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void Rejected(
            string? errorCode,
            string? message,
            string? phase,
            string? traceId = null,
            long? clientTimestampMs = null)
            => Writer.Append(new VsiRejected
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                ErrorCode = errorCode,
                Message = message,
                Phase = phase,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });

        public void DataPlaneReceived(string kind, string? traceId = null, long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new VsiDataPlaneReceived
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void ControlReceived(string kind, string? traceId = null, long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new VsiControlReceived
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void SidecarPushWritten(
            string kind,
            string? phase,
            string? traceId = null,
            long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new VsiSidecarPushWritten
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Phase = phase,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void SidecarAdmitted(string kind, string? traceId = null, long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new VsiSidecarAdmitted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }
    }

    private sealed class PageProjectionEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : ISessionPageProjectionTelemetryEvents
    {
        public ISessionPageProjectionDiffTelemetryEvents Diff { get; } =
            new PageProjectionDiffEvents(writer, sessionId, profileId);

        public ISessionPageProjectionInputTelemetryEvents Input { get; } =
            new PageProjectionIntentEvents(writer, sessionId, profileId);

        public ISessionPageProjectionVirtualTelemetryEvents Virtual { get; } =
            new PageProjectionVirtualEvents(writer, sessionId, profileId);

        public ISessionPageProjectionEstablishTelemetryEvents Establish { get; } =
            new PageProjectionEstablishEvents(writer, sessionId, profileId);

        public ISessionPageProjectionAssetTelemetryEvents Asset { get; } =
            new PageProjectionAssetEvents(writer, sessionId, profileId);
    }

    private sealed class PageProjectionDiffEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionPageProjectionDiffTelemetryEvents
    {
        public void FrameReceived(
            string plane,
            string operation,
            long sequence,
            long generation,
            long timestamp,
            int? sheetCount = null,
            int? ruleCount = null,
            int? seededSheetCount = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(plane);
            ArgumentException.ThrowIfNullOrWhiteSpace(operation);
            Writer.Append(new PageProjectionDiffFrameReceived
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Plane = plane.Trim(),
                Operation = operation.Trim(),
                Sequence = sequence,
                Generation = generation,
                Timestamp = timestamp,
                SheetCount = sheetCount,
                RuleCount = ruleCount,
                SeededSheetCount = seededSheetCount,
            });
        }

        public void GenerationBumped(
            long fromGeneration,
            long toGeneration,
            string reason,
            string? url = null,
            string? diffKind = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(reason);
            Writer.Append(new PageProjectionDiffGenerationBumped
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                FromGeneration = fromGeneration,
                ToGeneration = toGeneration,
                Reason = reason.Trim(),
                Url = url,
                DiffKind = diffKind,
            });
        }

        public void SoftNavObserved(
            long generation,
            string? url,
            string? documentEpoch,
            bool liveArmed)
        {
            Writer.Append(new PageProjectionDiffSoftNavObserved
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Generation = generation,
                Url = url,
                DocumentEpoch = documentEpoch,
                LiveArmed = liveArmed,
            });
        }

        public void QueueDropped(
            string stage,
            int droppedCount,
            int capacity,
            long? sequence = null,
            long? generation = null,
            string? plane = null,
            string? operation = null,
            long? lowestDroppedSequence = null,
            long? highestDroppedSequence = null,
            string? reason = null,
            Guid? streamId = null,
            Guid? consumerId = null,
            string? kind = null,
            int? targetCount = null,
            int? diffChannelCount = null,
            long? diffEpoch = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(stage);
            Writer.Append(new PageProjectionDiffQueueDropped
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Stage = stage.Trim(),
                DroppedCount = droppedCount,
                Capacity = capacity,
                Sequence = sequence,
                Generation = generation,
                Plane = NullIfEmpty(plane),
                Operation = NullIfEmpty(operation),
                LowestDroppedSequence = lowestDroppedSequence,
                HighestDroppedSequence = highestDroppedSequence,
                Reason = NullIfEmpty(reason),
                StreamId = streamId,
                ConsumerId = consumerId,
                Kind = NullIfEmpty(kind),
                TargetCount = targetCount,
                DiffChannelCount = diffChannelCount,
                DiffEpoch = diffEpoch,
            });
        }

        public void WireDelivered(
            string plane,
            string operation,
            long sequence,
            long generation,
            long timestamp,
            long durationMs,
            Guid streamId,
            Guid consumerId,
            long diffEpoch)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(plane);
            ArgumentException.ThrowIfNullOrWhiteSpace(operation);
            Writer.Append(new PageProjectionDiffWireDelivered
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Plane = plane.Trim(),
                Operation = operation.Trim(),
                Sequence = sequence,
                Generation = generation,
                Timestamp = timestamp,
                DurationMs = durationMs,
                StreamId = streamId,
                ConsumerId = consumerId,
                DiffEpoch = diffEpoch,
            });
        }

        public void FanOutEnqueued(
            string plane,
            string operation,
            long sequence,
            long generation,
            long timestamp,
            long waitMs,
            Guid streamId,
            Guid consumerId,
            string kind,
            int targetIndex,
            int targetCount,
            int diffChannelCount,
            long diffEpoch)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(plane);
            ArgumentException.ThrowIfNullOrWhiteSpace(operation);
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new PageProjectionDiffFanOutEnqueued
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Plane = plane.Trim(),
                Operation = operation.Trim(),
                Sequence = sequence,
                Generation = generation,
                Timestamp = timestamp,
                WaitMs = waitMs,
                StreamId = streamId,
                ConsumerId = consumerId,
                Kind = kind.Trim(),
                TargetIndex = targetIndex,
                TargetCount = targetCount,
                DiffChannelCount = diffChannelCount,
                DiffEpoch = diffEpoch,
            });
        }

        public void StreamDequeued(
            string plane,
            string operation,
            long sequence,
            long generation,
            long timestamp,
            Guid streamId,
            Guid consumerId,
            long diffEpoch)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(plane);
            ArgumentException.ThrowIfNullOrWhiteSpace(operation);
            Writer.Append(new PageProjectionDiffStreamDequeued
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Plane = plane.Trim(),
                Operation = operation.Trim(),
                Sequence = sequence,
                Generation = generation,
                Timestamp = timestamp,
                StreamId = streamId,
                ConsumerId = consumerId,
                DiffEpoch = diffEpoch,
            });
        }

        public void OutputStreamOpened(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount,
            int diffChannelCapacity)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new PageProjectionDiffOutputStreamOpened
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                StreamId = streamId,
                ConsumerId = consumerId,
                Kind = kind.Trim(),
                OpenStreamCount = openStreamCount,
                DiffChannelCapacity = diffChannelCapacity,
            });
        }

        public void OutputStreamClosed(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new PageProjectionDiffOutputStreamClosed
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                StreamId = streamId,
                ConsumerId = consumerId,
                Kind = kind.Trim(),
                OpenStreamCount = openStreamCount,
            });
        }

        public void ResyncRequested(long hintGeneration, long hintSequence)
        {
            Writer.Append(new PageProjectionDiffResyncRequested
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                HintGeneration = hintGeneration,
                HintSequence = hintSequence,
            });
        }

        public void ResyncServed(
            long generation,
            long coversThroughSequence,
            int sheetCount,
            int ruleCount,
            int seededSheetCount,
            long durationMs,
            string? pageEpochId = null,
            string? source = null,
            long domMapMs = 0,
            long cssomCloneMs = 0,
            long rewriteMs = 0,
            long serializeMs = 0)
        {
            Writer.Append(new PageProjectionDiffResyncServed
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Generation = generation,
                CoversThroughSequence = coversThroughSequence,
                SheetCount = sheetCount,
                RuleCount = ruleCount,
                SeededSheetCount = seededSheetCount,
                DurationMs = durationMs,
                PageEpochId = pageEpochId,
                Source = source,
                DomMapMs = domMapMs,
                CssomCloneMs = cssomCloneMs,
                RewriteMs = rewriteMs,
                SerializeMs = serializeMs,
            });
        }
    }

    private sealed class PageProjectionVirtualEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionPageProjectionVirtualTelemetryEvents
    {
        public void BootMarked(long browserLaunchedAtMs, long firstCommitAtMs, long bootMs, string? pageEpochId)
        {
            Writer.Append(new PageProjectionVirtualBootMarked
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                BrowserLaunchedAtMs = browserLaunchedAtMs,
                FirstCommitAtMs = firstCommitAtMs,
                BootMs = bootMs,
                PageEpochId = pageEpochId,
            });
        }

        public void NavCommit(
            string pageEpochId,
            string? url,
            long generation,
            string? documentEpoch,
            string navigationType,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(navigationType);
            Writer.Append(new PageProjectionVirtualNavCommit
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Url = url,
                Generation = generation,
                DocumentEpoch = documentEpoch,
                NavigationType = navigationType.Trim(),
                TVirtualMs = tVirtualMs,
            });
        }

        public void NavTiming(
            string pageEpochId,
            long? redirectMs,
            long? dnsMs,
            long? connectMs,
            long? ttfbMs,
            long? domInteractiveMs,
            long? domContentLoadedMs,
            long? loadEventMs,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            Writer.Append(new PageProjectionVirtualNavTiming
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                RedirectMs = redirectMs,
                DnsMs = dnsMs,
                ConnectMs = connectMs,
                TtfbMs = ttfbMs,
                DomInteractiveMs = domInteractiveMs,
                DomContentLoadedMs = domContentLoadedMs,
                LoadEventMs = loadEventMs,
                TVirtualMs = tVirtualMs,
            });
        }

        public void ResourceSummary(string pageEpochId, string byTypeJson, string topSlowJson, long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            Writer.Append(new PageProjectionVirtualResourceSummary
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                ByTypeJson = byTypeJson ?? "[]",
                TopSlowJson = topSlowJson ?? "[]",
                TVirtualMs = tVirtualMs,
            });
        }

        public void PageError(string pageEpochId, string source, string message, string? urlKey, int count, long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(source);
            Writer.Append(new PageProjectionVirtualPageError
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Source = source.Trim(),
                Message = Truncate(message, 240),
                UrlKey = urlKey,
                Count = count,
                TVirtualMs = tVirtualMs,
            });
        }

        public void Lifecycle(string pageEpochId, string name, long? tSinceCommitMs, long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            Writer.Append(new PageProjectionVirtualLifecycle
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Name = name.Trim(),
                TSinceCommitMs = tSinceCommitMs,
                TVirtualMs = tVirtualMs,
            });
        }
    }

    private sealed class PageProjectionEstablishEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionPageProjectionEstablishTelemetryEvents
    {
        public void StylesWaitStarted(string pageEpochId, long generation, int timeoutMs, long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            Writer.Append(new PageProjectionEstablishStylesWaitStarted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                TimeoutMs = timeoutMs,
                TVirtualMs = tVirtualMs,
            });
        }

        public void StylesWaitCompleted(
            string pageEpochId,
            long generation,
            int timeoutMs,
            long waitedMs,
            bool timedOut,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            Writer.Append(new PageProjectionEstablishStylesWaitCompleted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                TimeoutMs = timeoutMs,
                WaitedMs = waitedMs,
                TimedOut = timedOut,
                TVirtualMs = tVirtualMs,
            });
        }

        public void DomMapStarted(string pageEpochId, long generation, string path, long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(path);
            Writer.Append(new PageProjectionEstablishDomMapStarted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                Path = path.Trim(),
                TVirtualMs = tVirtualMs,
            });
        }

        public void DomMapCompleted(
            string pageEpochId,
            long generation,
            string path,
            long durationMs,
            int? approxNodes,
            long tVirtualMs,
            long takeRecordsMs = 0,
            long clearLedgerMs = 0,
            long anchorAllMs = 0,
            long remintMs = 0,
            long mapNodeMs = 0,
            long resetPublishedMs = 0,
            long cssomMs = 0,
            long pageTotalMs = 0,
            long cdpTransferMs = 0,
            bool mirror = false)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(path);
            Writer.Append(new PageProjectionEstablishDomMapCompleted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                Path = path.Trim(),
                DurationMs = durationMs,
                ApproxNodes = approxNodes,
                TVirtualMs = tVirtualMs,
                TakeRecordsMs = takeRecordsMs,
                ClearLedgerMs = clearLedgerMs,
                AnchorAllMs = anchorAllMs,
                RemintMs = remintMs,
                MapNodeMs = mapNodeMs,
                ResetPublishedMs = resetPublishedMs,
                CssomMs = cssomMs,
                PageTotalMs = pageTotalMs,
                CdpTransferMs = cdpTransferMs,
                Mirror = mirror,
            });
        }

        public void CssomInstallStarted(string pageEpochId, long generation, string source, long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(source);
            Writer.Append(new PageProjectionEstablishCssomInstallStarted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                Source = source.Trim(),
                TVirtualMs = tVirtualMs,
            });
        }

        public void CssomInstallCompleted(
            string pageEpochId,
            long generation,
            string source,
            long durationMs,
            int sheetCount,
            int ruleCount,
            int seededSheetCount,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(source);
            Writer.Append(new PageProjectionEstablishCssomInstallCompleted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                Source = source.Trim(),
                DurationMs = durationMs,
                SheetCount = sheetCount,
                RuleCount = ruleCount,
                SeededSheetCount = seededSheetCount,
                TVirtualMs = tVirtualMs,
            });
        }

        public void FirstDiffEmitted(
            string pageEpochId,
            long generation,
            string plane,
            string operation,
            long sequence,
            long? tSinceCommitMs,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(plane);
            ArgumentException.ThrowIfNullOrWhiteSpace(operation);
            Writer.Append(new PageProjectionEstablishFirstDiffEmitted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                Plane = plane.Trim(),
                Operation = operation.Trim(),
                Sequence = sequence,
                TSinceCommitMs = tSinceCommitMs,
                TVirtualMs = tVirtualMs,
            });
        }

        public void EstablishCompleted(
            string pageEpochId,
            long generation,
            long totalMs,
            long? tSinceCommitMs,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            Writer.Append(new PageProjectionEstablishCompleted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                TotalMs = totalMs,
                TSinceCommitMs = tSinceCommitMs,
                TVirtualMs = tVirtualMs,
            });
        }

        public void EstablishFailed(
            string pageEpochId,
            long generation,
            string errorCode,
            string phase,
            string? message,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(errorCode);
            ArgumentException.ThrowIfNullOrWhiteSpace(phase);
            Writer.Append(new PageProjectionEstablishFailed
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Generation = generation,
                ErrorCode = errorCode.Trim(),
                Phase = phase.Trim(),
                Message = Truncate(message, 240),
                TVirtualMs = tVirtualMs,
            });
        }
    }

    private sealed class PageProjectionAssetEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionPageProjectionAssetTelemetryEvents
    {
        public void RewriteSummary(
            string pageEpochId,
            int candidates,
            int rewritten,
            int bareSkipped,
            int dataInlined,
            int blobQueued,
            int deferredFetches,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            Writer.Append(new PageProjectionAssetRewriteSummary
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                Candidates = candidates,
                Rewritten = rewritten,
                BareSkipped = bareSkipped,
                DataInlined = dataInlined,
                BlobQueued = blobQueued,
                DeferredFetches = deferredFetches,
                TVirtualMs = tVirtualMs,
            });
        }

        public void FetchFinished(
            string pageEpochId,
            string urlKey,
            long durationMs,
            long bytes,
            string mode,
            bool ok,
            long tVirtualMs)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(pageEpochId);
            ArgumentException.ThrowIfNullOrWhiteSpace(urlKey);
            ArgumentException.ThrowIfNullOrWhiteSpace(mode);
            Writer.Append(new PageProjectionAssetFetchFinished
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                PageEpochId = pageEpochId.Trim(),
                UrlKey = urlKey.Trim(),
                DurationMs = durationMs,
                Bytes = bytes,
                Mode = mode.Trim(),
                Ok = ok,
                TVirtualMs = tVirtualMs,
            });
        }

        public void ServeMiss(string urlKey, long durationMs, int status)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(urlKey);
            Writer.Append(new PageProjectionAssetServeMiss
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                UrlKey = urlKey.Trim(),
                DurationMs = durationMs,
                Status = status,
            });
        }

        public void ServeSlow(string urlKey, long durationMs, int status)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(urlKey);
            Writer.Append(new PageProjectionAssetServeSlow
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                UrlKey = urlKey.Trim(),
                DurationMs = durationMs,
                Status = status,
            });
        }
    }

    private sealed class PageProjectionIntentEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionPageProjectionInputTelemetryEvents
    {
        public void DataPlaneReceived(
            string kind,
            long? generation,
            string? anchor,
            string? traceId = null,
            long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new DomInputDataPlaneReceived
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Generation = generation,
                Anchor = anchor,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void AdmissionDropped(
            string kind,
            long? generation,
            string? anchor,
            string? traceId = null,
            long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new DomInputAdmissionDropped
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Generation = generation,
                Anchor = anchor,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void SidecarPushWritten(
            string kind,
            string? phase,
            long? generation,
            string? anchor,
            string? traceId = null,
            long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new DomInputSidecarPushWritten
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Phase = phase,
                Generation = generation,
                Anchor = anchor,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void SidecarAdmitted(
            string kind,
            long? generation,
            string? anchor,
            string? traceId = null,
            long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new DomInputSidecarAdmitted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Generation = generation,
                Anchor = anchor,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void CdpDropped(
            string kind,
            string? reason,
            long? generation,
            string? anchor,
            string? traceId = null,
            long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new DomInputCdpDropped
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Reason = reason,
                Generation = generation,
                Anchor = anchor,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void Applied(
            string kind,
            string? phase,
            long? generation,
            string? anchor,
            string? traceId = null,
            long? clientTimestampMs = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new DomInputApplied
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Phase = phase,
                Generation = generation,
                Anchor = anchor,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });
        }

        public void Rejected(
            string? errorCode,
            string? message,
            string? phase,
            long? generation,
            string? anchor,
            string? traceId = null,
            long? clientTimestampMs = null)
            => Writer.Append(new DomInputRejected
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                ErrorCode = errorCode,
                Message = message,
                Phase = phase,
                Generation = generation,
                Anchor = anchor,
                TraceId = NullIfEmpty(traceId),
                ClientTimestampMs = clientTimestampMs,
            });

        public void ScrollEchoHit(
            string kind,
            long? generation = null,
            string? anchor = null,
            double? scrollX = null,
            double? scrollY = null,
            double? scrollTop = null,
            double? scrollLeft = null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new DomInputScrollEchoHit
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Generation = generation,
                Anchor = anchor,
                ScrollX = scrollX,
                ScrollY = scrollY,
                ScrollTop = scrollTop,
                ScrollLeft = scrollLeft,
            });
        }
    }

    private sealed class ResizeEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionResizeTelemetryEvents
    {
        public void Applied(int width, int height, string? resizeId)
            => Writer.Append(new ResizeApplied
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Width = width,
                Height = height,
                ResizeId = resizeId,
            });

        public void Rejected(
            int? width,
            int? height,
            string? resizeId,
            string? errorCode,
            string? message,
            string? phase)
            => Writer.Append(new ResizeRejected
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Width = width,
                Height = height,
                ResizeId = resizeId,
                ErrorCode = errorCode,
                Message = message,
                Phase = phase,
            });
    }

    private sealed class BrowseEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionBrowseTelemetryEvents
    {
        public void LocationChanged(string url)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(url);
            Writer.Append(new LocationChanged
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Url = url.Trim(),
            });
        }
    }

    private sealed class ClientEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionClientTelemetryEvents
    {
        public void AttachedCommandFailed(string command, Exception exception)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(command);
            Writer.Append(new AttachedCommandFailed
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Command = command.Trim(),
                Errors = TelemetryJournalError.From(exception),
            });
        }
    }

    private sealed class SidecarEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionSidecarTelemetryEvents
    {
        public void SessionAllocated(string? inputBackend)
            => Writer.Append(new SessionAllocated
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                InputBackend = inputBackend,
            });

        public void SessionReleased(string? reason)
            => Writer.Append(new SessionReleased
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Reason = reason,
            });

        public void DisplayAllocated(
            int? displayWidth,
            int? displayHeight,
            int? logicalWidth,
            int? logicalHeight,
            string? inputBackend)
            => Writer.Append(new DisplayAllocated
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                DisplayWidth = displayWidth,
                DisplayHeight = displayHeight,
                LogicalWidth = logicalWidth,
                LogicalHeight = logicalHeight,
                InputBackend = inputBackend,
            });

        public void DisplayReleased(
            int? displayWidth,
            int? displayHeight,
            int? logicalWidth,
            int? logicalHeight,
            string? inputBackend,
            string? reason)
            => Writer.Append(new DisplayReleased
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                DisplayWidth = displayWidth,
                DisplayHeight = displayHeight,
                LogicalWidth = logicalWidth,
                LogicalHeight = logicalHeight,
                InputBackend = inputBackend,
                Reason = reason,
            });

        public void AllocationFaulted(
            int? displayWidth,
            int? displayHeight,
            int? logicalWidth,
            int? logicalHeight,
            string? inputBackend,
            string errorCode,
            string phase,
            string? reason)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(errorCode);
            ArgumentException.ThrowIfNullOrWhiteSpace(phase);
            Writer.Append(new AllocationFaulted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                DisplayWidth = displayWidth,
                DisplayHeight = displayHeight,
                LogicalWidth = logicalWidth,
                LogicalHeight = logicalHeight,
                InputBackend = inputBackend,
                ErrorCode = errorCode.Trim(),
                Phase = phase.Trim(),
                Reason = reason,
            });
        }
    }
}
