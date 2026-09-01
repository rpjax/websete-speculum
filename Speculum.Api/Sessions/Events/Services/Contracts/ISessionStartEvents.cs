using Aidan.Core.Errors;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Domain start narrative checkpoints and failures (no capacity / URL-resolve hops).
/// </summary>
public interface ISessionStartEvents
{
    void ConnectionStarted();
    void BrowserLaunched();
    void ProfileStateRestored(CookieNormalizeStats cookieNormalize);
    void InitialNavigationCompleted(string url);

    void ProfileNotFound();
    void StartConfigurationRejected(Error[] errors);
    void StartRefused(string reason, Error[]? errors = null);
    void ConnectionStartFailed(Error[] errors);
    void LaunchBrowserFailed(Error[] errors);
    void RestoreProfileStateFailed(Error[] errors);
    void InitialNavigationFailed(Error[] errors, string phase, string? url = null);
}
