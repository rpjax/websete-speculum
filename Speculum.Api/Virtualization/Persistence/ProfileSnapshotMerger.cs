using System.Collections.Concurrent;

namespace Speculum.Api.Virtualization.Persistence;

public interface IProfileSnapshotMerger
{
    Task MergeAndSaveAsync(
        string sessionId,
        byte[] incomingBlob,
        string lastUrl,
        DateTimeOffset capturedAt,
        CancellationToken ct = default);
}

public sealed class ProfileSnapshotMerger : IProfileSnapshotMerger
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> SessionLocks = new();

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
        string sessionId,
        byte[] incomingBlob,
        string lastUrl,
        DateTimeOffset capturedAt,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
            throw new ArgumentException("Session id is required.", nameof(sessionId));

        var gate = SessionLocks.GetOrAdd(sessionId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            var existing = await _store.TryLoadAsync(sessionId, ct);
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

            await _store.SaveAsync(sessionId, blobToSave, urlToSave, ct);

            _logger.LogInformation(
                "Snapshot merged for session {SessionPrefix}… ({Bytes} bytes)",
                sessionId[..Math.Min(8, sessionId.Length)], blobToSave.Length);
        }
        finally
        {
            gate.Release();
        }
    }
}
