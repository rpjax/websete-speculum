using Speculum.Api.Presentation.Sessions.Dtos;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Adapts <see cref="IAttachedSessionClient"/> to typed SignalR server→client invokes.
/// Bound to one hub connection for the life of the attach.
/// </summary>
internal sealed class SignalRAttachedSessionClient : IAttachedSessionClient
{
    private readonly ISessionHubClient _caller;

    public SignalRAttachedSessionClient(ISessionHubClient caller)
    {
        _caller = caller ?? throw new ArgumentNullException(nameof(caller));
    }

    public Task SyncUrlAsync(string url, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var normalized = NormalizeUrl(url);
        return _caller.SyncUrl(new SyncUrlHubEvent { Url = normalized });
    }

    public Task RedirectAsync(string url, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var normalized = NormalizeUrl(url);
        return _caller.Redirect(new RedirectHubEvent { Url = normalized });
    }

    public Task SessionEndedAsync(
        Guid sessionId,
        string reason,
        string? errorCode = null,
        string? message = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        return _caller.SessionEnded(new SessionEndedHubEvent
        {
            SessionId = sessionId,
            Reason = reason.Trim(),
            ErrorCode = string.IsNullOrWhiteSpace(errorCode) ? null : errorCode.Trim(),
            Message = string.IsNullOrWhiteSpace(message) ? null : message.Trim(),
        });
    }

    private static string NormalizeUrl(string url)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);
        var trimmed = url.Trim();
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("URL must be an absolute http(s) URI.", nameof(url));
        }

        return trimmed;
    }
}
