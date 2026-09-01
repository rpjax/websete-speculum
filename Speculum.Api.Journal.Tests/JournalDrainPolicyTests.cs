using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services;

namespace Speculum.Api.Journal.Tests;

public sealed class JournalDrainPolicyTests
{
    private readonly JournalDrainPolicy _policy = new();
    private readonly JournalDrainOptions _options = new() { DegradedBestEffortKeep = 0 };

    [Fact]
    public void Healthy_PersistsGuaranteedThenBestEffort()
    {
        var be = JournalTestHarness.Entry(PublishPolicy.BestEffort);
        var g = JournalTestHarness.Entry(PublishPolicy.Guaranteed);

        var decision = _policy.Decide([be, g], JournalHealthState.Healthy, _options);

        Assert.Equal(2, decision.Persist.Count);
        Assert.Equal(PublishPolicy.Guaranteed, decision.Persist[0].PublishPolicy);
        Assert.Equal(PublishPolicy.BestEffort, decision.Persist[1].PublishPolicy);
        Assert.Empty(decision.Drop);
    }

    [Fact]
    public void Degraded_DropsBestEffort_KeepsGuaranteed()
    {
        var be = JournalTestHarness.Entry(PublishPolicy.BestEffort);
        var g = JournalTestHarness.Entry(PublishPolicy.Guaranteed);

        var decision = _policy.Decide([be, g], JournalHealthState.Degraded, _options);

        Assert.Single(decision.Persist);
        Assert.Equal(PublishPolicy.Guaranteed, decision.Persist[0].PublishPolicy);
        Assert.Single(decision.Drop);
        Assert.Equal(PublishPolicy.BestEffort, decision.Drop[0].PublishPolicy);
    }

    [Fact]
    public void Degraded_KeepLastBestEffort_WhenConfigured()
    {
        var options = new JournalDrainOptions { DegradedBestEffortKeep = 1 };
        var older = JournalTestHarness.Entry(PublishPolicy.BestEffort, "BE.Old");
        var newer = JournalTestHarness.Entry(PublishPolicy.BestEffort, "BE.New");
        var g = JournalTestHarness.Entry(PublishPolicy.Guaranteed);

        var decision = _policy.Decide([older, newer, g], JournalHealthState.Degraded, options);

        Assert.Equal(2, decision.Persist.Count);
        Assert.Equal(PublishPolicy.Guaranteed, decision.Persist[0].PublishPolicy);
        Assert.Equal("BE.New", decision.Persist[1].Type);
        Assert.Single(decision.Drop);
        Assert.Equal("BE.Old", decision.Drop[0].Type);
    }
}
