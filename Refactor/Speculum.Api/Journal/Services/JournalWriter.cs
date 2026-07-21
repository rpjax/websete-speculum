using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Journal.Catalog;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Journal.Storage;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Admits typed facts into the Journal queue: catalog resolve, enablement gate,
/// envelope build (indexes + JSON), admission stamps, enqueue.
/// </summary>
public sealed class JournalWriter : IJournalWriter
{
    private readonly IJournalCatalog _catalog;
    private readonly IJournalQueue _queue;
    private readonly IJournalHealth _health;
    private readonly JournalDrainMetrics _metrics;
    private readonly IOptionsMonitor<JournalDrainOptions> _options;
    private readonly ILogger<JournalWriter> _logger;
    private readonly TimeProvider _timeProvider;

    public JournalWriter(
        IJournalCatalog catalog,
        IJournalQueue queue,
        IJournalHealth health,
        JournalDrainMetrics metrics,
        IOptionsMonitor<JournalDrainOptions> options,
        ILogger<JournalWriter> logger,
        TimeProvider? timeProvider = null)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        _queue = queue ?? throw new ArgumentNullException(nameof(queue));
        _health = health ?? throw new ArgumentNullException(nameof(health));
        _metrics = metrics ?? throw new ArgumentNullException(nameof(metrics));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public void Append<T>(T payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        if (!TryResolveDescriptor<T>(out var descriptor))
            return;

        if (!_catalog.IsTypeEnabled(descriptor.Type))
        {
            _metrics.RecordSkippedDisabled();
            _logger.LogDebug("Journal Append skipped disabled type {FactType}.", descriptor.Type);
            return;
        }

        if (!_health.IsAdmissionOpen)
        {
            RejectClosedAdmission(descriptor);
            return;
        }

        _queue.Enqueue(CreateEntry(descriptor, payload));
    }

    private void RejectClosedAdmission(JournalEntryDescriptor descriptor)
    {
        if (descriptor.PublishPolicy == PublishPolicy.Guaranteed)
        {
            _metrics.RecordGuaranteedAdmissionFailure();
            _health.MarkDegraded("Journal admission closed (drain not running); Guaranteed rejected.");
        }
        else
        {
            _metrics.RecordDroppedOnEnqueue();
        }

        _logger.LogWarning(
            "Journal Append rejected; admission closed for {FactType} ({Policy}).",
            descriptor.Type,
            descriptor.PublishPolicy);
    }

    private bool TryResolveDescriptor<T>([NotNullWhen(true)] out JournalEntryDescriptor? descriptor)
    {
        if (_catalog.TryGet<T>(out descriptor))
            return true;

        if (_catalog.RejectUnregisteredTypes)
        {
            throw new InvalidOperationException(
                $"Journal payload type '{typeof(T).FullName}' is not registered in the catalog.");
        }

        _metrics.RecordSkippedUnregistered();
        _logger.LogDebug(
            "Journal Append skipped unregistered type {ClrType}.",
            typeof(T).FullName);
        descriptor = null;
        return false;
    }

    private JournalEntry CreateEntry<T>(JournalEntryDescriptor descriptor, T payload)
    {
        var publishedAt = _timeProvider.GetUtcNow();
        var json = JsonSerializer.Serialize(payload, descriptor.PayloadJsonTypeInfo);
        var maxBytes = _options.CurrentValue.MaxPayloadBytes;
        var byteCount = Encoding.UTF8.GetByteCount(json);
        if (byteCount > maxBytes)
        {
            throw new InvalidOperationException(
                $"Journal payload for '{descriptor.Type}' is {byteCount} bytes; MaxPayloadBytes is {maxBytes}.");
        }

        if (descriptor.Type.Length > JournalStoreLimits.MaxTypeLength)
        {
            throw new InvalidOperationException(
                $"Journal fact type '{descriptor.Type}' exceeds store type length.");
        }

        var indexKeys = descriptor.ExtractIndexKeys(payload!);
        foreach (var key in indexKeys)
        {
            if (key.Type.Length > JournalStoreLimits.MaxIndexTypeLength
                || key.Value.Length > JournalStoreLimits.MaxIndexValueLength)
            {
                throw new InvalidOperationException(
                    $"Journal index '{key.Type}' for '{descriptor.Type}' exceeds store length limits.");
            }
        }

        return new JournalEntry
        {
            Id = Guid.CreateVersion7(publishedAt),
            PublishedAt = publishedAt,
            Type = descriptor.Type,
            SchemaVersion = descriptor.SchemaVersion,
            PublishPolicy = descriptor.PublishPolicy,
            IndexKeys = indexKeys,
            Payload = json,
        };
    }
}
