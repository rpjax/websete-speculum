namespace Websete.Speculum.Host.Virtualization.Persistence;

public interface IBrowserSnapshotStore
{
    Task InitializeAsync(CancellationToken ct = default);
    Task<BrowserSnapshotRecord?> TryLoadAsync(string cookieId, CancellationToken ct = default);
    Task SaveAsync(string cookieId, byte[] profileBlob, string lastUrl, CancellationToken ct = default);
    Task<IReadOnlyList<BrowserSnapshotMetadata>> ListAsync(CancellationToken ct = default);
    Task<bool> DeleteAsync(string cookieId, CancellationToken ct = default);
    Task PurgeExpiredAsync(CancellationToken ct = default);
    Task RefreshPolicyAsync(CancellationToken ct = default);
    int TtlDays { get; }
}
