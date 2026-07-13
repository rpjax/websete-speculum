using Speculum.Api.Config.Persistence;

namespace Speculum.Api.Tests;

public sealed class ConfigSectionRepositoryTests : IDisposable
{
    private readonly string _dbPath;
    private readonly ConfigSectionRepository _repository;

    public ConfigSectionRepositoryTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"speculum-repo-{Guid.NewGuid():N}.db");
        _repository = new ConfigSectionRepository(_dbPath);
    }

    [Fact]
    public async Task UpsertAsync_concurrent_same_key_succeeds()
    {
        await _repository.EnsureSchemaAsync();

        var tasks = Enumerable.Range(0, 8).Select(i =>
            _repository.UpsertAsync("Forwarding", $$"""{"host":"h{{i}}","domains":["example.com"]}"""));

        await Task.WhenAll(tasks);

        var raw = await _repository.GetRawValueAsync("Forwarding");
        Assert.NotNull(raw);
        Assert.Contains("host", raw);
    }

    [Fact]
    public async Task UpsertAsync_overwrites_existing_value()
    {
        await _repository.EnsureSchemaAsync();
        await _repository.UpsertAsync("MaxSessions", """{"maxSessions":1}""");
        await _repository.UpsertAsync("MaxSessions", """{"maxSessions":5}""");

        var raw = await _repository.GetRawValueAsync("MaxSessions");
        Assert.Contains("5", raw);
    }

    public void Dispose()
    {
        try
        {
            if (File.Exists(_dbPath))
                File.Delete(_dbPath);
        }
        catch { /* best-effort */ }
    }
}
