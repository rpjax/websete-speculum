using Aidan.Core.Errors;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Domain stop narrative checkpoints and soft failures (teardown still completes).
/// </summary>
public interface ISessionStopEvents
{
    void SessionStatePersisted();

    void ExportSessionStateFailed(Error[] errors);

    void CloseBrowserFailed(Error[] errors);
    void CloseConnectionFailed(Error[] errors);

    void BrowserClosed();
    void ConnectionClosed();
}
