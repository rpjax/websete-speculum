using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Tests;

internal static class JournalTestHarness
{
    public static (JournalQueue Queue, JournalDrainMetrics Metrics, IJournalHealth Health) CreateQueue(
        Action<JournalDrainOptions>? configure = null)
    {
        var options = new JournalDrainOptions();
        configure?.Invoke(options);
        var monitor = new StaticOptionsMonitor<JournalDrainOptions>(options);
        var metrics = new JournalDrainMetrics();
        var health = new JournalHealth(
            monitor,
            metrics,
            NullLogger<JournalHealth>.Instance);
        var queue = new JournalQueue(
            monitor,
            metrics,
            health,
            NullLogger<JournalQueue>.Instance);
        return (queue, metrics, health);
    }

    public static JournalEntry Entry(
        PublishPolicy policy = PublishPolicy.BestEffort,
        string type = "Test.Fact")
    {
        var now = DateTimeOffset.UtcNow;
        return new JournalEntry
        {
            Id = Guid.CreateVersion7(now),
            Type = type,
            SchemaVersion = 1,
            PublishPolicy = policy,
            PublishedAt = now,
            IndexKeys = Array.Empty<JournalIndexKey>(),
            Payload = "{}",
        };
    }
}

internal sealed class StaticOptionsMonitor<T> : IOptionsMonitor<T>
{
    private readonly T _value;

    public StaticOptionsMonitor(T value) => _value = value;

    public T CurrentValue => _value;

    public T Get(string? name) => _value;

    public IDisposable? OnChange(Action<T, string?> listener) => null;
}
