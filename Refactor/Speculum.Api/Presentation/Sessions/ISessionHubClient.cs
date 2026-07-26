using Speculum.Api.Presentation.Sessions.Dtos;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Strongly typed server→client methods on <see cref="SessionHub"/>.
/// </summary>
public interface ISessionHubClient
{
    Task SyncUrl(SyncUrlHubEvent message);

    Task Redirect(RedirectHubEvent message);
}
