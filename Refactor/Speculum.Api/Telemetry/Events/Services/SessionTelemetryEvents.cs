using Aidan.Core.Errors;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry.Events.Models;
using Speculum.Api.Telemetry.Events.Models.Sessions.Browse;
using Speculum.Api.Telemetry.Events.Models.Sessions.Capacity;
using Speculum.Api.Telemetry.Events.Models.Sessions.Client;
using Speculum.Api.Telemetry.Events.Models.Sessions.Persist;
using Speculum.Api.Telemetry.Events.Models.Sessions.Sidecar;
using Speculum.Api.Telemetry.Events.Services.Contracts;
using DomDiffFrameReceived = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Diff.FrameReceived;
using DomDiffGenerationBumped = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Diff.GenerationBumped;
using DomInputAdmissionDropped = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input.AdmissionDropped;
using DomInputApplied = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input.Applied;
using DomInputCdpDropped = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input.CdpDropped;
using DomInputDataPlaneReceived = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input.DataPlaneReceived;
using DomInputRejected = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input.Rejected;
using DomInputSidecarAdmitted = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input.SidecarAdmitted;
using DomInputSidecarPushWritten = Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input.SidecarPushWritten;
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
        DomProjection = new DomProjectionEvents(writer, sessionId, profileId);
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
    public ISessionDomProjectionTelemetryEvents DomProjection { get; }
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

    private sealed class DomProjectionEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : ISessionDomProjectionTelemetryEvents
    {
        public ISessionDomProjectionDiffTelemetryEvents Diff { get; } =
            new DomProjectionDiffEvents(writer, sessionId, profileId);

        public ISessionDomProjectionInputTelemetryEvents Input { get; } =
            new DomProjectionInputEvents(writer, sessionId, profileId);
    }

    private sealed class DomProjectionDiffEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionDomProjectionDiffTelemetryEvents
    {
        public void FrameReceived(
            string kind,
            string? target,
            string? treeType,
            long sequence,
            long generation,
            long timestamp,
            int? nodeCount,
            int? urlCount)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new DomDiffFrameReceived
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Target = target,
                TreeType = treeType,
                Sequence = sequence,
                Generation = generation,
                Timestamp = timestamp,
                NodeCount = nodeCount,
                UrlCount = urlCount,
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
            Writer.Append(new DomDiffGenerationBumped
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
    }

    private sealed class DomProjectionInputEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionDomProjectionInputTelemetryEvents
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
