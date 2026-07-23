using Aidan.Core.Errors;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Events.Services;

/// <summary>
/// Emits durable start checkpoints and named failures.
/// </summary>
public sealed class SessionStartEvents : ISessionStartEvents
{
    private readonly IJournalWriter _writer;
    private readonly Guid _sessionId;
    private readonly Guid _profileId;

    public SessionStartEvents(
        IJournalWriter writer,
        Guid sessionId,
        Guid profileId)
    {
        _writer = writer;
        _sessionId = sessionId;
        _profileId = profileId;
    }

    public void SlotAcquired()
    {
        _writer.Append(new SlotAcquired
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void ConnectionStarted()
    {
        _writer.Append(new ConnectionStarted
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void BrowserLaunched()
    {
        _writer.Append(new BrowserLaunched
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void ProfileStateRestored()
    {
        _writer.Append(new ProfileStateRestored
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void InitialUrlResolved(string url)
    {
        _writer.Append(new InitialUrlResolved
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Url = url,
        });
    }

    public void InitialNavigationCompleted()
    {
        _writer.Append(new InitialNavigationCompleted
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void ProfileNotFound()
    {
        _writer.Append(new ProfileNotFound
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void NoSlotAvailable()
    {
        _writer.Append(new NoSlotAvailable
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
        });
    }

    public void ConnectionStartFailed(Error[] errors)
    {
        _writer.Append(new ConnectionStartFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(errors),
        });
    }

    public void LaunchBrowserFailed(Error[] errors)
    {
        _writer.Append(new LaunchBrowserFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(errors),
        });
    }

    public void RestoreProfileStateFailed(Error[] errors)
    {
        _writer.Append(new RestoreProfileStateFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(errors),
        });
    }

    public void InitialUrlResolveFailed(Error[] errors)
    {
        _writer.Append(new InitialUrlResolveFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(errors),
        });
    }

    public void InitialNavigationFailed(Error[] errors)
    {
        _writer.Append(new InitialNavigationFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(errors),
        });
    }
}
