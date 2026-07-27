using Aidan.Core.Errors;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Events.Services;

/// <summary>
/// Emits live-session runtime observations to the Journal.
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

    public void NavigateUrlResolved(string url)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);

        _writer.Append(new NavigateUrlResolved
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Url = url,
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

    public void LocationChanged(string url)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);

        _writer.Append(new LocationChanged
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Url = url,
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

    public void InputRejected(string? errorCode, string? message, string? phase)
    {
        _writer.Append(new InputRejected
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            ErrorCode = errorCode,
            Message = message,
            Phase = phase,
        });
    }

    public void InputApplied(string kind, string? phase)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(kind);

        _writer.Append(new InputApplied
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Kind = kind.Trim(),
            Phase = phase,
        });
    }

    public void ResizeApplied(int width, int height, string? resizeId)
    {
        _writer.Append(new ResizeApplied
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Width = width,
            Height = height,
            ResizeId = resizeId,
        });
    }

    public void ResizeRejected(
        int? width,
        int? height,
        string? resizeId,
        string? errorCode,
        string? message,
        string? phase)
    {
        _writer.Append(new ResizeRejected
        {
            SessionId = _sessionId,
            ProfileId = _profileId,
            Width = width,
            Height = height,
            ResizeId = resizeId,
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
