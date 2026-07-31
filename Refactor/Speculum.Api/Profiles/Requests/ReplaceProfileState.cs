using Speculum.Api.Profiles.Aggregates;

namespace Speculum.Api.Profiles.Requests;

/// <summary>Operator/diagnostics command to replace a profile's durable browser state.</summary>
public sealed class ReplaceProfileState
{
    public required Guid ProfileId { get; init; }

    public required ProfileState State { get; init; }

    public string? CorrelationId { get; init; }
}
