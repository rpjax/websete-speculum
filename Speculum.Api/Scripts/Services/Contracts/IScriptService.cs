using Aidan.Core.Patterns;
using Speculum.Api.Scripts.Requests;
using Speculum.Api.Scripts.Responses;

namespace Speculum.Api.Scripts.Services.Contracts;

public interface IScriptService
{
    Task<IResult<ScriptListItem>> CreateStoredScriptAsync(
        CreateStoredScript request,
        CancellationToken ct = default);

    Task<IResult<ScriptPage>> ListScriptsAsync(
        ListScripts request,
        CancellationToken ct = default);

    Task<IResult> DeleteScriptAsync(
        DeleteScript request,
        CancellationToken ct = default);
}
