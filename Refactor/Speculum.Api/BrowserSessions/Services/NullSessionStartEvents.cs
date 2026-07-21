using Aidan.Core.Errors;
using Speculum.Api.BrowserSessions.Services.Contracts;

namespace Speculum.Api.BrowserSessions.Services;

/// <summary>No-op start checkpoints until diagnostics wiring lands.</summary>
public sealed class NullSessionStartEvents : ISessionStartEvents
{
    public void SlotAcquired(Guid sessionId) { }
    public void ConnectionStarted(Guid sessionId) { }
    public void BrowserLaunched(Guid sessionId) { }
    public void ProfileStateRestored(Guid sessionId) { }
    public void InitialUrlResolved(Guid sessionId, string url) { }
    public void InitialNavigationCompleted(Guid sessionId) { }
    public void ProfileNotFound(Guid sessionId, Guid profileId) { }
    public void NoSlotAvailable(Guid sessionId) { }
    public void ConnectionStartFailed(Guid sessionId, Error[] errors) { }
    public void LaunchBrowserFailed(Guid sessionId, Error[] errors) { }
    public void RestoreProfileStateFailed(Guid sessionId, Error[] errors) { }
    public void InitialUrlResolveFailed(Guid sessionId, Error[] errors) { }
    public void InitialNavigationFailed(Guid sessionId, Error[] errors) { }
}
