namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Commands the API pushes to the single browser client attached to a live session.
/// Presentation adapts these to SignalR server→client invokes.
/// </summary>
public interface IAttachedSessionClient
{
    Task SyncUrlAsync(string url, CancellationToken cancellationToken = default);

    Task RedirectAsync(string url, CancellationToken cancellationToken = default);

    /// <summary>
    /// Authoritative signal that the live session ended (fault, crash, or transport loss).
    /// The client must clear local live state; do not wait for a later Stop invoke.
    /// </summary>
    Task SessionEndedAsync(
        Guid sessionId,
        string reason,
        string? errorCode = null,
        string? message = null,
        CancellationToken cancellationToken = default);
}
