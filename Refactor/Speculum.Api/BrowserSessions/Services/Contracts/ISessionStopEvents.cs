using Aidan.Core.Errors;

namespace Speculum.Api.BrowserSessions.Services.Contracts;

/// <summary>
/// Explicit stop checkpoints and soft failures (teardown still completes).
/// </summary>
public interface ISessionStopEvents
{
    void SessionStatePersisted(Guid sessionId);

    void PersistSkippedNoConnection(Guid sessionId);
    void PersistSkippedProfileNotFound(Guid sessionId, Guid profileId);
    void ExportSessionStateFailed(Guid sessionId, Error[] errors);

    void CloseBrowserFailed(Guid sessionId, Error[] errors);
    void CloseConnectionFailed(Guid sessionId, Error[] errors);

    void BrowserClosed(Guid sessionId);
    void ConnectionClosed(Guid sessionId);
    void SlotReleased(Guid sessionId);
}
