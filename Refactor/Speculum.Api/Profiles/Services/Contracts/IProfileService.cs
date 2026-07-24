using Aidan.Core.Patterns;

namespace Speculum.Api.Profiles.Services.Contracts;

public interface IProfileService
{
    Task<IResult> CreateProfileAsync(CancellationToken ct = default);
}