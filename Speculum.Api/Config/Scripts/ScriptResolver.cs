using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Scripts;
using Speculum.Api.Config.Store;
using Speculum.Api.Scripts;
using Speculum.Api.Virtualization.Sidecar;

namespace Speculum.Api.Config.Scripts;

public sealed class ScriptResolver
{
    private const long MaxFileSizeBytes = 5 * 1024 * 1024;
    private readonly IHttpClientFactory    _httpClientFactory;
    private readonly IInjectedScriptStore  _scriptStore;
    private readonly ILogger<ScriptResolver> _logger;

    public ScriptResolver(
        IHttpClientFactory httpClientFactory,
        IInjectedScriptStore scriptStore,
        ILogger<ScriptResolver> logger)
    {
        _httpClientFactory = httpClientFactory;
        _scriptStore       = scriptStore;
        _logger            = logger;
    }

    public async Task<IReadOnlyList<ScriptPayload>> ResolveAsync(
        IReadOnlyList<ScriptInjectionEntry> entries,
        CancellationToken ct = default)
    {
        if (entries.Count == 0)
            return [];

        var results = new List<ScriptPayload>(entries.Count);

        foreach (var entry in entries)
        {
            string content;
            string fileKey;

            if (!string.IsNullOrWhiteSpace(entry.ScriptId))
            {
                var id = entry.ScriptId.Trim();
                var entity = await _scriptStore.TryGetAsync(id, ct)
                    ?? throw new InvalidOperationException($"Script id '{id}' not found in database.");

                fileKey = $"/scripts/{id}.js";
                content = entity.Content;
            }
            else if (!string.IsNullOrWhiteSpace(entry.Url))
            {
                fileKey = entry.Url.Trim();
                content = await FetchUrlAsync(fileKey, ct);
            }
            else
            {
                throw new InvalidOperationException("Script injection entry has no scriptId or url.");
            }

            if (content.Length > MaxFileSizeBytes)
                throw new InvalidOperationException($"Script '{fileKey}' exceeds 5 MB limit.");

            results.Add(new ScriptPayload(entry.Position, entry.Type, fileKey, content));
        }

        if (results.Count > 0)
            _logger.LogInformation("Resolved {Count} script(s) for injection.", results.Count);

        return results;
    }

    private async Task<string> FetchUrlAsync(string url, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            throw new InvalidOperationException($"Invalid script URL: '{url}'.");

        if (!SsrfGuard.IsAllowedUrl(uri))
            throw new InvalidOperationException($"Script URL blocked by SSRF guard: '{url}'.");

        var client = _httpClientFactory.CreateClient(nameof(ScriptResolver));
        using var response = await client.GetAsync(uri, ct);

        if ((int)response.StatusCode is >= 300 and < 400)
            throw new InvalidOperationException($"Redirects are not allowed for script URLs: '{url}'.");

        response.EnsureSuccessStatusCode();

        var mediaType = response.Content.Headers.ContentType?.MediaType ?? "";
        if (!string.IsNullOrEmpty(mediaType)
            && !mediaType.Contains("javascript", StringComparison.OrdinalIgnoreCase)
            && !mediaType.Contains("text/plain", StringComparison.OrdinalIgnoreCase)
            && mediaType != "application/octet-stream")
        {
            throw new InvalidOperationException(
                $"Script URL '{url}' returned unexpected Content-Type '{mediaType}'.");
        }

        return await response.Content.ReadAsStringAsync(ct);
    }
}
