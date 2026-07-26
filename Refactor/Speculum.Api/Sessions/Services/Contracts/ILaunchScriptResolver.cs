using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Contracts;

public interface ILaunchScriptResolver
{
    IResult<IReadOnlyList<ScriptInjection>> Resolve(ScriptingConfiguration configuration);
}
