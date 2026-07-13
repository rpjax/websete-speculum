using Speculum.Api.Motor.Live;

namespace Speculum.Api.BrowserPersistence;

public sealed class BrowserSessionStore : IBrowserSessionStore
{
    private readonly BrowserSessionSchema _schema;
    private readonly BrowserSessionRegistry _registry;
    private readonly BrowserSessionStateStore _state;
    private readonly BrowserSessionAdminQueries _admin;

    public BrowserSessionStore(string databasePath, ILogger<BrowserSessionStore> logger)
    {
        var db = new BrowserSessionDatabase(databasePath);
        _registry = new BrowserSessionRegistry(db);
        _state    = new BrowserSessionStateStore(db, _registry, logger);
        _admin    = new BrowserSessionAdminQueries(db, _state, logger);
        _schema   = new BrowserSessionSchema(db);
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await _schema.InitializeAsync(ct);
        await _registry.RefreshTtlFromConfigAsync(ct);
        await _admin.PurgeExpiredAsync(ct);
    }

    public Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
        => _registry.ResolveOrCreateSessionAsync(clientToken, ct);

    public Task<(string SessionId, string ClientToken)> ResolveOrCreateSessionAsync(
        SessionIdentity identity,
        CancellationToken ct = default)
        => _registry.ResolveOrCreateSessionAsync(identity, ct);

    public Task<BrowserStatePayload?> LoadStateAsync(string sessionId, CancellationToken ct = default)
        => _state.LoadStateAsync(sessionId, ct);

    public Task SaveStateAsync(string sessionId, BrowserStatePayload state, CancellationToken ct = default)
        => _state.SaveStateAsync(sessionId, state, ct);

    public Task<IReadOnlyList<BrowserSessionMetadata>> ListSessionsAsync(CancellationToken ct = default)
        => _admin.ListSessionsAsync(ct);

    public Task<BrowserSessionDetail?> GetSessionDetailAsync(string sessionId, CancellationToken ct = default)
        => _admin.GetSessionDetailAsync(sessionId, ct);

    public Task<bool> DeleteSessionAsync(string sessionId, CancellationToken ct = default)
        => _admin.DeleteSessionAsync(sessionId, ct);

    public Task PurgeExpiredAsync(CancellationToken ct = default)
        => _admin.PurgeExpiredAsync(ct);

    public async Task RefreshPolicyAsync(CancellationToken ct = default)
    {
        await _registry.RefreshTtlFromConfigAsync(ct);
        await _admin.PurgeExpiredAsync(ct);
    }
}
