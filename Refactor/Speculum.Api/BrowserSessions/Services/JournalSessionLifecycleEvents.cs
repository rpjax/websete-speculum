using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.BrowserSessions.Journal;
using Speculum.Api.BrowserSessions.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.BrowserSessions.Services;

/// <summary>
/// Emits durable lifecycle facts for terminal session transitions.
/// </summary>
public sealed class JournalSessionLifecycleEvents : ISessionLifecycleEvents
{
    private readonly IJournalWriter _writer;
    private readonly IServiceScopeFactory _scopeFactory;

    public JournalSessionLifecycleEvents(
        IJournalWriter writer,
        IServiceScopeFactory scopeFactory)
    {
        _writer = writer ?? throw new ArgumentNullException(nameof(writer));
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
    }

    public void Starting(Guid sessionId) { }

    public void Started(Guid sessionId) { }

    public void Stopping(Guid sessionId) { }

    public void Stopped(Guid sessionId)
    {
        if (!TryResolveProfileId(sessionId, out var profileId))
        {
            return;
        }

        _writer.Append(new SessionStopped
        {
            SessionId = sessionId,
            ProfileId = profileId,
        });
    }

    public void TimedOut(Guid sessionId)
    {
        if (!TryResolveProfileId(sessionId, out var profileId))
        {
            return;
        }

        _writer.Append(new SessionTimedOut
        {
            SessionId = sessionId,
            ProfileId = profileId,
        });
    }

    public void Aborted(Guid sessionId)
        => _writer.Append(new SessionAborted { SessionId = sessionId });

    private bool TryResolveProfileId(Guid sessionId, out Guid profileId)
    {
        using var scope = _scopeFactory.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<ISessionRepository>();
        var session = repository.LoadAsync(sessionId).GetAwaiter().GetResult();
        if (session is null)
        {
            profileId = default;
            return false;
        }

        profileId = session.ProfileId;
        return true;
    }
}
