using Aidan.Core.Errors;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Events.Services;

/// <summary>
/// Emits domain live-session runtime observations to the Journal.
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

    public void NavigateRequested(string path, string query)
    {
        _writer.Append(new NavigateRequested
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Path = path ?? string.Empty,
            Query = query ?? string.Empty,
        });
    }

    public void NavigateCompleted(string url)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);

        _writer.Append(new NavigateCompleted
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Url = url,
        });
    }

    public void NavigateFailed(string phase, Error[] errors)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(phase);
        ArgumentNullException.ThrowIfNull(errors);

        _writer.Append(new NavigateFailed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Phase = phase,
            Errors = JournalError.From(errors),
        });
    }

    public void MainFrameNavigationBlocked(string url, string? errorCode, string? message)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);

        _writer.Append(new MainFrameNavigationBlocked
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Url = url,
            ErrorCode = errorCode,
            Message = message,
        });
    }

    public void BrowserCrashed(string? errorCode, string? message, string? phase)
    {
        _writer.Append(new BrowserCrashed
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            ErrorCode = errorCode,
            Message = message,
            Phase = phase,
        });
    }

    public void LiveSessionAbandoned(string reason, string? errorCode, string? message)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);

        _writer.Append(new LiveSessionAbandoned
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Reason = reason,
            ErrorCode = errorCode,
            Message = message,
        });
    }
}
