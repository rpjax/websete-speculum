using Speculum.Api.Scripts.Responses;
using Speculum.Api.Scripts.Storage;

namespace Speculum.Api.Scripts.Services.Contracts;

public interface IScriptRepository
{
    Task<bool> ExistsAsync(Guid scriptId, CancellationToken ct = default);

    Task<ScriptRecord?> LoadAsync(Guid scriptId, CancellationToken ct = default);

    Task SaveAsync(ScriptRecord script, CancellationToken ct = default);

    Task<(IReadOnlyList<ScriptListItem> Items, int Total)> ListAsync(
        string query,
        int skip,
        int take,
        CancellationToken ct = default);

    Task<bool> DeleteAsync(Guid scriptId, CancellationToken ct = default);
}
