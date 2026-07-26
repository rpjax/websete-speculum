using Aidan.Core.Patterns;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Events.Services.Contracts;
using Speculum.Api.Profiles.Requests;
using Speculum.Api.Profiles.Responses;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Profiles.Services;

public sealed class ProfileService : IProfileService
{
    private readonly IProfileRepository _profiles;
    private readonly ISessionRepository _sessions;
    private readonly IProfileEventsFactory _events;

    public ProfileService(
        IProfileRepository profiles,
        ISessionRepository sessions,
        IProfileEventsFactory events)
    {
        _profiles = profiles ?? throw new ArgumentNullException(nameof(profiles));
        _sessions = sessions ?? throw new ArgumentNullException(nameof(sessions));
        _events = events ?? throw new ArgumentNullException(nameof(events));
    }

    public async Task<IResult<EnsuredProfile>> EnsureProfileAsync(
        EnsureProfile request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var facts = _events.ForProfileOperation(request.CorrelationId);

        if (request.ProfileId is { } requested
            && requested != Guid.Empty
            && await _profiles.ExistsAsync(requested, ct).ConfigureAwait(false))
        {
            facts.Reused(requested);
            return Result<EnsuredProfile>.Success(new EnsuredProfile
            {
                ProfileId = requested,
                Created = false,
            });
        }

        // Opaque credential held by the client: v4 CSPRNG, never accept caller-supplied ids.
        var profile = Profile.Create(Guid.NewGuid());
        await _profiles.SaveAsync(profile, ct).ConfigureAwait(false);
        facts.Created(profile.Id);

        return Result<EnsuredProfile>.Success(new EnsuredProfile
        {
            ProfileId = profile.Id,
            Created = true,
        });
    }

    public async Task<IResult<ProfileSummary>> GetProfileAsync(
        Guid profileId,
        CancellationToken ct = default)
    {
        if (profileId == Guid.Empty)
            return Result<ProfileSummary>.Failure("Profile id is required");

        var summary = await _profiles.GetSummaryAsync(profileId, ct).ConfigureAwait(false);
        if (summary is null)
            return Result<ProfileSummary>.Failure("Profile not found");

        return Result<ProfileSummary>.Success(summary);
    }

    public async Task<IResult<ProfilePage>> ListProfilesAsync(
        ListProfiles request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var skip = Math.Max(0, request.Skip);
        var take = request.Take <= 0
            ? ListProfiles.DefaultTake
            : Math.Min(request.Take, ListProfiles.MaxTake);

        var (items, total) = await _profiles.ListAsync(skip, take, ct).ConfigureAwait(false);
        return Result<ProfilePage>.Success(new ProfilePage
        {
            Items = items,
            Total = total,
        });
    }

    public async Task<IResult> DeleteProfileAsync(
        DeleteProfile request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.ProfileId == Guid.Empty)
            return Result.Failure("Profile id is required");

        var facts = _events.ForProfileOperation(request.CorrelationId);

        if (await _sessions.AnyLiveByProfileAsync(request.ProfileId, ct).ConfigureAwait(false))
        {
            facts.DeleteRejectedSessionLive(request.ProfileId);
            return Result.Failure("Profile has a live session");
        }

        var deleted = await _profiles.DeleteAsync(request.ProfileId, ct).ConfigureAwait(false);
        if (!deleted)
            return Result.Failure("Profile not found");

        facts.Deleted(request.ProfileId, request.Reason);
        return Result.Success();
    }
}
