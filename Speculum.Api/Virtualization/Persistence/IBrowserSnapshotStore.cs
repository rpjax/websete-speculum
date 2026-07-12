namespace Speculum.Api.Virtualization.Persistence;

public interface IBrowserSnapshotStore
{
    Task InitializeAsync(CancellationToken ct = default);
    Task<BrowserSnapshotRecord?> TryLoadAsync(string sessionId, CancellationToken ct = default);
    Task SaveAsync(string sessionId, byte[] profileBlob, string lastUrl, CancellationToken ct = default);
    Task<IReadOnlyList<BrowserSnapshotMetadata>> ListAsync(CancellationToken ct = default);
    Task<bool> DeleteAsync(string sessionId, CancellationToken ct = default);
    Task PurgeExpiredAsync(CancellationToken ct = default);
    Task RefreshPolicyAsync(CancellationToken ct = default);
    int TtlDays { get; }
}
