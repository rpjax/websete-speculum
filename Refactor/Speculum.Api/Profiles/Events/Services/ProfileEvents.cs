using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Events.Services.Contracts;

namespace Speculum.Api.Profiles.Events.Services;

public sealed class ProfileEvents : IProfileEvents
{
    private readonly IJournalWriter _writer;
    private readonly string? _correlationId;

    public ProfileEvents(IJournalWriter writer, string? correlationId)
    {
        _writer = writer ?? throw new ArgumentNullException(nameof(writer));
        _correlationId = string.IsNullOrWhiteSpace(correlationId) ? null : correlationId.Trim();
    }

    public void Created(Guid profileId)
    {
        _writer.Append(new ProfileCreated
        {
            ProfileId = profileId,
            CorrelationId = _correlationId,
        });
    }

    public void Reused(Guid profileId)
    {
        _writer.Append(new ProfileReused
        {
            ProfileId = profileId,
            CorrelationId = _correlationId,
        });
    }

    public void Deleted(Guid profileId, ProfileDeletionReason reason)
    {
        _writer.Append(new ProfileDeleted
        {
            ProfileId = profileId,
            Reason = reason,
            CorrelationId = _correlationId,
        });
    }

    public void DeleteRejectedSessionLive(Guid profileId)
    {
        _writer.Append(new ProfileDeleteRejectedSessionLive
        {
            ProfileId = profileId,
            CorrelationId = _correlationId,
        });
    }
}
