using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Contracts;

public interface ILaunchScriptResolver
{
    Task<IResult<IReadOnlyList<ScriptInjection>>> ResolveAsync(
        ScriptingConfiguration configuration,
        CancellationToken ct = default);
}
