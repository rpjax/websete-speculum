using Speculum.Api.Profiles.Retention;

namespace Speculum.Api.Sessions.Tests;

public sealed class RetentionDegradationTests
{
    [Theory]
    [InlineData(0, 100, RetentionDegradationLevel.None)]
    [InlineData(69, 100, RetentionDegradationLevel.None)]
    [InlineData(70, 100, RetentionDegradationLevel.SessionTelemetry)]
    [InlineData(85, 100, RetentionDegradationLevel.TelemetrySamples)]
    [InlineData(92, 100, RetentionDegradationLevel.JournalFacts)]
    [InlineData(96, 100, RetentionDegradationLevel.Profiles)]
    public void FromUsage_MapsRatioToLevel(long used, long budget, RetentionDegradationLevel expected)
        => Assert.Equal(expected, RetentionDegradation.FromUsage(used, budget));

    [Fact]
    public void Gate_EnforcerBlocksCleaner()
    {
        var gate = new RetentionWorkGate();
        Assert.True(gate.TryEnterCleaner());
        gate.ExitCleaner();

        gate.EnterEnforcer();
        Assert.False(gate.TryEnterCleaner());
        gate.ExitEnforcer();
        Assert.True(gate.TryEnterCleaner());
        gate.ExitCleaner();
    }
}
