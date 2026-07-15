using System.Text.Json;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Configuration;

namespace Speculum.Api.Tests;

/// <summary>
/// Locks the new toggle + telemetry Diagnostics config shape at the validation boundary:
/// the three seed presets pass, and each bound/typing rule rejects with the right path.
/// </summary>
public sealed class DiagnosticsConfigValidatorTests
{
    private static readonly JsonSerializerOptions CamelCase = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    [Fact]
    public void Development_preset_validates_without_throwing()
        => AssertPresetValid(DiagnosticsSeedProfiles.Development());

    [Fact]
    public void Production_preset_validates_without_throwing()
        => AssertPresetValid(DiagnosticsSeedProfiles.Production());

    [Fact]
    public void Assertive_preset_validates_without_throwing()
        => AssertPresetValid(DiagnosticsSeedProfiles.Assertive());

    private static void AssertPresetValid(DiagnosticsOptions preset)
    {
        var body = JsonSerializer.SerializeToElement(preset, CamelCase);
        var ex = Record.Exception(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.Diagnostics, body));
        Assert.Null(ex);
    }

    [Fact]
    public void Minimal_enabled_body_is_valid()
        => AssertValid("""{ "enabled": true }""");

    [Fact]
    public void Non_boolean_enabled_is_rejected()
        => AssertInvalid("""{ "enabled": "yes" }""", "$.Diagnostics.enabled");

    [Fact]
    public void Unknown_profile_is_rejected()
        => AssertInvalid("""{ "profile": "Verbose" }""", "$.Diagnostics.profile");

    [Theory]
    [InlineData("Development")]
    [InlineData("Production")]
    [InlineData("Assertive")]
    public void Known_profiles_are_accepted(string profile)
        => AssertValid($$"""{ "profile": "{{profile}}" }""");

    [Fact]
    public void Unknown_domain_toggle_is_rejected()
        => AssertInvalid(
            """{ "domains": { "motor": { "verbose": true } } }""",
            "$.Diagnostics.domains.motor.verbose");

    [Fact]
    public void Non_boolean_domain_toggle_is_rejected()
        => AssertInvalid(
            """{ "domains": { "browserQuery": { "probe": "yes" } } }""",
            "$.Diagnostics.domains.browserQuery.probe");

    [Fact]
    public void Domains_must_be_an_object()
        => AssertInvalid("""{ "domains": [] }""", "$.Diagnostics.domains");

    [Theory]
    [InlineData(0)]
    [InlineData(3601)]
    public void Telemetry_interval_out_of_range_is_rejected(int seconds)
        => AssertInvalid(
            $$"""{ "telemetry": { "intervalSeconds": {{seconds}} } }""",
            "$.Diagnostics.telemetry.intervalSeconds");

    [Theory]
    [InlineData(1)]
    [InlineData(3600)]
    public void Telemetry_interval_bounds_are_accepted(int seconds)
        => AssertValid($$"""{ "telemetry": { "intervalSeconds": {{seconds}} } }""");

    [Fact]
    public void Unknown_telemetry_section_toggle_is_rejected()
        => AssertInvalid(
            """{ "telemetry": { "motor": { "includeGhosts": true } } }""",
            "$.Diagnostics.telemetry.motor.includeGhosts");

    [Fact]
    public void Storage_max_bytes_below_floor_is_rejected()
        => AssertInvalid("""{ "storage": { "maxBytes": 1023 } }""", "$.Diagnostics.storage.maxBytes");

    [Fact]
    public void Storage_overflow_other_than_drop_oldest_is_rejected()
        => AssertInvalid("""{ "storage": { "overflow": "DropNewest" } }""", "$.Diagnostics.storage.overflow");

    [Fact]
    public void Sampling_ratio_out_of_unit_range_is_rejected()
        => AssertInvalid("""{ "sampling": { "statusMirrorRatio": 1.5 } }""", "$.Diagnostics.sampling.statusMirrorRatio");

    [Fact]
    public void Elevate_minutes_out_of_range_is_rejected()
        => AssertInvalid("""{ "elevate": { "browserQueryMaxMinutes": 0 } }""", "$.Diagnostics.elevate.browserQueryMaxMinutes");

    [Theory]
    [InlineData("diagTimeoutMs", 50)]
    [InlineData("maxConcurrentProbesPerSession", 0)]
    [InlineData("maxProbeResponseBytes", 512)]
    [InlineData("hostSampleIntervalMs", 60)]
    public void Probe_bounds_are_enforced(string field, int value)
        => AssertInvalid(
            $$"""{ "probe": { "{{field}}": {{value}} } }""",
            $"$.Diagnostics.probe.{field}");

    private static void AssertValid(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var ex = Record.Exception(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.Diagnostics, doc.RootElement));
        Assert.Null(ex);
    }

    private static void AssertInvalid(string json, string expectedPath)
    {
        using var doc = JsonDocument.Parse(json);
        var ex = Assert.Throws<ConfigValidationException>(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.Diagnostics, doc.RootElement));
        Assert.Contains(ex.Errors, e => e.Path == expectedPath);
    }
}
