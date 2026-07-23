using Aidan.Core.Errors;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Events.Services;

/// <summary>
/// Emits durable stop checkpoints and soft failures.
/// </summary>
public sealed class SessionStopEvents : ISessionStopEvents
{
    private readonly IJournalWriter _writer;
    private readonly Guid _sessionId;
    private readonly Guid _profileId;

    public SessionStopEvents(
        IJournalWriter writer,
        Guid sessionId,
        Guid profileId)
    {
        _writer = writer;
        _sessionId = sessionId;
        _profileId = profileId;
    }

    public void SessionStatePersisted()
    {
        _writer.Append(new SessionStatePersisted
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void PersistSkippedNoConnection()
    {
        _writer.Append(new PersistSkippedNoConnection
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void PersistSkippedProfileNotFound()
    {
        _writer.Append(new PersistSkippedProfileNotFound
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void ExportSessionStateFailed(Error[] errors)
    {
        _writer.Append(new ExportSessionStateFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(errors),
        });
    }

    public void CloseBrowserFailed(Error[] errors)
    {
        _writer.Append(new CloseBrowserFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(errors),
        });
    }

    public void CloseConnectionFailed(Error[] errors)
    {
        _writer.Append(new CloseConnectionFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(errors),
        });
    }

    public void BrowserClosed()
    {
        _writer.Append(new BrowserClosed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void ConnectionClosed()
    {
        _writer.Append(new ConnectionClosed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void SlotReleased()
    {
        _writer.Append(new SlotReleased
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }
}
