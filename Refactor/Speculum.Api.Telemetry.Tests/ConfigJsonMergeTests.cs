namespace Speculum.Api.Telemetry.Tests;

public sealed class ConfigJsonMergeTests
{
    [Fact]
    public void MergeTelemetrySectionJson_PartialEventsPut_PreservesSamplingAndReplacesEvents()
    {
        const string baseline = """
            {
              "isEnabled": true,
              "intervalSeconds": 30,
              "host": { "isEnabled": true, "procPath": "/host/proc" },
              "events": {
                "Telemetry.Sessions.Input.Applied": false,
                "Telemetry.Sessions.Input.WebTransportReceived": true
              }
            }
            """;

        const string overlay = """
            {
              "events": {
                "Telemetry.Sessions.Input.Applied": true,
                "Telemetry.Sessions.Resize.Applied": true
              }
            }
            """;

        var merged = Speculum.Api.Configurations.Persistence.ConfigJsonMerge.MergeTelemetrySectionJson(
            baseline,
            overlay);

        Assert.Contains("\"isEnabled\":true", merged, StringComparison.Ordinal);
        Assert.Contains("/host/proc", merged, StringComparison.Ordinal);
        Assert.Contains("Telemetry.Sessions.Input.Applied", merged, StringComparison.Ordinal);
        Assert.Contains("Telemetry.Sessions.Resize.Applied", merged, StringComparison.Ordinal);
        Assert.DoesNotContain("WebTransportReceived", merged, StringComparison.Ordinal);
    }

    [Fact]
    public void MergeTelemetrySectionJson_WithoutEvents_PreservesStoredEvents()
    {
        const string baseline = """
            {
              "isEnabled": true,
              "events": { "Telemetry.Sessions.Input.Applied": true }
            }
            """;

        const string overlay = """
            {
              "isEnabled": false,
              "intervalSeconds": 20
            }
            """;

        var merged = Speculum.Api.Configurations.Persistence.ConfigJsonMerge.MergeTelemetrySectionJson(
            baseline,
            overlay);

        Assert.Contains("\"isEnabled\":false", merged, StringComparison.Ordinal);
        Assert.Contains("Telemetry.Sessions.Input.Applied", merged, StringComparison.Ordinal);
    }
}
