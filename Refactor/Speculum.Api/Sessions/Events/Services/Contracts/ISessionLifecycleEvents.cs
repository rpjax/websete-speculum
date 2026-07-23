namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Coarse session lifecycle envelope (entered / left Live).
/// </summary>
public interface ISessionLifecycleEvents
{
    void Starting();
    void Started();

    void Stopping();
    void Stopped();

    void TimedOut();
    void Aborted();
}
