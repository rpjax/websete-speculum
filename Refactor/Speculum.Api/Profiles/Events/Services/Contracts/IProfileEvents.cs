using Speculum.Api.Profiles.Aggregates;

namespace Speculum.Api.Profiles.Events.Services.Contracts;

/// <summary>Explicit profile ensure/delete checkpoints (no phase enum).</summary>
public interface IProfileEvents
{
    void Created(Guid profileId);

    void EnsureExisting(Guid profileId);

    void Deleted(Guid profileId, ProfileDeletionReason reason);

    void DeleteRejectedSessionLive(Guid profileId, Guid sessionId);

    void StateReplaced(Guid profileId, int cookieCount);
}
