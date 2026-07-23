using Aidan.Core.Patterns;
using Speculum.Api.Profiles.Aggregates;

namespace Speculum.Api.Profiles.Services.Contracts;

public interface IProfileService
{
    Task<IResult> CreateProfileAsync(CancellationToken ct = default);
    Task<IResult> UpdateProfileAsync(Profile profile, CancellationToken ct = default);
    Task<IResult> DeleteProfileAsync(Guid profileId, CancellationToken ct = default);
}