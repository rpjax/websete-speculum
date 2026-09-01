namespace Speculum.Api.Configurations.Persistence;

public interface IConfigSectionStore
{
    Task EnsureSchemaAsync(CancellationToken ct = default);

    Task<bool> GetIsFirstBootAsync(CancellationToken ct = default);

    Task SetIsFirstBootAsync(bool value, CancellationToken ct = default);

    Task<string?> GetSectionJsonAsync(string key, CancellationToken ct = default);

    Task UpsertSectionJsonAsync(string key, string? valueJson, CancellationToken ct = default);

    Task<IReadOnlyDictionary<string, string?>> GetAllSectionJsonAsync(CancellationToken ct = default);
}
