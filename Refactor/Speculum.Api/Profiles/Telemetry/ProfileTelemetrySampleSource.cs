using Microsoft.Extensions.Options;
using Speculum.Api.Database;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Telemetry.Ports;

namespace Speculum.Api.Profiles.Telemetry;

/// <summary>Adapter: profile store → Telemetry sampling port.</summary>
public sealed class ProfileTelemetrySampleSource(
    IServiceScopeFactory scopes,
    IOptions<DatabaseOptions> database,
    IHostEnvironment environment) : IProfileTelemetrySampleSource
{
    public async Task<(int Total, long? StorageBytes)> CollectAsync(
        bool includeStorageBytes,
        CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<IProfileRepository>();
        var (_, total) = await repository.ListAsync(0, 1, ct).ConfigureAwait(false);
        return (total, includeStorageBytes ? GetDatabaseSize() : null);
    }

    private long? GetDatabaseSize()
    {
        try
        {
            var path = database.Value.Path;
            if (!Path.IsPathRooted(path))
                path = Path.Combine(environment.ContentRootPath, path);
            var file = new FileInfo(path);
            return file.Exists ? file.Length : 0;
        }
        catch
        {
            return null;
        }
    }
}
