using System.Text.Json;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Scripts;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Edge;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Config.Application;

public sealed class ConfigService : ISpeculumConfigStore
{
    public const string BootstrapKeyEnvVar = "ADMIN_BOOTSTRAP_KEY";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly ConfigSectionRepository _repository;
    private readonly ConfigLoader _loader;
    private readonly IInjectedScriptStore _scriptStore;
    private readonly IBrowserSessionStore _sessionStore;
    private readonly MotorSecretsStore _secretsStore;
    private readonly IReadOnlyList<IConfigChangeHandler> _changeHandlers;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<ConfigService> _logger;
    private readonly object _lock = new();

    private SpeculumRuntimeConfig _current = new();
    private bool _isOperational;
    private string[] _missingRequired = [];

    public ConfigService(
        ConfigSectionRepository repository,
        ConfigLoader loader,
        IInjectedScriptStore scriptStore,
        IBrowserSessionStore sessionStore,
        MotorSecretsStore secretsStore,
        IEnumerable<IConfigChangeHandler> changeHandlers,
        IWebHostEnvironment env,
        ILogger<ConfigService> logger)
    {
        _repository       = repository;
        _loader           = loader;
        _scriptStore      = scriptStore;
        _sessionStore     = sessionStore;
        _secretsStore     = secretsStore;
        _changeHandlers   = changeHandlers.ToArray();
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
        await _repository.EnsureSchemaAsync(ct);
        await EnsureFactoryAdminSeedAsync(ct);
        await EnsureDiagnosticsSeedAsync(ct);
        await _secretsStore.GetOrCreateNavigationStateKeyAsync(ct);
        await ReloadAsync(ct);

        var initContext = new ConfigChangeContext
        {
            SectionKey = ConfigSectionKeys.Hosting,
            Phase      = ConfigChangePhase.PostReload,
            Result     = new ConfigUpdateResult { Success = true },
        };

        foreach (var handler in _changeHandlers)
            await handler.HandleAsync(initContext, ct);
    }

    public async Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default)
    {
        if (!ConfigSectionKeys.All.Contains(key))
            return Error($"Unknown configuration section '{key}'.");

        if (key == ConfigSectionKeys.Hosting)
            body = await ConfigMasking.MergeHostingPutAsync(body, _repository.GetRawValueAsync, ct);

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
            var scriptErrors = await ValidateScriptIdsExistAsync(body, ct);
            if (scriptErrors.Count > 0)
                return Error(scriptErrors.ToArray());
        }

        await _repository.UpsertAsync(key, body.GetRawText(), ct);

        if (key == ConfigSectionKeys.SessionPolicy)
            await _sessionStore.RefreshPolicyAsync(ct);

        var killSessions = key is ConfigSectionKeys.Forwarding or ConfigSectionKeys.Hosting;
        return await ApplyChangeAsync(key, killSessions, ct);
    }

    public async Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default)
    {
        if (!ConfigSectionKeys.All.Contains(key))
            return null;

        var raw = await _repository.GetRawValueAsync(key, ct);
        if (raw is null)
        {
            if (key == ConfigSectionKeys.Hosting)
            {
                using var doc = JsonDocument.Parse("""{"acmeEmail":"","profiles":[]}""");
                return doc.RootElement.Clone();
            }

            return null;
        }

        if (key == ConfigSectionKeys.Hosting)
            return ConfigMasking.MaskHosting(raw);

        using var parsed = JsonDocument.Parse(raw);
        return parsed.RootElement.Clone();
    }

    public async Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default)
    {
        if (!ConfigSectionKeys.All.Contains(key))
            return Error($"Unknown configuration section '{key}'.");

        if (key == ConfigSectionKeys.Admin)
            return Error("Admin section cannot be deleted.");

        if (key == ConfigSectionKeys.Diagnostics)
        {
            await _repository.DeleteRowAsync(key, ct);
            await EnsureDiagnosticsSeedAsync(ct);
            return await ApplyChangeAsync(key, drainSessions: false, ct);
        }

        await _repository.ClearValueAsync(key, ct);

        if (key == ConfigSectionKeys.SessionPolicy)
            await _sessionStore.RefreshPolicyAsync(ct);

        var killSessions = key is ConfigSectionKeys.Forwarding or ConfigSectionKeys.Hosting;
        return await ApplyChangeAsync(key, killSessions, ct);
    }

    private async Task<ConfigUpdateResult> ApplyChangeAsync(string key, bool drainSessions, CancellationToken ct)
    {
        if (drainSessions)
        {
            var preContext = new ConfigChangeContext
            {
                SectionKey = key,
                Phase      = ConfigChangePhase.PreReload,
                Result     = new ConfigUpdateResult { Success = true },
            };

            foreach (var handler in _changeHandlers)
                await handler.HandleAsync(preContext, ct);
        }

        var result = await ReloadAsync(ct);

        var postContext = new ConfigChangeContext
        {
            SectionKey = key,
            Phase      = ConfigChangePhase.PostReload,
            Result     = result,
        };

        foreach (var handler in _changeHandlers)
            await handler.HandleAsync(postContext, ct);

        return result;
    }

    private async Task EnsureFactoryAdminSeedAsync(CancellationToken ct)
    {
        if (await _repository.ExistsAsync(ConfigSectionKeys.Admin, ct))
            return;

        var bootstrapKey = Environment.GetEnvironmentVariable(BootstrapKeyEnvVar);
        if (string.IsNullOrWhiteSpace(bootstrapKey))
            bootstrapKey = Guid.NewGuid().ToString("N");

        var json = JsonSerializer.Serialize(new AdminOptions { ApiKey = bootstrapKey }, JsonOptions);
        var inserted = await _repository.EnsureAdminSeedAsync(ConfigSectionKeys.Admin, json, ct);

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

    private async Task EnsureDiagnosticsSeedAsync(CancellationToken ct)
    {
        if (await _repository.HasConfiguredValueAsync(ConfigSectionKeys.Diagnostics, ct))
            return;

        var profile = Environment.GetEnvironmentVariable("SPECULUM_DIAGNOSTICS_PROFILE");
        DiagnosticsOptions seed;
        if (string.Equals(profile, "Assertive", StringComparison.OrdinalIgnoreCase))
            seed = DiagnosticsSeedProfiles.Assertive();
        else if (_env.IsDevelopment())
            seed = DiagnosticsSeedProfiles.Development();
        else
            seed = DiagnosticsSeedProfiles.Production();

        var json = JsonSerializer.Serialize(seed, JsonOptions);
        await _repository.UpsertAsync(ConfigSectionKeys.Diagnostics, json, ct);
        _logger.LogInformation(
            "Diagnostics section seeded with profile {Profile}.",
            string.IsNullOrWhiteSpace(profile) ? (_env.IsDevelopment() ? "Development" : "Production") : profile);
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

    private async Task<ConfigUpdateResult> ReloadAsync(CancellationToken ct)
    {
        var sections = await _repository.GetAllAsync(ct);
        var map = sections
            .Where(s => s.ValueJson is not null)
            .ToDictionary(s => s.Key, s => s.ValueJson!);

        var (runtime, result) = await _loader.LoadAsync(map, ct);

        lock (_lock)
        {
            _current         = runtime;
            _isOperational   = result.IsOperational;
            _missingRequired = result.MissingRequired.ToArray();
        }

        return result;
    }

    private static ConfigUpdateResult Error(params string[] errors) => new()
    {
        Success = false,
        Errors  = errors,
    };
}
