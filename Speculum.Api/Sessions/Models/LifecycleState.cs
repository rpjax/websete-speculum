namespace Speculum.Api.Sessions.Models;

public enum LifecycleState
{
    Created,
    Live,
    // terminal states
    Stopped,
    Aborted,
}
