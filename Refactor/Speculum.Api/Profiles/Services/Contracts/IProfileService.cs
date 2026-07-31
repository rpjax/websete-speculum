using Aidan.Core.Patterns;
using Speculum.Api.Profiles.Requests;
using Speculum.Api.Profiles.Responses;

namespace Speculum.Api.Profiles.Services.Contracts;

public interface IProfileService
{
    /// <summary>
    /// Resolves <see cref="EnsureProfile.ProfileId"/> when it exists, otherwise creates a
    /// fresh profile. Unknown ids never reuse the caller's value — a server-generated id is
    /// returned so clients cannot claim arbitrary profile state.
    /// </summary>
    Task<IResult<EnsuredProfile>> EnsureProfileAsync(
        EnsureProfile request,
        CancellationToken ct = default);

    Task<IResult<ProfileSummary>> GetProfileAsync(
        Guid profileId,
        CancellationToken ct = default);

    Task<IResult<ProfilePage>> ListProfilesAsync(
        ListProfiles request,
        CancellationToken ct = default);

    Task<IResult> DeleteProfileAsync(
        DeleteProfile request,
        CancellationToken ct = default);

    /// <summary>
    /// Replaces the durable browser-state bucket for an existing profile (diagnostics E8b path).
    /// </summary>
    Task<IResult> ReplaceProfileStateAsync(
        ReplaceProfileState request,
        CancellationToken ct = default);
}
