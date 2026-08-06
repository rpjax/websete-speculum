using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services.Contracts;

public interface ISessionBindingRegistry
{
    SessionBindingStart BeginStart(string callerId, Guid sessionId);

    bool TryPromote(
        string callerId,
        Guid sessionId,
        Guid attachmentId,
        string token);

    bool TryCancelStart(string callerId, Guid sessionId);

    /// <summary>
    /// Cancels every in-flight start (not yet promoted). Returns how many starts were cancelled.
    /// </summary>
    int CancelAllStarts();

    void CompleteStart(Guid sessionId);

    bool IsAuthorized(string callerId, Guid sessionId, string token);

    bool TryGetLive(
        Guid sessionId,
        string token,
        out SessionBinding binding);

    /// <summary>Resolve a live binding from session token alone (virtual-asset GETs).</summary>
    bool TryGetLiveByToken(string token, out SessionBinding binding);

    IResult RegisterPipe(
        Guid sessionId,
        string token,
        Guid pipeId,
        IDisposable resource);

    void UnregisterPipe(Guid pipeId);

    void CloseCaller(string callerId);

    void CloseSession(Guid sessionId);
}

public sealed record SessionBindingStart(
    CancellationToken CancellationToken,
    Guid? ReplacedSessionId,
    Task PreviousStartCompletion);

public sealed record SessionBinding(
    string CallerId,
    Guid SessionId,
    Guid AttachmentId,
    string Token);
