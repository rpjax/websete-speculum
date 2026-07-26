using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Events.Services;

/// <summary>
/// Emits live-session runtime failures to the Journal.
/// </summary>
public sealed class SessionLiveEvents : ISessionLiveEvents
{
    private readonly IJournalWriter _writer;
    private readonly Guid _sessionId;
    private readonly Guid _profileId;

    public SessionLiveEvents(
        IJournalWriter writer,
        Guid sessionId,
        Guid profileId)
    {
        _writer = writer;
        _sessionId = sessionId;
        _profileId = profileId;
    }

    public void AttachedClientCommandFailed(string command, Exception exception)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(command);
        ArgumentNullException.ThrowIfNull(exception);

        _writer.Append(new AttachedClientCommandFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Command = command,
            Errors = JournalError.From(exception),
        });
    }

    public void FeatureLoopFaulted(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);

        _writer.Append(new FeatureLoopFaulted
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Errors = JournalError.From(exception),
        });
    }
}
