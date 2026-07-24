namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Reference-counted detached-session timer. Does not know why refs are held —
/// only whether the count is zero (timer armed) or positive (timer cancelled).
/// </summary>
public interface ISessionCollector
{
    /// <summary>Begin accounting at refcount 0 (timer armed).</summary>
    void Watch(Guid sessionId);

    /// <summary>Increment refcount. 0→1 cancels the timer.</summary>
    void AddRef(Guid sessionId);

    /// <summary>Decrement refcount. →0 arms the timer.</summary>
    void Release(Guid sessionId);

    /// <summary>Stop accounting and drop the timer without TimedOut.</summary>
    void Unwatch(Guid sessionId);
}
