using Speculum.Api.Scripts.Requests;
using Speculum.Api.Scripts.Services;
using Speculum.Api.Scripts.Services.Contracts;
using Speculum.Api.Scripts.Storage;

namespace Speculum.Api.Sessions.Tests;

public sealed class ScriptServiceTests
{
    [Fact]
    public async Task CreateStoredScript_ComputesMetadata_AndListsWithQuery()
    {
        var repository = new InMemoryScriptRepository();
        var service = new ScriptService(repository);

        var created = await service.CreateStoredScriptAsync(new CreateStoredScript
        {
            Name = "alpha.js",
            Content = "console.log('alpha');",
        });

        Assert.True(created.IsSuccess);
        Assert.Equal("alpha.js", created.Value.Name);
        Assert.Equal(64, created.Value.Sha256.Length);
        Assert.True(created.Value.Size > 0);

        await service.CreateStoredScriptAsync(new CreateStoredScript
        {
            Name = "beta.js",
            Content = "console.log('beta');",
        });

        var filtered = await service.ListScriptsAsync(new ListScripts
        {
            Query = "alpha",
            Skip = 0,
            Take = 10,
        });

        Assert.True(filtered.IsSuccess);
        Assert.Single(filtered.Value.Items);
        Assert.Equal("alpha.js", filtered.Value.Items[0].Name);
        Assert.Equal(1, filtered.Value.Total);
    }

    [Fact]
    public async Task DeleteScript_RemovesExistingScript()
    {
        var repository = new InMemoryScriptRepository();
        var service = new ScriptService(repository);
        var created = await service.CreateStoredScriptAsync(new CreateStoredScript
        {
            Name = "delete-me.js",
            Content = "console.log('bye');",
        });

        var deleted = await service.DeleteScriptAsync(new DeleteScript
        {
            ScriptId = created.Value.Id,
        });

        Assert.True(deleted.IsSuccess);
        Assert.Empty((await service.ListScriptsAsync(new ListScripts())).Value.Items);
    }

    private sealed class InMemoryScriptRepository : IScriptRepository
    {
        private readonly List<ScriptRecord> _records = [];

        public Task<bool> ExistsAsync(Guid scriptId, CancellationToken ct = default)
            => Task.FromResult(_records.Any(x => x.Id == scriptId));

        public Task<ScriptRecord?> LoadAsync(Guid scriptId, CancellationToken ct = default)
            => Task.FromResult(_records.FirstOrDefault(x => x.Id == scriptId));

        public Task SaveAsync(ScriptRecord script, CancellationToken ct = default)
        {
            var existing = _records.FindIndex(x => x.Id == script.Id);
            if (existing >= 0)
            {
                _records[existing] = script;
            }
            else
            {
                _records.Add(script);
            }

            return Task.CompletedTask;
        }

        public Task<(IReadOnlyList<Speculum.Api.Scripts.Responses.ScriptListItem> Items, int Total)> ListAsync(
            string query,
            int skip,
            int take,
            CancellationToken ct = default)
        {
            var rows = _records.AsEnumerable();
            if (!string.IsNullOrWhiteSpace(query))
            {
                rows = rows.Where(x => x.Name.Contains(query, StringComparison.OrdinalIgnoreCase));
            }

            var list = rows
                .OrderByDescending(x => x.CreatedAtUtc)
                .Skip(skip)
                .Take(take)
                .Select(x => new Speculum.Api.Scripts.Responses.ScriptListItem
                {
                    Id = x.Id,
                    Name = x.Name,
                    Sha256 = x.Sha256,
                    Size = x.SizeBytes,
                    UploadedAt = x.CreatedAtUtc,
                    UpdatedAt = x.UpdatedAtUtc,
                })
                .ToArray();

            return Task.FromResult<(
                IReadOnlyList<Speculum.Api.Scripts.Responses.ScriptListItem> Items,
                int Total)>((list, rows.Count()));
        }

        public Task<bool> DeleteAsync(Guid scriptId, CancellationToken ct = default)
        {
            var removed = _records.RemoveAll(x => x.Id == scriptId);
            return Task.FromResult(removed > 0);
        }
    }
}
