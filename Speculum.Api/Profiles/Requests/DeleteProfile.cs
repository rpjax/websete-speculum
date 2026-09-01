using Speculum.Api.Profiles.Aggregates;

namespace Speculum.Api.Profiles.Requests;

/// <summary>Operator command to remove a persisted profile identity and its state bucket.</summary>
public sealed class DeleteProfile
{
    public Guid ProfileId { get; set; }

    public ProfileDeletionReason Reason { get; set; } = ProfileDeletionReason.UserRequested;

    public string? CorrelationId { get; set; }
}
