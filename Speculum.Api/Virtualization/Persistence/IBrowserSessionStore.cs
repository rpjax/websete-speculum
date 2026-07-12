namespace Speculum.Api.Virtualization.Persistence;

public interface IBrowserSessionStore
{
    Task InitializeAsync(CancellationToken ct = default);
    Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default);
    Task<BrowserStatePayload?> LoadStateAsync(string sessionId, CancellationToken ct = default);
    Task SaveStateAsync(string sessionId, BrowserStatePayload state, CancellationToken ct = default);
    Task<IReadOnlyList<BrowserSessionMetadata>> ListSessionsAsync(CancellationToken ct = default);
    Task<BrowserSessionDetail?> GetSessionDetailAsync(string sessionId, CancellationToken ct = default);
    Task<bool> DeleteSessionAsync(string sessionId, CancellationToken ct = default);
    Task RefreshPolicyAsync(CancellationToken ct = default);
    Task PurgeExpiredAsync(CancellationToken ct = default);
}
