using Aidan.Core.Errors;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Explicit stop checkpoints and soft failures (teardown still completes).
/// </summary>
public interface ISessionStopEvents
{
    void SessionStatePersisted();

    void PersistSkippedNoConnection();
    void PersistSkippedProfileNotFound();
    void ExportSessionStateFailed(Error[] errors);

    void CloseBrowserFailed(Error[] errors);
    void CloseConnectionFailed(Error[] errors);

    void BrowserClosed();
    void ConnectionClosed();
    void SlotReleased();
}
