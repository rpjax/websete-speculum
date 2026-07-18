using Aidan.Core.Errors;

namespace Speculum.Api.BrowserSessions.Services.Contracts;

/// <summary>
/// Explicit start checkpoints and failures (no phase enum).
/// </summary>
public interface ISessionStartEvents
{
    void SlotAcquired(Guid sessionId);
    void ConnectionStarted(Guid sessionId);
    void BrowserLaunched(Guid sessionId);
    void ProfileStateRestored(Guid sessionId);
    void InitialUrlResolved(Guid sessionId, string url);
    void InitialNavigationCompleted(Guid sessionId);

    void ProfileNotFound(Guid sessionId, Guid profileId);
    void NoSlotAvailable(Guid sessionId);
    void ConnectionStartFailed(Guid sessionId, Error[] errors);
    void LaunchBrowserFailed(Guid sessionId, Error[] errors);
    void RestoreProfileStateFailed(Guid sessionId, Error[] errors);
    void InitialUrlResolveFailed(Guid sessionId, Error[] errors);
    void InitialNavigationFailed(Guid sessionId, Error[] errors);
}
