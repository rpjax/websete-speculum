using System.Text.Json;
using Speculum.Api.Config.Application;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Scripts;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Config.Application;

public sealed class ConfigLoader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly ScriptResolver _scriptResolver;
    private readonly ILogger<ConfigLoader> _logger;

    public ConfigLoader(ScriptResolver scriptResolver, ILogger<ConfigLoader> logger)
    {
        _scriptResolver = scriptResolver;
        _logger         = logger;
    }

    public async Task<(SpeculumRuntimeConfig Config, ConfigUpdateResult Result)> LoadAsync(
        IReadOnlyDictionary<string, string> sections,
        CancellationToken ct = default)
    {
        var adminApiKey     = ParseAdminApiKey(sections);
        var forwarding      = ParseForwarding(sections);
        var maxSessions     = ParseMaxSessions(sections);
        var scriptInjection = ParseScriptInjection(sections);
        var jsBridgeEnabled = ParseJsBridge(sections);
        var hosting         = ParseHosting(sections);

        IReadOnlyList<ScriptPayload> resolvedScripts = [];
        var scriptWarnings = new List<string>();
        if (scriptInjection.Count > 0)
        {
            try
            {
                resolvedScripts = await _scriptResolver.ResolveAsync(scriptInjection, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "ScriptInjection resolve failed — motor stays operational without injected scripts.");
                scriptWarnings.Add($"ScriptInjection: {ex.Message}");
            }
        }

        var profileStatuses = HostingEvaluator.EvaluateAll(hosting, forwarding);

        var runtime = new SpeculumRuntimeConfig
        {
            AdminApiKey            = adminApiKey,
            Forwarding             = forwarding,
            MaxSessions            = maxSessions,
            ScriptInjection        = scriptInjection,
            JsBridgeEnabled        = jsBridgeEnabled,
            ResolvedScripts        = resolvedScripts,
            Hosting                = hosting,
            HostingProfileStatuses = profileStatuses,
        };

        var missing = ComputeMissing(runtime);
        var operational = missing.Length == 0;

        return (runtime, new ConfigUpdateResult
        {
            Success         = true,
            IsOperational   = operational,
            MissingRequired = missing,
            Errors          = scriptWarnings.Count > 0 ? scriptWarnings.ToArray() : [],
        });
    }

    private static string[] ComputeMissing(SpeculumRuntimeConfig config)
    {
        var missing = new List<string>();

        if (config.Forwarding is null
            || string.IsNullOrWhiteSpace(config.Forwarding.Host)
            || config.Forwarding.Domains.Length == 0)
            missing.Add(ConfigSectionKeys.Forwarding);

        if (config.MaxSessions is null or <= 0)
            missing.Add(ConfigSectionKeys.MaxSessions);

        return missing.ToArray();
    }

    private static string ParseAdminApiKey(IReadOnlyDictionary<string, string> map)
    {
        if (!map.TryGetValue(ConfigSectionKeys.Admin, out var json))
            return "";

        var options = JsonSerializer.Deserialize<AdminOptions>(json, JsonOptions);
        return options?.ApiKey?.Trim() ?? "";
    }

    private static ForwardingOptions? ParseForwarding(IReadOnlyDictionary<string, string> map)
    {
        if (!map.TryGetValue(ConfigSectionKeys.Forwarding, out var json))
            return null;

        return JsonSerializer.Deserialize<ForwardingOptions>(json, JsonOptions);
    }

    private static int? ParseMaxSessions(IReadOnlyDictionary<string, string> map)
    {
        if (!map.TryGetValue(ConfigSectionKeys.MaxSessions, out var json))
            return null;

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.ValueKind == JsonValueKind.Number
            ? doc.RootElement.GetInt32()
            : null;
    }

    private static IReadOnlyList<ScriptInjectionEntry> ParseScriptInjection(IReadOnlyDictionary<string, string> map)
    {
        if (!map.TryGetValue(ConfigSectionKeys.ScriptInjection, out var json))
            return [];

        return JsonSerializer.Deserialize<ScriptInjectionEntry[]>(json, JsonOptions) ?? [];
    }

    private static HostingOptions ParseHosting(IReadOnlyDictionary<string, string> map)
    {
        if (!map.TryGetValue(ConfigSectionKeys.Hosting, out var json))
            return new HostingOptions();

        return JsonSerializer.Deserialize<HostingOptions>(json, JsonOptions)
               ?? new HostingOptions();
    }

    private static bool ParseJsBridge(IReadOnlyDictionary<string, string> map)
    {
        if (!map.TryGetValue(ConfigSectionKeys.JsBridge, out var json))
            return false;

        var options = JsonSerializer.Deserialize<JsBridgeOptions>(json, JsonOptions);
        return options?.Enable ?? false;
    }
}
