using Aidan.Core.Errors;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Explicit start checkpoints and failures (no phase enum).
/// </summary>
public interface ISessionStartEvents
{
    void SlotAcquired();
    void ConnectionStarted();
    void BrowserLaunched();
    void ProfileStateRestored();
    void InitialUrlResolved(string url);
    void InitialNavigationCompleted();

    void ProfileNotFound();
    void NoSlotAvailable();
    void ConnectionStartFailed(Error[] errors);
    void LaunchBrowserFailed(Error[] errors);
    void RestoreProfileStateFailed(Error[] errors);
    void InitialUrlResolveFailed(Error[] errors);
    void InitialNavigationFailed(Error[] errors);
}
