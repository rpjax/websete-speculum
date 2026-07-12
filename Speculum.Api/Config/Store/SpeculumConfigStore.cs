using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Scripts;
using Speculum.Api.Scripts;
using Speculum.Api.Virtualization.Contracts;
using Speculum.Api.Virtualization.Persistence;

namespace Speculum.Api.Config.Store;

public sealed class SpeculumConfigStore : ISpeculumConfigStore
{
    public const string BootstrapKeyEnvVar = "ADMIN_BOOTSTRAP_KEY";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _databasePath;
    private readonly ScriptResolver _scriptResolver;
    private readonly IInjectedScriptStore _scriptStore;
    private readonly IVSessionRegistry _sessionRegistry;
    private readonly IProfileSnapshotMerger _snapshotMerger;
    private readonly IBrowserSnapshotStore _snapshotStore;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<SpeculumConfigStore> _logger;
    private readonly object _lock = new();

    private SpeculumRuntimeConfig _current = new();
    private bool _isOperational;
    private string[] _missingRequired = [];

    public SpeculumConfigStore(
        string databasePath,
        ScriptResolver scriptResolver,
        IInjectedScriptStore scriptStore,
        IVSessionRegistry sessionRegistry,
        IProfileSnapshotMerger snapshotMerger,
        IBrowserSnapshotStore snapshotStore,
        IWebHostEnvironment env,
        ILogger<SpeculumConfigStore> logger)
    {
        _databasePath    = databasePath;
        _scriptResolver  = scriptResolver;
        _scriptStore     = scriptStore;
        _sessionRegistry = sessionRegistry;
        _snapshotMerger  = snapshotMerger;
        _snapshotStore   = snapshotStore;
        _env             = env;
        _logger          = logger;
    }

    public SpeculumRuntimeConfig Current
    {
        get { lock (_lock) return _current; }
    }

    public bool IsOperational
    {
        get { lock (_lock) return _isOperational; }
    }

    public IReadOnlyList<string> MissingRequired
    {
        get { lock (_lock) return _missingRequired; }
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await EnsureSchemaAsync(db, ct);
        await EnsureFactoryAdminSeedAsync(db, ct);
        await db.SaveChangesAsync(ct);
        await ReloadAsync(db, ct, killSessionsOnForwardingChange: false);
    }

