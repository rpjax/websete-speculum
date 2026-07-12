using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Scripts;
using Speculum.Api.Hosting;
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
    private readonly IBrowserSessionStore _sessionStore;
    private readonly IWebHostEnvironment _env;
    private readonly IServiceProvider _services;
    private readonly IConfiguration _configuration;
    private readonly ILogger<SpeculumConfigStore> _logger;
    private readonly object _lock = new();

    private SpeculumRuntimeConfig _current = new();
    private bool _isOperational;
    private string[] _missingRequired = [];
    private bool _subdomainMirroringEnabled;
    private bool _isSubdomainMirroringOperational;
    private string[] _missingSubdomainMirroring = [];

    public SpeculumConfigStore(
        string databasePath,
        BootstrapConfig bootstrap,
        ScriptResolver scriptResolver,
        IInjectedScriptStore scriptStore,
        IVSessionRegistry sessionRegistry,
        IBrowserSessionStore sessionStore,
        IWebHostEnvironment env,
        ILogger<SpeculumConfigStore> logger,
        IServiceProvider services,
        IConfiguration configuration)
    {
        _databasePath   = databasePath;
        _scriptResolver = scriptResolver;
        _scriptStore    = scriptStore;
        _sessionRegistry = sessionRegistry;
        _sessionStore   = sessionStore;
        _env            = env;
        _logger         = logger;
        _services       = services;
        _configuration  = configuration;
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

    public bool SubdomainMirroringEnabled
    {
        get { lock (_lock) return _subdomainMirroringEnabled; }
    }

    public bool IsSubdomainMirroringOperational
    {
        get { lock (_lock) return _isSubdomainMirroringOperational; }
    }

    public IReadOnlyList<string> MissingSubdomainMirroring
    {
        get { lock (_lock) return _missingSubdomainMirroring; }
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await EnsureSchemaAsync(db, ct);
        await EnsureFactoryAdminSeedAsync(db, ct);
        await MigrateLegacyConfigAsync(db, ct);
        await db.SaveChangesAsync(ct);

        var secretsStore = _services.GetService<MotorSecretsStore>();
        if (secretsStore is not null)
            await secretsStore.GetOrCreateNavigationStateKeyAsync(ct);

        await ReloadAsync(db, ct, killSessionsOnForwardingChange: false);
        _services.GetService<EdgeWriter>()?.Apply();
    }

    public async Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default)
    {
        key = ConfigSectionKeys.NormalizeKey(key);

        if (!ConfigSectionKeys.All.Contains(key))
            return Error($"Unknown configuration section '{key}'.");

        if (key == ConfigSectionKeys.Hosting)
            body = await MergeHostingPutAsync(body, ct);

        try
        {
            ConfigValidator.ValidateSection(key, body, Current.Forwarding, Current.Hosting);
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

        if (key == ConfigSectionKeys.SessionPolicy)
            await _sessionStore.RefreshPolicyAsync(ct);

        var killSessions = key is ConfigSectionKeys.Forwarding or ConfigSectionKeys.Hosting;
        var result = await ReloadAsync(db, ct, killSessions);

        if (key == ConfigSectionKeys.Hosting)
            _services.GetService<EdgeWriter>()?.Apply();

        return result;
    }

    public async Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default)
    {
        key = ConfigSectionKeys.NormalizeKey(key);

        if (!ConfigSectionKeys.All.Contains(key))
            return null;

        await using var db = CreateContext();
        var entity = await db.ConfigSections.AsNoTracking().FirstOrDefaultAsync(e => e.Key == key, ct);
        if (entity?.ValueJson is null)
        {
            if (key == ConfigSectionKeys.Hosting)
            {
                using var doc = JsonDocument.Parse("""{"acmeEmail":"","profiles":[]}""");
                return doc.RootElement.Clone();
            }

            if (key == ConfigSectionKeys.SubdomainMirroring)
            {
                using var doc = JsonDocument.Parse("""{"enabled":false}""");
                return doc.RootElement.Clone();
            }

            return null;
        }

        if (key == ConfigSectionKeys.Hosting)
            return MaskHosting(entity.ValueJson);

        if (key == ConfigSectionKeys.SubdomainMirroring)
            return MaskSubdomainMirroring(entity.ValueJson);

        using var parsed = JsonDocument.Parse(entity.ValueJson);
        return parsed.RootElement.Clone();
    }

    public async Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default)
    {
        key = ConfigSectionKeys.NormalizeKey(key);

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

        if (key == ConfigSectionKeys.SessionPolicy)
            await _sessionStore.RefreshPolicyAsync(ct);

        var killSessions = key is ConfigSectionKeys.Forwarding or ConfigSectionKeys.Hosting;
        var result = await ReloadAsync(db, ct, killSessions);

        if (key == ConfigSectionKeys.Hosting)
            _services.GetService<EdgeWriter>()?.Apply();

        return result;
    }

    private async Task MigrateLegacyConfigAsync(SpeculumDbContext db, CancellationToken ct)
    {
        var existing = await db.ConfigSections.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Key == ConfigSectionKeys.Hosting, ct);

        // Hosting section exists (even with empty profiles) — never re-run legacy migration.
        if (existing is not null)
            return;

        var legacyDomain = _configuration["Motor:PublicDomain"]?.Trim()
                           ?? Environment.GetEnvironmentVariable("Motor__PublicDomain")?.Trim();

        SubdomainMirroringOptions? legacyMirroring = null;
        var mirroringEntity = await db.ConfigSections.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Key == ConfigSectionKeys.SubdomainMirroring, ct);
        if (mirroringEntity?.ValueJson is not null)
        {
            legacyMirroring = JsonSerializer.Deserialize<SubdomainMirroringOptions>(
                mirroringEntity.ValueJson, JsonOptions);
        }

        if (string.IsNullOrWhiteSpace(legacyDomain) && legacyMirroring?.Enabled != true)
            return;

        var profiles = new List<HostingProfileOptions>();

        if (!string.IsNullOrWhiteSpace(legacyDomain))
        {
            profiles.Add(new HostingProfileOptions
            {
                Domain = legacyDomain,
                SubdomainMirroringEnabled = legacyMirroring?.Enabled == true,
                EdgeTls = legacyMirroring?.Enabled == true ? legacyMirroring.EdgeTls : null,
            });
        }

        if (profiles.Count == 0)
            return;

        var acmeEmail = legacyMirroring?.EdgeTls?.Email?.Trim() ?? "";
        var hostingJson = JsonSerializer.Serialize(new HostingOptions
        {
            AcmeEmail = acmeEmail,
            Profiles  = profiles,
        }, JsonOptions);

        var updatedAt = DateTimeOffset.UtcNow.ToString("O");
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO config_sections (key, value_json, updated_at)
            VALUES ({0}, {1}, {2})
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
            """,
            [ConfigSectionKeys.Hosting, hostingJson, updatedAt],
            ct);

        _logger.LogInformation(
            "Migrated legacy Motor:PublicDomain / SubdomainMirroring into Hosting profiles.");
    }

    private async Task<JsonElement> MergeHostingPutAsync(JsonElement body, CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("profiles", out var profiles)
            || profiles.ValueKind != JsonValueKind.Array)
        {
            return body;
        }

        var existing = await GetSectionRawAsync(ConfigSectionKeys.Hosting, ct);
        Dictionary<string, string>? tokenByDomain = null;
        if (existing is not null)
        {
            try
            {
                var prev = JsonSerializer.Deserialize<HostingOptions>(existing, JsonOptions);
                tokenByDomain = prev?.Profiles
                    .Where(p => p.EdgeTls?.ApiToken is not null)
                    .ToDictionary(p => p.Domain, p => p.EdgeTls!.ApiToken!, StringComparer.OrdinalIgnoreCase);
            }
            catch { /* ignore */ }
        }

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var prop in body.EnumerateObject())
            {
                if (!prop.NameEquals("profiles"))
                {
                    prop.WriteTo(writer);
                    continue;
                }

                writer.WritePropertyName("profiles");
                writer.WriteStartArray();
                foreach (var profile in profiles.EnumerateArray())
                {
                    if (profile.ValueKind != JsonValueKind.Object)
                    {
                        profile.WriteTo(writer);
                        continue;
                    }

                    var domain = profile.TryGetProperty("domain", out var dEl) && dEl.ValueKind == JsonValueKind.String
                        ? dEl.GetString()?.Trim() ?? ""
                        : "";

                    var needsTokenMerge = profile.TryGetProperty("edgeTls", out var edgeTls)
                                          && edgeTls.ValueKind == JsonValueKind.Object
                                          && edgeTls.TryGetProperty("apiToken", out var tokenEl)
                                          && tokenEl.ValueKind == JsonValueKind.String
                                          && tokenEl.GetString() == "***";

                    string? existingToken = null;
                    if (needsTokenMerge && tokenByDomain is not null && !string.IsNullOrEmpty(domain)
                        && tokenByDomain.TryGetValue(domain, out var byDomain))
                    {
                        existingToken = byDomain;
                    }

                    if (!needsTokenMerge || existingToken is null)
                    {
                        profile.WriteTo(writer);
                        continue;
                    }

                    writer.WriteStartObject();
                    foreach (var p in profile.EnumerateObject())
                    {
                        if (!p.NameEquals("edgeTls"))
                        {
                            p.WriteTo(writer);
                            continue;
                        }

                        writer.WritePropertyName("edgeTls");
                        writer.WriteStartObject();
                        foreach (var ep in edgeTls.EnumerateObject())
                        {
                            if (ep.NameEquals("apiToken"))
                            {
                                writer.WriteString("apiToken", existingToken);
                                continue;
                            }

                            ep.WriteTo(writer);
                        }
                        writer.WriteEndObject();
                    }
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }

        using var merged = JsonDocument.Parse(stream.ToArray());
        return merged.RootElement.Clone();
    }

    private async Task<string?> GetSectionRawAsync(string key, CancellationToken ct)
    {
        await using var db = CreateContext();
        var entity = await db.ConfigSections.AsNoTracking().FirstOrDefaultAsync(e => e.Key == key, ct);
        return entity?.ValueJson;
    }

    private static JsonElement MaskHosting(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (!root.TryGetProperty("profiles", out var profiles) || profiles.ValueKind != JsonValueKind.Array)
            return root.Clone();

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var prop in root.EnumerateObject())
            {
                if (!prop.NameEquals("profiles"))
                {
                    prop.WriteTo(writer);
                    continue;
                }

                writer.WritePropertyName("profiles");
                writer.WriteStartArray();
                foreach (var profile in profiles.EnumerateArray())
                {
                    if (profile.ValueKind != JsonValueKind.Object
                        || !profile.TryGetProperty("edgeTls", out var edgeTls)
                        || edgeTls.ValueKind != JsonValueKind.Object)
                    {
                        profile.WriteTo(writer);
                        continue;
                    }

                    writer.WriteStartObject();
                    foreach (var p in profile.EnumerateObject())
                    {
                        if (!p.NameEquals("edgeTls"))
                        {
                            p.WriteTo(writer);
                            continue;
                        }

                        writer.WritePropertyName("edgeTls");
                        writer.WriteStartObject();
                        foreach (var ep in edgeTls.EnumerateObject())
                        {
                            if (ep.NameEquals("apiToken") && ep.Value.ValueKind == JsonValueKind.String)
                            {
                                writer.WriteString("apiToken", "***");
                                continue;
                            }

                            ep.WriteTo(writer);
                        }
                        writer.WriteEndObject();
                    }
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }

        using var masked = JsonDocument.Parse(stream.ToArray());
        return masked.RootElement.Clone();
    }

    private static JsonElement MaskSubdomainMirroring(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (!root.TryGetProperty("edgeTls", out var edgeTls)
            || edgeTls.ValueKind != JsonValueKind.Object)
        {
            return root.Clone();
        }

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var prop in root.EnumerateObject())
            {
                if (prop.NameEquals("edgeTls"))
                {
                    writer.WritePropertyName("edgeTls");
                    writer.WriteStartObject();
                    foreach (var edgeProp in edgeTls.EnumerateObject())
                    {
                        if (edgeProp.NameEquals("apiToken") && edgeProp.Value.ValueKind == JsonValueKind.String)
                        {
                            writer.WriteString("apiToken", "***");
                            continue;
                        }

                        edgeProp.WriteTo(writer);
                    }
                    writer.WriteEndObject();
                    continue;
                }

                prop.WriteTo(writer);
            }
            writer.WriteEndObject();
        }

        using var masked = JsonDocument.Parse(stream.ToArray());
        return masked.RootElement.Clone();
    }

    private async Task EnsureFactoryAdminSeedAsync(SpeculumDbContext db, CancellationToken ct)
    {
        if (await db.ConfigSections.AsNoTracking()
                .AnyAsync(e => e.Key == ConfigSectionKeys.Admin, ct))
            return;

        var bootstrapKey = Environment.GetEnvironmentVariable(BootstrapKeyEnvVar);
        if (string.IsNullOrWhiteSpace(bootstrapKey))
            bootstrapKey = Guid.NewGuid().ToString("N");

        var json = JsonSerializer.Serialize(new AdminOptions { ApiKey = bootstrapKey }, JsonOptions);
        var updatedAt = DateTimeOffset.UtcNow.ToString("O");

        var inserted = await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO config_sections (key, value_json, updated_at)
            VALUES ({0}, {1}, {2})
            """,
            [ConfigSectionKeys.Admin, json, updatedAt],
            ct);

        if (inserted == 0)
            return;

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
            await _sessionRegistry.StopAllAsync(_sessionStore, CancellationToken.None);

        var sections = await db.ConfigSections.AsNoTracking().ToListAsync(ct);
        var map = sections
            .Where(s => s.ValueJson is not null)
            .ToDictionary(s => s.Key, s => s.ValueJson!);

        var adminApiKey     = ParseAdminApiKey(map);
        var forwarding      = ParseForwarding(map);
        var maxSessions     = ParseMaxSessions(map);
        var scriptInjection = ParseScriptInjection(map);
        var jsBridgeEnabled = ParseJsBridge(map);
        var hosting         = ParseHosting(map);

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

        var profileStatuses = HostingEvaluator.EvaluateAll(hosting, forwarding);
        var anyMirroringEnabled = hosting.Profiles.Any(p => p.SubdomainMirroringEnabled);
        var anyMirroringOperational = profileStatuses.Any(p => p.SubdomainMirroringEnabled && p.MirroringOperational);
        var mirroringMissing = profileStatuses
            .Where(p => p.SubdomainMirroringEnabled && !p.MirroringOperational)
            .SelectMany(p => p.Missing.Select(m => $"{p.Domain}:{m}"))
            .ToArray();

        var runtime = new SpeculumRuntimeConfig
        {
            AdminApiKey                     = adminApiKey,
            Forwarding                      = forwarding,
            MaxSessions                     = maxSessions,
            ScriptInjection                 = scriptInjection,
            JsBridgeEnabled                 = jsBridgeEnabled,
            ResolvedScripts                 = resolvedScripts,
            Hosting                         = hosting,
            HostingProfileStatuses          = profileStatuses,
            SubdomainMirroringEnabled       = anyMirroringEnabled,
            IsSubdomainMirroringOperational = anyMirroringOperational,
            MissingSubdomainMirroring       = mirroringMissing,
        };

        var missing = ComputeMissing(runtime);
        var operational = missing.Length == 0;

        lock (_lock)
        {
            _current                         = runtime;
            _isOperational                   = operational;
            _missingRequired                 = missing;
            _subdomainMirroringEnabled       = anyMirroringEnabled;
            _isSubdomainMirroringOperational = anyMirroringOperational;
            _missingSubdomainMirroring       = mirroringMissing;
        }

        return new ConfigUpdateResult
        {
            Success                         = true,
            IsOperational                   = operational,
            MissingRequired                 = missing,
            IsSubdomainMirroringOperational = anyMirroringOperational,
            MissingSubdomainMirroring       = mirroringMissing,
            Errors                          = scriptWarnings.Count > 0 ? scriptWarnings.ToArray() : [],
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
