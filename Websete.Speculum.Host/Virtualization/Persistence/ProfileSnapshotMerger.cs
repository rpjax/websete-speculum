using System.Collections.Concurrent;

namespace Websete.Speculum.Host.Virtualization.Persistence;

public interface IProfileSnapshotMerger
{
    Task MergeAndSaveAsync(
        string cookieId,
        byte[] incomingBlob,
        string lastUrl,
        DateTimeOffset capturedAt,
        CancellationToken ct = default);
}

public sealed class ProfileSnapshotMerger : IProfileSnapshotMerger
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> CookieLocks = new();

    private readonly IBrowserSnapshotStore        _store;
    private readonly Sidecar.ISidecarProfileMergeClient _mergeClient;
    private readonly ILogger<ProfileSnapshotMerger> _logger;

    public ProfileSnapshotMerger(
        IBrowserSnapshotStore store,
        Sidecar.ISidecarProfileMergeClient mergeClient,
        ILogger<ProfileSnapshotMerger> logger)
    {
        _store       = store;
        _mergeClient = mergeClient;
        _logger      = logger;
    }

    public async Task MergeAndSaveAsync(
        string cookieId,
        byte[] incomingBlob,
        string lastUrl,
        DateTimeOffset capturedAt,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(cookieId))
            throw new ArgumentException("Cookie id is required.", nameof(cookieId));

        var gate = CookieLocks.GetOrAdd(cookieId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            var existing = await _store.TryLoadAsync(cookieId, ct);
            byte[] blobToSave;
            string urlToSave;

            if (existing is null || existing.ProfileBlob.Length == 0)
            {
                blobToSave = incomingBlob;
                urlToSave  = lastUrl;
            }
            else
            {
                blobToSave = await _mergeClient.MergeProfilesAsync(
                    existing.ProfileBlob, incomingBlob, ct);

                urlToSave = capturedAt >= existing.UpdatedAt ? lastUrl : existing.LastUrl;
            }

            await _store.SaveAsync(cookieId, blobToSave, urlToSave, ct);

            _logger.LogInformation(
                "Snapshot merged for cookie {CookiePrefix}… ({Bytes} bytes)",
                cookieId[..Math.Min(8, cookieId.Length)], blobToSave.Length);
        }
        finally
        {
            gate.Release();
        }
    }
}
