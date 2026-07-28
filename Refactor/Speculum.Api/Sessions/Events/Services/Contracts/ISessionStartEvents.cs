using Aidan.Core.Errors;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Domain start narrative checkpoints and failures (no capacity / URL-resolve hops).
/// </summary>
public interface ISessionStartEvents
{
    void ConnectionStarted();
    void BrowserLaunched();
    void ProfileStateRestored();
    void InitialNavigationCompleted();

    void ProfileNotFound();
    void StartConfigurationRejected(Error[] errors);
    void ConnectionStartFailed(Error[] errors);
    void LaunchBrowserFailed(Error[] errors);
    void RestoreProfileStateFailed(Error[] errors);
    void InitialNavigationFailed(Error[] errors);
}
