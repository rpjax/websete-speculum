using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Database;
using Speculum.Api.Journal;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Journal.Storage;

namespace Speculum.Api.Journal.Tests;

public sealed class JournalWorkerAndStoreTests
{
    [Fact]
    public async Task Worker_PersistsBatch_ViaScopedRepository()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();

        var services = new ServiceCollection();
        services.AddDbContext<SpeculumDbContext>(o => o.UseSqlite(connection));
        services.AddScoped<IJournalRepository, JournalRepository>();
        services.AddLogging();

        await using var provider = services.BuildServiceProvider();
        await using (var boot = provider.CreateAsyncScope())
        {
            var db = boot.ServiceProvider.GetRequiredService<SpeculumDbContext>();
            await db.Database.EnsureCreatedAsync();
        }

        var options = new JournalDrainOptions
        {
            MaxBatchSize = 16,
            SoftQueueDepth = 10_000,
            HardQueueDepth = 0,
            MaxQueueDepth = 0,
            RecoverAfterSuccessfulBatches = 1,
            RetryBackoff = TimeSpan.FromMilliseconds(10),
            ShutdownFlushTimeout = TimeSpan.FromSeconds(2),
            MaxPersistAttempts = 3,
        };
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(options);
        var metrics = new JournalDrainMetrics();
        var health = new JournalHealth(monitor, metrics, NullLogger<JournalHealth>.Instance);
        var queue = new JournalQueue(monitor, metrics, health, NullLogger<JournalQueue>.Instance);
        var worker = new JournalWorker(
            queue,
            new JournalDrainPolicy(),
            health,
            metrics,
            provider.GetRequiredService<IServiceScopeFactory>(),
            monitor,
            new FakeHostApplicationLifetime(),
            NullLogger<JournalWorker>.Instance);

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed, "Test.Started"));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.BestEffort, "Test.Noise"));

        await ((IHostedService)worker).StartAsync(CancellationToken.None);
        await WaitForAsync(() => metrics.Persisted >= 2, TimeSpan.FromSeconds(5));
        Assert.True(health.IsDrainRunning);
        await ((IHostedService)worker).StopAsync(CancellationToken.None);
        Assert.False(health.IsDrainRunning);
        worker.Dispose();

        await using var scope = provider.CreateAsyncScope();
        var reader = new JournalReader(
            scope.ServiceProvider.GetRequiredService<IJournalRepository>(),
            monitor);
        var rows = await reader.ReadAsync(new JournalQuery { Limit = 10 });
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.True(r.Sequence > 0));
    }

    [Fact]
    public async Task Worker_RetriesBatch_AfterPersistFailure()
    {
        var failing = new FailingThenSucceedingRepository(failCount: 1);
        var services = new ServiceCollection();
        services.AddSingleton(failing);
        services.AddScoped<IJournalRepository>(_ => failing);
        services.AddLogging();
        await using var provider = services.BuildServiceProvider();

        var options = new JournalDrainOptions
        {
            MaxBatchSize = 8,
            SoftQueueDepth = 0,
            HardQueueDepth = 0,
            MaxQueueDepth = 0,
            RecoverAfterSuccessfulBatches = 1,
            RetryBackoff = TimeSpan.FromMilliseconds(20),
            ShutdownFlushTimeout = TimeSpan.FromSeconds(2),
            MaxPersistAttempts = 5,
        };
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(options);
        var metrics = new JournalDrainMetrics();
        var health = new JournalHealth(monitor, metrics, NullLogger<JournalHealth>.Instance);
        var queue = new JournalQueue(monitor, metrics, health, NullLogger<JournalQueue>.Instance);
        var worker = new JournalWorker(
            queue,
            new JournalDrainPolicy(),
            health,
            metrics,
            provider.GetRequiredService<IServiceScopeFactory>(),
            monitor,
            new FakeHostApplicationLifetime(),
            NullLogger<JournalWorker>.Instance);

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed, "Test.G"));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.BestEffort, "Test.BE"));

        await ((IHostedService)worker).StartAsync(CancellationToken.None);
        await WaitForAsync(() => failing.SuccessCalls >= 1, TimeSpan.FromSeconds(5));
        await ((IHostedService)worker).StopAsync(CancellationToken.None);
        worker.Dispose();

        Assert.True(metrics.PersistFailures >= 1);
        Assert.Equal(1, failing.SuccessCalls);
        Assert.Contains(failing.LastPersistedTypes, t => t == "Test.G");
    }

    [Fact]
    public async Task Worker_StopsHost_WhenCrashBudgetExceeded()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        // Persist path unused — loop crashes in TakeBatchAsync.
        services.AddScoped<IJournalRepository, CapturingRepository>();
        await using var provider = services.BuildServiceProvider();

        var lifetime = new FakeHostApplicationLifetime();
        var options = new JournalDrainOptions
        {
            MaxBatchSize = 8,
            SoftQueueDepth = 0,
            HardQueueDepth = 0,
            MaxQueueDepth = 0,
            CrashRestartBackoff = TimeSpan.FromMilliseconds(10),
            MaxCrashesInPeriod = 2,
            CrashPeriod = TimeSpan.FromMinutes(1),
            ShutdownFlushTimeout = TimeSpan.FromSeconds(1),
        };
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(options);
        var metrics = new JournalDrainMetrics();
        var health = new JournalHealth(monitor, metrics, NullLogger<JournalHealth>.Instance);
        var inner = new JournalQueue(monitor, metrics, health, NullLogger<JournalQueue>.Instance);
        var queue = new CrashingTakeBatchQueue(inner);

        var worker = new JournalWorker(
            queue,
            new JournalDrainPolicy(),
            health,
            metrics,
            provider.GetRequiredService<IServiceScopeFactory>(),
            monitor,
            lifetime,
            NullLogger<JournalWorker>.Instance);

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));

        await ((IHostedService)worker).StartAsync(CancellationToken.None);
        await WaitForAsync(() => lifetime.StopCount >= 1, TimeSpan.FromSeconds(5));
        Assert.False(health.IsDrainRunning);
        await ((IHostedService)worker).StopAsync(CancellationToken.None);
        worker.Dispose();

        Assert.True(metrics.LoopCrashes >= 2);
        Assert.Equal(1, lifetime.StopCount);
    }

    [Fact]
    public async Task Worker_Stop_DrainsQueuedEntries()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();

        var services = new ServiceCollection();
        services.AddDbContext<SpeculumDbContext>(o => o.UseSqlite(connection));
        services.AddScoped<IJournalRepository, JournalRepository>();
        services.AddLogging();

        await using var provider = services.BuildServiceProvider();
        await using (var boot = provider.CreateAsyncScope())
        {
            var db = boot.ServiceProvider.GetRequiredService<SpeculumDbContext>();
            await db.Database.EnsureCreatedAsync();
        }

        var options = new JournalDrainOptions
        {
            MaxBatchSize = 16,
            SoftQueueDepth = 0,
            HardQueueDepth = 0,
            MaxQueueDepth = 0,
            RecoverAfterSuccessfulBatches = 1,
            ShutdownFlushTimeout = TimeSpan.FromSeconds(5),
            MaxPersistAttempts = 3,
        };
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(options);
        var metrics = new JournalDrainMetrics();
        var health = new JournalHealth(monitor, metrics, NullLogger<JournalHealth>.Instance);
        var queue = new JournalQueue(monitor, metrics, health, NullLogger<JournalQueue>.Instance);
        var worker = new JournalWorker(
            queue,
            new JournalDrainPolicy(),
            health,
            metrics,
            provider.GetRequiredService<IServiceScopeFactory>(),
            monitor,
            new FakeHostApplicationLifetime(),
            NullLogger<JournalWorker>.Instance);

        await ((IHostedService)worker).StartAsync(CancellationToken.None);
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed, "Test.FlushA"));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed, "Test.FlushB"));
        await ((IHostedService)worker).StopAsync(CancellationToken.None);
        worker.Dispose();

        await using var scope = provider.CreateAsyncScope();
        var reader = new JournalReader(
            scope.ServiceProvider.GetRequiredService<IJournalRepository>(),
            monitor);
        var rows = await reader.ReadAsync(new JournalQuery { Limit = 10 });
        Assert.Equal(2, rows.Count);
        Assert.False(health.IsAdmissionOpen);
    }

    [Fact]
    public async Task HealthCheck_ReportsUnhealthy_WhenDrainNotRunning()
    {
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(new JournalDrainOptions());
        var metrics = new JournalDrainMetrics();
        var health = new JournalHealth(monitor, metrics, NullLogger<JournalHealth>.Instance);
        var queue = new JournalQueue(monitor, metrics, health, NullLogger<JournalQueue>.Instance);
        var check = new JournalHealthCheck(health, queue, metrics);

        var result = await check.CheckHealthAsync(
            new Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckContext());

        Assert.Equal(Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Unhealthy, result.Status);

        health.SetDrainRunning(true);
        result = await check.CheckHealthAsync(
            new Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckContext());
        Assert.Equal(Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Healthy, result.Status);
    }

    [Fact]
    public void OptionsValidator_RejectsZeroShutdownFlushTimeout()
    {
        var validator = new JournalDrainOptionsValidator();
        var result = validator.Validate(
            null,
            new JournalDrainOptions { ShutdownFlushTimeout = TimeSpan.Zero });
        Assert.True(result.Failed);
    }

    [Fact]
    public async Task SaveBatch_IsIdempotent_OnDuplicateIds()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();

        var dbOptions = new DbContextOptionsBuilder<SpeculumDbContext>()
            .UseSqlite(connection)
            .Options;

        await using var db = new SpeculumDbContext(dbOptions);
        await db.Database.EnsureCreatedAsync();

        var repo = new JournalRepository(db, NullLogger<JournalRepository>.Instance);
        var entry = JournalTestHarness.Entry(PublishPolicy.Guaranteed);

        Assert.Equal(1, await repo.SaveBatchAsync([entry]));
        Assert.Equal(0, await repo.SaveBatchAsync([entry]));
        Assert.Equal(1, await db.Set<JournalEntryRecord>().CountAsync());
    }

    [Fact]
    public void Health_PersistDegraded_AutoRecovers_AfterConsecutiveSuccesses()
    {
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(
            new JournalDrainOptions { RecoverAfterSuccessfulBatches = 2 });
        var metrics = new JournalDrainMetrics();
        var health = new JournalHealth(monitor, metrics, NullLogger<JournalHealth>.Instance);

        health.MarkDegraded("boom");
        Assert.Equal(JournalHealthState.Degraded, health.State);
        Assert.True(health.IsPersistDegraded);

        health.NoteSuccess();
        Assert.Equal(JournalHealthState.Degraded, health.State);

        health.NoteSuccess();
        Assert.Equal(JournalHealthState.Healthy, health.State);
        Assert.True(metrics.DegradedRecover >= 1);
    }

    [Fact]
    public void Health_QueuePressure_ClearsWithoutPersistSuccess()
    {
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(new JournalDrainOptions());
        var metrics = new JournalDrainMetrics();
        var health = new JournalHealth(monitor, metrics, NullLogger<JournalHealth>.Instance);

        health.MarkQueuePressure("hard");
        Assert.Equal(JournalHealthState.Degraded, health.State);

        health.ClearQueuePressure();
        Assert.Equal(JournalHealthState.Healthy, health.State);
    }

    [Fact]
    public void Reader_AppliesDefaultLimit()
    {
        var repo = new CapturingRepository();
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(
            new JournalDrainOptions { DefaultReadLimit = 50, MaxReadLimit = 100 });
        var reader = new JournalReader(repo, monitor);

        _ = reader.ReadAsync(new JournalQuery());
        Assert.Equal(50, repo.LastQuery?.Limit);
    }

    [Fact]
    public async Task Reader_RejectsLimitAboveMax()
    {
        var repo = new CapturingRepository();
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(
            new JournalDrainOptions { DefaultReadLimit = 10, MaxReadLimit = 20 });
        var reader = new JournalReader(repo, monitor);

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => reader.ReadAsync(new JournalQuery { Limit = 21 }));
    }

    [Fact]
    public void DiSmoke_AddDatabase_AddJournal_Discover_Ensure()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"speculum-journal-test-{Guid.NewGuid():N}.db");

        try
        {
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
            services.AddDatabase();
            services.Configure<DatabaseOptions>(o => o.Path = dbPath);
            services.AddJournal();
            services.DiscoverJournalFacts();

            using var provider = services.BuildServiceProvider();
            provider.EnsureDatabase();

            using var scope = provider.CreateScope();
            var writer = scope.ServiceProvider.GetRequiredService<IJournalWriter>();
            var catalog = scope.ServiceProvider.GetRequiredService<IJournalCatalog>();
            var db = scope.ServiceProvider.GetRequiredService<SpeculumDbContext>();

            Assert.True(catalog.TryGet<SessionStarted>(out _));
            Assert.NotNull(writer);
            Assert.True(db.Database.CanConnect());
            Assert.Contains(services, d => d.ImplementationType == typeof(JournalWorker));
        }
        finally
        {
            try
            {
                if (File.Exists(dbPath))
                    File.Delete(dbPath);
            }
            catch
            {
                // best-effort cleanup
            }
        }
    }

    private static async Task WaitForAsync(Func<bool> condition, TimeSpan timeout)
    {
        var start = DateTime.UtcNow;
        while (!condition())
        {
            if (DateTime.UtcNow - start > timeout)
                throw new TimeoutException("Condition not met in time.");
            await Task.Delay(20);
        }
    }

    private sealed class CapturingRepository : IJournalRepository
    {
        public JournalQuery? LastQuery { get; private set; }

        public Task<int> SaveBatchAsync(IReadOnlyList<JournalEntry> entries, CancellationToken cancellationToken = default)
            => Task.FromResult(0);

        public Task<IReadOnlyList<JournalEntry>> ReadAsync(JournalQuery query, CancellationToken cancellationToken = default)
        {
            LastQuery = query;
            return Task.FromResult<IReadOnlyList<JournalEntry>>(Array.Empty<JournalEntry>());
        }
    }

    private sealed class FailingThenSucceedingRepository : IJournalRepository
    {
        private int _failuresLeft;
        public int SuccessCalls { get; private set; }
        public List<string> LastPersistedTypes { get; } = new();

        public FailingThenSucceedingRepository(int failCount) => _failuresLeft = failCount;

        public Task<int> SaveBatchAsync(IReadOnlyList<JournalEntry> entries, CancellationToken cancellationToken = default)
        {
            if (_failuresLeft > 0)
            {
                _failuresLeft--;
                throw new InvalidOperationException("simulated persist failure");
            }

            SuccessCalls++;
            LastPersistedTypes.Clear();
            LastPersistedTypes.AddRange(entries.Select(e => e.Type));
            return Task.FromResult(entries.Count);
        }

        public Task<IReadOnlyList<JournalEntry>> ReadAsync(JournalQuery query, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<JournalEntry>>(Array.Empty<JournalEntry>());
    }

    private sealed class CrashingTakeBatchQueue : IJournalQueue
    {
        private readonly IJournalQueue _inner;

        public CrashingTakeBatchQueue(IJournalQueue inner) => _inner = inner;

        public int Count => _inner.Count;

        public void Enqueue(JournalEntry entry) => _inner.Enqueue(entry);

        public ValueTask<IReadOnlyList<JournalEntry>> TakeBatchAsync(
            int maxCount,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("simulated loop crash");
    }
}
