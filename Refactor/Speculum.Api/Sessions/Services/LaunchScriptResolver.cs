using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class LaunchScriptResolver : ILaunchScriptResolver
{
    public IResult<IReadOnlyList<ScriptInjection>> Resolve(
        ScriptingConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        if (configuration.Injections.Count > 0)
        {
            return Result<IReadOnlyList<ScriptInjection>>.Failure(
                "Configured script injections cannot be resolved by the current engine");
        }

        return Result<IReadOnlyList<ScriptInjection>>.Success(
            Array.Empty<ScriptInjection>());
    }
}
