namespace Speculum.Api.Sessions.Services.Contracts;

public interface ISessionCollector
{
    /// <summary>Begin accounting for a live session at refcount 0 (timer armed).</summary>
    void Watch(Guid sessionId);
    /// <summary>Consumer (pipe) acquired. 0→1 cancels timer.</summary>
    void AddRef(Guid sessionId);
    /// <summary>Consumer released. →0 resets timer.</summary>
    void Release(Guid sessionId);
    /// <summary>Stop accounting; drop timer without TimedOut (explicit stop/abort).</summary>
    void Unwatch(Guid sessionId);
}
