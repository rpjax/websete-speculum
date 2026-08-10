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
using PageProjectionDiffResyncRequested = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.ResyncRequested;
using PageProjectionDiffResyncServed = Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff.ResyncServed;
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
            string? reason = null)
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
            });
        }

        public void WireDelivered(
            string plane,
            string operation,
            long sequence,
            long generation,
            long timestamp)
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
            long durationMs)
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
