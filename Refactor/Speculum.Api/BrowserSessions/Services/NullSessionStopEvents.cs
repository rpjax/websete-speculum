using Aidan.Core.Errors;
using Speculum.Api.BrowserSessions.Services.Contracts;

namespace Speculum.Api.BrowserSessions.Services;

/// <summary>No-op stop checkpoints until diagnostics wiring lands.</summary>
public sealed class NullSessionStopEvents : ISessionStopEvents
{
    public void SessionStatePersisted(Guid sessionId) { }
    public void PersistSkippedNoConnection(Guid sessionId) { }
    public void PersistSkippedProfileNotFound(Guid sessionId, Guid profileId) { }
    public void ExportSessionStateFailed(Guid sessionId, Error[] errors) { }
    public void CloseBrowserFailed(Guid sessionId, Error[] errors) { }
    public void CloseConnectionFailed(Guid sessionId, Error[] errors) { }
    public void BrowserClosed(Guid sessionId) { }
    public void ConnectionClosed(Guid sessionId) { }
    public void SlotReleased(Guid sessionId) { }
}
