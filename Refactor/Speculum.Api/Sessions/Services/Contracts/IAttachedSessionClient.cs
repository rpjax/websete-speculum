namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Commands the API pushes to the single browser client attached to a live session.
/// Presentation adapts these to SignalR server→client invokes.
/// </summary>
public interface IAttachedSessionClient
{
    Task SyncUrlAsync(string url, CancellationToken cancellationToken = default);

    Task RedirectAsync(string url, CancellationToken cancellationToken = default);
}