    public async Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default)
    {
        if (!ConfigSectionKeys.All.Contains(key))
            return Error($"Unknown configuration section '{key}'.");

        try
        {
            ConfigValidator.ValidateSection(key, body);
        }
        catch (ConfigValidationException ex)
        {
            return Error(ex.Errors.Select(e => $"{e.Path}: {e.Message}").ToArray());
        }

        if (key == ConfigSectionKeys.ScriptInjection)
        {
            var scriptErrors = await ValidateScriptIdsExistAsync(body);
            if (scriptErrors.Count > 0)
                return Error(scriptErrors.ToArray());
        }

        var json = body.GetRawText();
        await using var db = CreateContext();

        var entity = await db.ConfigSections.FindAsync([key], ct);
        entity ??= new ConfigSectionEntity { Key = key };
        entity.ValueJson = json;
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        if (db.Entry(entity).State == EntityState.Detached)
            db.ConfigSections.Add(entity);
        else
            db.ConfigSections.Update(entity);

        await db.SaveChangesAsync(ct);

        if (key == ConfigSectionKeys.SnapshotPolicy)
            await _snapshotStore.RefreshPolicyAsync(ct);

        var killSessions = key == ConfigSectionKeys.Forwarding;
        return await ReloadAsync(db, ct, killSessions);
    }

    public async Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default)
    {
        if (!ConfigSectionKeys.All.Contains(key))
            return null;

        await using var db = CreateContext();
        var entity = await db.ConfigSections.AsNoTracking().FirstOrDefaultAsync(e => e.Key == key, ct);
        if (entity?.ValueJson is null)
            return null;

        using var doc = JsonDocument.Parse(entity.ValueJson);
        return doc.RootElement.Clone();
    }

    public async Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default)
    {
        if (!ConfigSectionKeys.All.Contains(key))
            return Error($"Unknown configuration section '{key}'.");

        if (key == ConfigSectionKeys.Admin)
            return Error("Admin section cannot be deleted.");

        await using var db = CreateContext();
        var entity = await db.ConfigSections.FindAsync([key], ct);
        if (entity is not null)
        {
            entity.ValueJson = null;
            entity.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        if (key == ConfigSectionKeys.SnapshotPolicy)
            await _snapshotStore.RefreshPolicyAsync(ct);

        var killSessions = key == ConfigSectionKeys.Forwarding;
        return await ReloadAsync(db, ct, killSessions);
    }

    private async Task EnsureFactoryAdminSeedAsync(SpeculumDbContext db, CancellationToken ct)
    {
        var entity = await db.ConfigSections.FindAsync([ConfigSectionKeys.Admin], ct);
        if (entity is not null && entity.ValueJson is not null)
            return;

        entity ??= new ConfigSectionEntity { Key = ConfigSectionKeys.Admin };
        var bootstrapKey = Environment.GetEnvironmentVariable(BootstrapKeyEnvVar);
        if (string.IsNullOrWhiteSpace(bootstrapKey))
            bootstrapKey = Guid.NewGuid().ToString("N");

        entity.ValueJson = JsonSerializer.Serialize(new AdminOptions { ApiKey = bootstrapKey }, JsonOptions);
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        if (db.Entry(entity).State == EntityState.Detached)
            db.ConfigSections.Add(entity);
        else
            db.ConfigSections.Update(entity);

        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(BootstrapKeyEnvVar)))
        {
            if (_env.IsDevelopment())
            {
                _logger.LogWarning(
                    "Bootstrap admin API key (set {EnvVar} to override): {ApiKey}",
                    BootstrapKeyEnvVar, bootstrapKey);
            }
            else
            {
                _logger.LogWarning(
                    "Bootstrap admin API key seeded. Prefix: {Prefix}… Set {EnvVar} before first boot in production.",
                    bootstrapKey[..Math.Min(8, bootstrapKey.Length)], BootstrapKeyEnvVar);
            }
        }
    }

    private async Task<List<string>> ValidateScriptIdsExistAsync(JsonElement body, CancellationToken ct = default)
    {
        var errors = new List<string>();
        if (body.ValueKind != JsonValueKind.Array) return errors;

        var i = 0;
        foreach (var entry in body.EnumerateArray())
        {
            if (entry.TryGetProperty("scriptId", out var idEl) && idEl.ValueKind == JsonValueKind.String)
            {
                var id = idEl.GetString()?.Trim();
                if (!string.IsNullOrEmpty(id) && !await _scriptStore.ExistsAsync(id, ct))
                    errors.Add($"$.ScriptInjection[{i}].scriptId: Script '{id}' not found.");
            }

            i++;
        }

        return errors;
    }

    private async Task<ConfigUpdateResult> ReloadAsync(
        SpeculumDbContext db,
        CancellationToken ct,
        bool killSessionsOnForwardingChange)
    {
        if (killSessionsOnForwardingChange)
            await _sessionRegistry.StopAllAsync(_snapshotMerger, CancellationToken.None);

        var sections = await db.ConfigSections.AsNoTracking().ToListAsync(ct);
        var map = sections
            .Where(s => s.ValueJson is not null)
            .ToDictionary(s => s.Key, s => s.ValueJson!);

        var adminApiKey     = ParseAdminApiKey(map);
        var forwarding      = ParseForwarding(map);
        var maxSessions     = ParseMaxSessions(map);
        var scriptInjection = ParseScriptInjection(map);
        var jsBridgeEnabled = ParseJsBridge(map);

        IReadOnlyList<Virtualization.Sidecar.ScriptPayload> resolvedScripts = [];
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

        var runtime = new SpeculumRuntimeConfig
        {
            AdminApiKey     = adminApiKey,
            Forwarding      = forwarding,
            MaxSessions     = maxSessions,
            ScriptInjection = scriptInjection,
            JsBridgeEnabled = jsBridgeEnabled,
            ResolvedScripts = resolvedScripts,
        };

        var missing = ComputeMissing(runtime);
        var operational = missing.Length == 0;

        lock (_lock)
        {
            _current         = runtime;
            _isOperational   = operational;
            _missingRequired = missing;
        }

        return new ConfigUpdateResult
        {
            Success         = true,
            IsOperational   = operational,
            MissingRequired = missing,
            Errors          = scriptWarnings.Count > 0 ? scriptWarnings.ToArray() : [],
        };
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

    private static bool ParseJsBridge(IReadOnlyDictionary<string, string> map)
    {
        if (!map.TryGetValue(ConfigSectionKeys.JsBridge, out var json))
            return false;

        var options = JsonSerializer.Deserialize<JsBridgeOptions>(json, JsonOptions);
        return options?.Enable ?? false;
    }

    private SpeculumDbContext CreateContext() => new(_databasePath);

    private static async Task EnsureSchemaAsync(SpeculumDbContext db, CancellationToken ct)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS config_sections (
                key TEXT NOT NULL PRIMARY KEY,
                value_json TEXT NULL,
                updated_at TEXT NOT NULL
            );
            """, ct);
    }

    private static ConfigUpdateResult Error(params string[] errors) => new()
    {
        Success = false,
        Errors  = errors,
    };
}
