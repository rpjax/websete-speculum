using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Websete.Speculum.Host.Config.Persistence;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Scripts;
using Websete.Speculum.Host.Virtualization.Contracts;

namespace Websete.Speculum.Host.Config.Store;

public sealed class SpeculumConfigStore : ISpeculumConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _databasePath;
    private readonly IConfiguration _configuration;
    private readonly ScriptResolver _scriptResolver;
    private readonly IVSessionRegistry _sessionRegistry;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<SpeculumConfigStore> _logger;
    private readonly object _lock = new();

    private SpeculumRuntimeConfig _current = new();
    private bool _isOperational;
    private string[] _missingRequired = [];

    public SpeculumConfigStore(
        string databasePath,
        IConfiguration configuration,
        ScriptResolver scriptResolver,
        IVSessionRegistry sessionRegistry,
        IWebHostEnvironment env,
        ILogger<SpeculumConfigStore> logger)
    {
        _databasePath     = databasePath;
        _configuration    = configuration;
        _scriptResolver   = scriptResolver;
        _sessionRegistry  = sessionRegistry;
        _env              = env;
        _logger           = logger;
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

        foreach (var key in ConfigSectionKeys.All)
        {
            var entity = await db.ConfigSections.FindAsync([key], ct);
            if (entity is not null && entity.ValueJson is not null)
                continue;

            var fallback = ReadFallbackSection(key);
            if (fallback is null)
                continue;

            entity ??= new ConfigSectionEntity { Key = key };
            entity.ValueJson = fallback;
            entity.UpdatedAt = DateTimeOffset.UtcNow;

            if (db.Entry(entity).State == EntityState.Detached)
                db.ConfigSections.Add(entity);
            else
                db.ConfigSections.Update(entity);

            _logger.LogInformation("Seeded configuration section '{Key}' from appsettings.", key);
        }

        await db.SaveChangesAsync(ct);
        await ReloadAsync(db, ct, killSessionsOnForwardingChange: false);
    }

    public async Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default)
    {
        if (!ConfigSectionKeys.All.Contains(key))
            return Error($"Unknown configuration section '{key}'.");

        try
        {
            ConfigValidator.ValidateSection(key, body, _env.WebRootPath);
        }
        catch (ConfigValidationException ex)
        {
            return Error(ex.Errors.Select(e => $"{e.Path}: {e.Message}").ToArray());
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

        await using var db = CreateContext();
        var entity = await db.ConfigSections.FindAsync([key], ct);
        if (entity is not null)
        {
            entity.ValueJson = null;
            entity.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        var killSessions = key == ConfigSectionKeys.Forwarding;
        return await ReloadAsync(db, ct, killSessions);
    }

    private async Task<ConfigUpdateResult> ReloadAsync(
        SpeculumDbContext db,
        CancellationToken ct,
        bool killSessionsOnForwardingChange)
    {
        if (killSessionsOnForwardingChange)
            await _sessionRegistry.StopAllAsync(ct);

        var sections = await db.ConfigSections.AsNoTracking().ToListAsync(ct);
        var map = sections
            .Where(s => s.ValueJson is not null)
            .ToDictionary(s => s.Key, s => s.ValueJson!);

        var forwarding = ParseForwarding(map);
        var maxSessions = ParseMaxSessions(map);
        var environment = ParseEnvironment(map);
        var scriptInjection = ParseScriptInjection(map);
        var jsBridgeEnabled = ParseJsBridge(map);

        IReadOnlyList<Virtualization.Sidecar.ScriptPayload> resolvedScripts = [];
        if (scriptInjection.Count > 0)
        {
            try
            {
                resolvedScripts = await _scriptResolver.ResolveAsync(scriptInjection, ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to resolve ScriptInjection entries.");
                lock (_lock)
                {
                    _current = new SpeculumRuntimeConfig
                    {
                        Forwarding       = forwarding,
                        MaxSessions      = maxSessions,
                        Environment      = environment,
                        ScriptInjection  = scriptInjection,
                        JsBridgeEnabled  = jsBridgeEnabled,
                        ResolvedScripts  = [],
                    };
                    _isOperational    = false;
                    _missingRequired  = ComputeMissing(_current);
                }

                return new ConfigUpdateResult
                {
                    Success         = false,
                    Errors          = [$"ScriptInjection: {ex.Message}"],
                    IsOperational   = false,
                    MissingRequired = _missingRequired,
                };
            }
        }

        var runtime = new SpeculumRuntimeConfig
        {
            Forwarding      = forwarding,
            MaxSessions     = maxSessions,
            Environment     = environment,
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

        if (string.IsNullOrWhiteSpace(config.Environment))
            missing.Add(ConfigSectionKeys.Environment);

        return missing.ToArray();
    }

    private string? ReadFallbackSection(string key)
    {
        var section = _configuration.GetSection(key);
        if (!SectionHasValue(section))
            return null;

        return key switch
        {
            ConfigSectionKeys.MaxSessions => SerializeMaxSessionsFallback(section),
            ConfigSectionKeys.Environment => SerializeEnvironmentFallback(section),
            _ => SerializeSection(section),
        };
    }

    private static bool SectionHasValue(IConfigurationSection section)
    {
        if (!string.IsNullOrEmpty(section.Value))
            return true;

        return section.GetChildren().Any();
    }

    private static string SerializeSection(IConfigurationSection section)
    {
        var obj = BuildObject(section);
        return JsonSerializer.Serialize(obj, JsonOptions);
    }

    private static string SerializeMaxSessionsFallback(IConfigurationSection section)
    {
        if (!int.TryParse(section.Value, out var value))
            throw new InvalidOperationException("MaxSessions fallback must be a number.");

        return JsonSerializer.Serialize(value);
    }

    private static string SerializeEnvironmentFallback(IConfigurationSection section)
    {
        var value = section.Value?.Trim();
        if (string.IsNullOrEmpty(value))
            throw new InvalidOperationException("Environment fallback must be a string.");

        return JsonSerializer.Serialize(value);
    }

    private static object? BuildObject(IConfigurationSection section)
    {
        var children = section.GetChildren().ToList();
        if (children.Count == 0)
            return section.Value;

        if (children.All(c => int.TryParse(c.Key, out _)))
        {
            return children
                .OrderBy(c => int.Parse(c.Key))
                .Select(c => BuildObject(c))
                .ToList();
        }

        var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var child in children)
            dict[child.Key] = BuildObject(child);

        return dict;
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

    private static string? ParseEnvironment(IReadOnlyDictionary<string, string> map)
    {
        if (!map.TryGetValue(ConfigSectionKeys.Environment, out var json))
            return null;

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.ValueKind == JsonValueKind.String
            ? doc.RootElement.GetString()
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
