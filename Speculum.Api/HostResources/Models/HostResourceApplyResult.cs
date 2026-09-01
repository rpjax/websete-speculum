namespace Speculum.Api.HostResources.Models;

public sealed record HostResourceApplyResult(
    HostResourceProvisionPlan Plan,
    long ShmBeforeBytes,
    long ShmAppliedBytes,
    bool UlimitsRaised,
    long? NofileApplied,
    long? NprocApplied,
    IReadOnlyList<string> Warnings,
    DateTimeOffset AppliedAtUtc);
