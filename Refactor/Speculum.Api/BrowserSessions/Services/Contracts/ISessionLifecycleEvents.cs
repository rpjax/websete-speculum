using Aidan.Core.Errors;

namespace Speculum.Api.BrowserSessions.Services.Contracts;

/// <summary>
/// Coarse session lifecycle envelope (entered / left Live).
/// </summary>
public interface ISessionLifecycleEvents
{
    void Starting(Guid sessionId);
    void Started(Guid sessionId);

    void Stopping(Guid sessionId);
    void Stopped(Guid sessionId);

    void TimedOut(Guid sessionId);
    void Aborted(Guid sessionId);
}
