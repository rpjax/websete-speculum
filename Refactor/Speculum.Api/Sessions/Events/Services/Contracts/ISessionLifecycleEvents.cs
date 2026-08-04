using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Coarse session lifecycle envelope (entered / left Live).
/// </summary>
public interface ISessionLifecycleEvents
{
    void Starting();
    void Started();

    void Stopping(StopReason reason);
    void Stopped(StopReason reason);

    void TimedOut(StopReason reason);
    void Aborted(StopReason reason, JournalError[]? errors = null);
}
