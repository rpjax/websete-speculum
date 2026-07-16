using System.Reflection;
using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsCatalogTests
{
    [Fact]
    public void All_is_non_empty_and_contains_expected_events()
    {
        Assert.NotEmpty(DiagnosticsEventCatalog.All);
        Assert.Contains("Motor.SessionStarted", DiagnosticsEventCatalog.All);
        Assert.Contains("Motor.SessionResolved", DiagnosticsEventCatalog.All);
        Assert.Contains("Motor.UrlMapped", DiagnosticsEventCatalog.All);
        Assert.Contains("Diagnostics.Degraded", DiagnosticsEventCatalog.All);
        Assert.Contains("Telemetry.SampleCollected", DiagnosticsEventCatalog.All);
    }

    [Fact]
    public void Telemetry_sample_is_a_persisted_telemetry_metric()
    {
        Assert.True(DiagnosticsEventCatalog.TryGet("Telemetry.SampleCollected", out var descriptor));
        Assert.Equal(DiagnosticsDomain.Telemetry, descriptor.Domain);
        Assert.Equal(DiagnosticsCapability.Metric, descriptor.Capability);
        Assert.True(descriptor.Persist);
    }

    [Fact]
    public void Every_span_key_has_at_least_one_open_and_one_close()
    {
        var keyed = DiagnosticsEventCatalog.Descriptors
            .Where(d => d.SpanKey is not null)
            .GroupBy(d => d.SpanKey!);

        foreach (var group in keyed)
        {
            Assert.Contains(group, d => d.SpanRole == SpanRole.Open);
            Assert.Contains(group, d => d.SpanRole == SpanRole.Close);
        }
    }

    [Fact]
    public void Every_open_descriptor_declares_a_span_key()
    {
        Assert.All(
            DiagnosticsEventCatalog.Descriptors.Where(d => d.SpanRole == SpanRole.Open),
            d => Assert.False(string.IsNullOrEmpty(d.SpanKey), $"{d.Name} opens a span without a SpanKey"));
    }

    [Fact]
    public void Declared_span_key_constants_match_the_keys_used_by_descriptors()
    {
        var declared = typeof(DiagnosticsEventCatalog.SpanKeys)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f is { IsLiteral: true, IsInitOnly: false })
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToHashSet(StringComparer.Ordinal);

        var used = DiagnosticsEventCatalog.Descriptors
            .Where(d => d.SpanKey is not null)
            .Select(d => d.SpanKey!)
            .ToHashSet(StringComparer.Ordinal);

        Assert.Equal(declared, used);
    }

    [Fact]
    public void Span_abandoned_is_a_dynamic_close_without_a_static_key()
    {
        Assert.True(DiagnosticsEventCatalog.TryGet("Diagnostics.SpanAbandoned", out var descriptor));
        Assert.Equal(SpanRole.Close, descriptor.SpanRole);
        // The synthetic closer echoes whichever key it abandons at emit time — never a static one.
        Assert.Null(descriptor.SpanKey);
    }
}
