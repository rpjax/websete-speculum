using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Configurations.Persistence;
using Speculum.Api.Configurations.Services.Contracts;

namespace Speculum.Api.Configurations.Services;

public interface IConfigurationLoadService
{
    /// <summary>
    /// First boot: SQLite ← appsettings ← env (env wins), persist, Apply, then clear IsFirstBoot.
    /// Later boots: SQLite only, then Apply.
    /// </summary>
    Task LoadAndApplyAsync(CancellationToken ct = default);
}

public sealed class ConfigurationLoadService : IConfigurationLoadService
{
    private readonly IConfigSectionStore _store;
    private readonly IConfiguration _configuration;
    private readonly IConfigurationApplyService _apply;
    private readonly ILogger<ConfigurationLoadService> _logger;

    public ConfigurationLoadService(
        IConfigSectionStore store,
        IConfiguration configuration,
        IConfigurationApplyService apply,
        ILogger<ConfigurationLoadService> logger)
    {
        _store = store;
        _configuration = configuration;
        _apply = apply;
        _logger = logger;
    }

    public async Task LoadAndApplyAsync(CancellationToken ct = default)
    {
        await _store.EnsureSchemaAsync(ct).ConfigureAwait(false);
        var isFirstBoot = await _store.GetIsFirstBootAsync(ct).ConfigureAwait(false);

        if (isFirstBoot)
        {
            _logger.LogInformation("Configuration first boot: merging SQLite ← appsettings ← env.");
            await MergeFirstBootAsync(ct).ConfigureAwait(false);
            await _apply.ApplyAllFromStoreAsync(ct).ConfigureAwait(false);
            await _store.SetIsFirstBootAsync(false, ct).ConfigureAwait(false);
        }
        else
        {
            _logger.LogInformation("Configuration load: SQLite only (IsFirstBoot=false).");
            await _apply.ApplyAllFromStoreAsync(ct).ConfigureAwait(false);
        }
    }

    private async Task MergeFirstBootAsync(CancellationToken ct)
    {
        await MergeTypedSectionAsync<HostingConfiguration>(
            ConfigSectionKeys.Hosting,
            HostingConfiguration.SectionName,
            ct).ConfigureAwait(false);

        await MergeTypedSectionAsync<NavigationConfiguration>(
            ConfigSectionKeys.Navigation,
            NavigationConfiguration.SectionName,
            ct).ConfigureAwait(false);

        await MergeTypedSectionAsync<SessionsConfiguration>(
            ConfigSectionKeys.Sessions,
            SessionsConfiguration.SectionName,
            ct).ConfigureAwait(false);

        await MergeTypedSectionAsync<ResourceManagementConfiguration>(
            ConfigSectionKeys.ResourceManagement,
            ResourceManagementConfiguration.SectionName,
            ct).ConfigureAwait(false);

        await MergeJournalEventsAsync(ct).ConfigureAwait(false);

        await MergeTypedSectionAsync<TelemetryConfiguration>(
            ConfigSectionKeys.Telemetry,
            TelemetryConfiguration.SectionName,
            ct).ConfigureAwait(false);
    }

    private async Task MergeTypedSectionAsync<T>(
        string storeKey,
        string configurationSection,
        CancellationToken ct)
        where T : class, new()
    {
        var sqliteJson = await _store.GetSectionJsonAsync(storeKey, ct).ConfigureAwait(false);
        var bound = _configuration.GetSection(configurationSection).Get<T>() ?? new T();
        var fromHost = JsonSerializer.SerializeToNode(bound, ConfigSectionStore.SerializerOptions);
        var merged = ConfigJsonMerge.Merge(ParseObject(sqliteJson), fromHost);
        var json = merged?.ToJsonString(ConfigSectionStore.SerializerOptions);
        await _store.UpsertSectionJsonAsync(storeKey, json, ct).ConfigureAwait(false);
    }

    private async Task MergeJournalEventsAsync(CancellationToken ct)
    {
        var sqliteJson = await _store.GetSectionJsonAsync(ConfigSectionKeys.Journal, ct).ConfigureAwait(false);
        var fromEvents = SectionToJsonNode(_configuration.GetSection(JournalEventsConfiguration.SectionName));
        var fromNested = SectionToJsonNode(_configuration.GetSection("Journal:Events"));

        JsonObject? overlayEvents = null;
        if (fromEvents is JsonObject fe)
        {
            overlayEvents = fe["events"] as JsonObject ?? fe;
        }

        if (fromNested is JsonObject nested)
            overlayEvents = ConfigJsonMerge.Merge(overlayEvents, nested) as JsonObject ?? nested;

        var sqliteNode = ParseObject(sqliteJson);
        JsonObject? sqliteEvents = null;
        if (sqliteNode is JsonObject so)
            sqliteEvents = so["events"] as JsonObject ?? so;

        var mergedEvents = ConfigJsonMerge.Merge(sqliteEvents, overlayEvents) as JsonObject ?? new JsonObject();
        var wrapper = new JsonObject { ["events"] = mergedEvents };
        await _store.UpsertSectionJsonAsync(
            ConfigSectionKeys.Journal,
            wrapper.ToJsonString(ConfigSectionStore.SerializerOptions),
            ct).ConfigureAwait(false);
    }

    private static JsonNode? ParseObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            return JsonNode.Parse(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static JsonNode? SectionToJsonNode(IConfigurationSection section)
    {
        if (!section.GetChildren().Any() && section.Value is null)
            return null;

        var root = new JsonObject();
        FillObject(root, section);
        return root.Count == 0 ? null : root;
    }

    private static void FillObject(JsonObject target, IConfigurationSection section)
    {
        foreach (var child in section.GetChildren())
        {
            var children = child.GetChildren().ToArray();
            if (children.Length == 0)
            {
                if (child.Value is not null)
                    target[child.Key] = JsonValue.Create(InferValue(child.Value));
                continue;
            }

            if (children.All(c => int.TryParse(c.Key, out _)))
            {
                var arr = new JsonArray();
                foreach (var item in children.OrderBy(c => int.Parse(c.Key)))
                {
                    var nestedKids = item.GetChildren().ToArray();
                    if (nestedKids.Length == 0)
                    {
                        arr.Add(item.Value is null ? null : JsonValue.Create(InferValue(item.Value)));
                    }
                    else
                    {
                        var obj = new JsonObject();
                        FillObject(obj, item);
                        arr.Add(obj);
                    }
                }

                target[child.Key] = arr;
            }
            else
            {
                var obj = new JsonObject();
                FillObject(obj, child);
                target[child.Key] = obj;
            }
        }
    }

    private static object InferValue(string raw)
    {
        if (bool.TryParse(raw, out var b))
            return b;
        if (int.TryParse(raw, System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out var i))
            return i;
        if ((raw.Contains('.') || raw.Contains('e', StringComparison.OrdinalIgnoreCase))
            && double.TryParse(raw, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var d))
            return d;
        return raw;
    }
}
