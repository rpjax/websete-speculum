using Microsoft.Extensions.Logging.Abstractions;
using Websete.Speculum.Host.Virtualization.Persistence;

namespace Websete.Speculum.Host.Tests;

public sealed class ProfileSnapshotMergerTests
{
    [Fact]
    public async Task MergeAndSaveAsync_saves_incoming_when_no_existing_snapshot()
    {
        var store  = new InMemorySnapshotStore();
        var client = new RecordingMergeClient();
        var merger = new ProfileSnapshotMerger(store, client, NullLogger<ProfileSnapshotMerger>.Instance);

        var incoming = new byte[] { 1, 2, 3 };
        await merger.MergeAndSaveAsync("cookie-a", incoming, "https://example.com/a", DateTimeOffset.UtcNow);

        Assert.Equal(incoming, store.LastSavedBlob);
        Assert.Equal("https://example.com/a", store.LastSavedUrl);
        Assert.Equal(0, client.MergeCallCount);
    }

    [Fact]
    public async Task MergeAndSaveAsync_merges_when_existing_snapshot_present()
    {
        var store  = new InMemorySnapshotStore();
        var client = new RecordingMergeClient { MergedResult = new byte[] { 9, 9 } };
        var merger = new ProfileSnapshotMerger(store, client, NullLogger<ProfileSnapshotMerger>.Instance);

        var existing = new byte[] { 4, 5 };
        var incoming = new byte[] { 6, 7 };
        await store.SeedAsync("cookie-b", existing, "https://example.com/old", DateTimeOffset.Parse("2024-01-01T00:00:00Z"));

        await merger.MergeAndSaveAsync(
            "cookie-b",
            incoming,
            "https://example.com/new",
            DateTimeOffset.Parse("2025-01-01T00:00:00Z"));

        Assert.Equal(1, client.MergeCallCount);
        Assert.Equal(existing, client.LastBase);
        Assert.Equal(incoming, client.LastIncoming);
        Assert.Equal(new byte[] { 9, 9 }, store.LastSavedBlob);
        Assert.Equal("https://example.com/new", store.LastSavedUrl);
    }

    [Fact]
    public async Task MergeAndSaveAsync_keeps_existing_url_when_capture_is_older()
    {
        var store  = new InMemorySnapshotStore();
        var client = new RecordingMergeClient { MergedResult = new byte[] { 1 } };
        var merger = new ProfileSnapshotMerger(store, client, NullLogger<ProfileSnapshotMerger>.Instance);

        await store.SeedAsync(
            "cookie-c",
            [1],
            "https://example.com/current",
            DateTimeOffset.Parse("2025-06-01T00:00:00Z"));

        await merger.MergeAndSaveAsync(
            "cookie-c",
            [2],
            "https://example.com/stale",
            DateTimeOffset.Parse("2025-01-01T00:00:00Z"));

        Assert.Equal("https://example.com/current", store.LastSavedUrl);
    }

    [Fact]
    public async Task MergeAndSaveAsync_serializes_concurrent_writes_for_same_cookie()
    {
        var store  = new InMemorySnapshotStore();
        var client = new RecordingMergeClient
        {
            MergedResult = new byte[] { 1 },
            MergeDelay   = TimeSpan.FromMilliseconds(80),
        };
        var merger = new ProfileSnapshotMerger(store, client, NullLogger<ProfileSnapshotMerger>.Instance);
        await store.SeedAsync("cookie-d", [9], "https://example.com", DateTimeOffset.UtcNow);

        var first  = merger.MergeAndSaveAsync("cookie-d", [1], "https://a", DateTimeOffset.UtcNow);
        await Task.Delay(10);
        var second = merger.MergeAndSaveAsync("cookie-d", [2], "https://b", DateTimeOffset.UtcNow);

        await Task.WhenAll(first, second);

        Assert.Equal(2, client.MergeCallCount);
        Assert.Equal(2, store.SaveCount);
    }

    private sealed class InMemorySnapshotStore : IBrowserSnapshotStore
    {
        private readonly Dictionary<string, BrowserSnapshotRecord> _rows = new();

        public byte[]? LastSavedBlob { get; private set; }
        public string? LastSavedUrl  { get; private set; }
        public int SaveCount         { get; private set; }

        public int TtlDays => 30;

        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;

        public Task<BrowserSnapshotRecord?> TryLoadAsync(string cookieId, CancellationToken ct = default)
        {
            _rows.TryGetValue(cookieId, out var row);
            return Task.FromResult(row);
        }

        public Task SaveAsync(string cookieId, byte[] profileBlob, string lastUrl, CancellationToken ct = default)
        {
            SaveCount++;
            LastSavedBlob = profileBlob;
            LastSavedUrl  = lastUrl;
            _rows[cookieId] = new BrowserSnapshotRecord
            {
                CookieId    = cookieId,
                ProfileBlob = profileBlob,
                LastUrl     = lastUrl,
                UpdatedAt   = DateTimeOffset.UtcNow,
            };
            return Task.CompletedTask;
        }

        public Task SeedAsync(string cookieId, byte[] blob, string url, DateTimeOffset updatedAt)
        {
            _rows[cookieId] = new BrowserSnapshotRecord
            {
                CookieId    = cookieId,
                ProfileBlob = blob,
                LastUrl     = url,
                UpdatedAt   = updatedAt,
            };
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<BrowserSnapshotMetadata>> ListAsync(CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<BrowserSnapshotMetadata>>([]);

        public Task<bool> DeleteAsync(string cookieId, CancellationToken ct = default) => Task.FromResult(false);

        public Task PurgeExpiredAsync(CancellationToken ct = default) => Task.CompletedTask;

        public Task RefreshPolicyAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class RecordingMergeClient : Virtualization.Sidecar.ISidecarProfileMergeClient
    {
        public int MergeCallCount { get; private set; }
        public byte[]? LastBase { get; private set; }
        public byte[]? LastIncoming { get; private set; }
        public byte[] MergedResult { get; init; } = [];
        public TimeSpan MergeDelay { get; init; }

        public async Task<byte[]> MergeProfilesAsync(
            byte[] baseBlob,
            byte[] incomingBlob,
            CancellationToken ct = default)
        {
            MergeCallCount++;
            LastBase     = baseBlob;
            LastIncoming = incomingBlob;
            if (MergeDelay > TimeSpan.Zero)
                await Task.Delay(MergeDelay, ct);
            return MergedResult.Length > 0 ? MergedResult : incomingBlob;
        }
    }
}
