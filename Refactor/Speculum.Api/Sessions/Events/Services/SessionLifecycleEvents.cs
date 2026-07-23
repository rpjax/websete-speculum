using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Events.Services;

/// <summary>
/// Emits durable lifecycle facts for session transitions.
/// </summary>
public sealed class SessionLifecycleEvents : ISessionLifecycleEvents
{
    private readonly IJournalWriter _writer;
    private readonly Guid _sessionId;
    private readonly Guid _profileId;

    public SessionLifecycleEvents(
        IJournalWriter writer,
        Guid sessionId,
        Guid profileId)
    {
        _writer = writer;
        _sessionId = sessionId;
        _profileId = profileId;
    }

    public void Starting()
    {
        _writer.Append(new SessionStarting
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void Started()
    {
        _writer.Append(new SessionStarted
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void Stopping()
    {
        _writer.Append(new SessionStopping
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void Stopped()
    {
        _writer.Append(new SessionStopped
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void TimedOut()
    {
        _writer.Append(new SessionTimedOut
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void Aborted()
    {
        _writer.Append(new SessionAborted
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }
}
