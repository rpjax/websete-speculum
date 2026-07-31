using Aidan.Core.Errors;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry.Events.Models;
using Speculum.Api.Telemetry.Events.Models.Sessions.Browse;
using Speculum.Api.Telemetry.Events.Models.Sessions.Capacity;
using Speculum.Api.Telemetry.Events.Models.Sessions.Client;
using Speculum.Api.Telemetry.Events.Models.Sessions.Input;
using Speculum.Api.Telemetry.Events.Models.Sessions.Persist;
using Speculum.Api.Telemetry.Events.Models.Sessions.Sidecar;
using Speculum.Api.Telemetry.Events.Services.Contracts;
using NavigateUrlResolved = Speculum.Api.Telemetry.Events.Models.Sessions.Navigate.UrlResolved;
using ResizeApplied = Speculum.Api.Telemetry.Events.Models.Sessions.Resize.Applied;
using ResizeRejected = Speculum.Api.Telemetry.Events.Models.Sessions.Resize.Rejected;
using StartUrlResolved = Speculum.Api.Telemetry.Events.Models.Sessions.Start.UrlResolved;
using StartUrlResolveFailed = Speculum.Api.Telemetry.Events.Models.Sessions.Start.UrlResolveFailed;

namespace Speculum.Api.Telemetry.Events.Services;

internal sealed class SessionTelemetryEvents : ISessionTelemetryEvents
{
    public SessionTelemetryEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
    {
        Capacity = new CapacityEvents(writer, sessionId, profileId);
        Start = new StartEvents(writer, sessionId, profileId);
        Navigate = new NavigateEvents(writer, sessionId, profileId);
        Persist = new PersistEvents(writer, sessionId, profileId);
        Input = new InputEvents(writer, sessionId, profileId);
        Resize = new ResizeEvents(writer, sessionId, profileId);
        Browse = new BrowseEvents(writer, sessionId, profileId);
        Client = new ClientEvents(writer, sessionId, profileId);
        Sidecar = new SidecarEvents(writer, sessionId, profileId);
    }

    public ISessionCapacityTelemetryEvents Capacity { get; }
    public ISessionStartTelemetryEvents Start { get; }
    public ISessionNavigateTelemetryEvents Navigate { get; }
    public ISessionPersistTelemetryEvents Persist { get; }
    public ISessionInputTelemetryEvents Input { get; }
    public ISessionResizeTelemetryEvents Resize { get; }
    public ISessionBrowseTelemetryEvents Browse { get; }
    public ISessionClientTelemetryEvents Client { get; }
    public ISessionSidecarTelemetryEvents Sidecar { get; }

    private abstract class Scoped(IJournalWriter writer, Guid sessionId, Guid profileId)
    {
        protected readonly IJournalWriter Writer = writer;
        protected readonly Guid SessionId = sessionId;
        protected readonly Guid ProfileId = profileId;
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

    private sealed class InputEvents(IJournalWriter writer, Guid sessionId, Guid profileId)
        : Scoped(writer, sessionId, profileId), ISessionInputTelemetryEvents
    {
        public void Applied(string kind, string? phase)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new Applied
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Phase = phase,
            });
        }

        public void Rejected(string? errorCode, string? message, string? phase)
            => Writer.Append(new Rejected
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                ErrorCode = errorCode,
                Message = message,
                Phase = phase,
            });

        public void WebTransportReceived(string kind)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new WebTransportReceived
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
            });
        }

        public void ControlReceived(string kind)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new ControlReceived
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
            });
        }

        public void SidecarPushWritten(string kind, string? phase)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new SidecarPushWritten
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
                Phase = phase,
            });
        }

        public void SidecarAdmitted(string kind)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(kind);
            Writer.Append(new SidecarAdmitted
            {
                SessionId = SessionId,
                ProfileId = ProfileId,
                Kind = kind.Trim(),
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
