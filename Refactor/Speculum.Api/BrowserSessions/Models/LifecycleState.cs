namespace Speculum.Api.BrowserSessions.Models;

public enum LifecycleState
{
    Created,
    Live,
    // terminal states
    Stopped,
    Aborted,
}
