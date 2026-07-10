using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Virtualization.Sidecar;

namespace Websete.Speculum.Host.Config.Scripts;

public sealed class ScriptResolver
{
    private const long MaxFileSizeBytes = 5 * 1024 * 1024;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<ScriptResolver> _logger;

    public ScriptResolver(
        IHttpClientFactory httpClientFactory,
        IWebHostEnvironment env,
        ILogger<ScriptResolver> logger)
    {
        _httpClientFactory = httpClientFactory;
        _env               = env;
        _logger            = logger;
    }

    public async Task<IReadOnlyList<ScriptPayload>> ResolveAsync(
        IReadOnlyList<ScriptInjectionEntry> entries,
        CancellationToken ct = default)
    {
        if (entries.Count == 0)
            return [];

        var webRoot = _env.WebRootPath
            ?? throw new InvalidOperationException("WebRootPath is not configured.");

        var results = new List<ScriptPayload>(entries.Count);

        foreach (var entry in entries)
        {
            string content;
            string fileKey;

            if (!string.IsNullOrWhiteSpace(entry.File))
            {
                fileKey = entry.File.Trim();
                content = await ReadFileAsync(webRoot, fileKey, ct);
            }
            else if (!string.IsNullOrWhiteSpace(entry.Source))
            {
                fileKey = entry.Source.Trim();
                content = await FetchSourceAsync(fileKey, ct);
            }
            else
            {
                throw new InvalidOperationException("Script injection entry has no file or source.");
            }

            results.Add(new ScriptPayload(entry.Position, entry.Type, fileKey, content));
        }

        if (results.Count > 0)
            _logger.LogInformation("Resolved {Count} script(s) for injection.", results.Count);

        return results;
    }

    private static async Task<string> ReadFileAsync(string webRoot, string file, CancellationToken ct)
    {
        var relative = file.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine(webRoot, relative));

        if (!fullPath.StartsWith(webRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Script file '{file}' resolves outside wwwroot.");

        if (!File.Exists(fullPath))
            throw new FileNotFoundException($"Script file not found: '{file}'", fullPath);

        var info = new FileInfo(fullPath);
        if (info.Length > MaxFileSizeBytes)
            throw new InvalidOperationException($"Script file '{file}' exceeds 5 MB limit.");

        return await File.ReadAllTextAsync(fullPath, ct);
    }

    private async Task<string> FetchSourceAsync(string url, CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient(nameof(ScriptResolver));
        using var response = await client.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync(ct);
        if (content.Length > MaxFileSizeBytes)
            throw new InvalidOperationException($"Script source '{url}' exceeds 5 MB limit.");

        return content;
    }
}
