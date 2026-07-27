using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Persistence;
using Speculum.Api.Configurations.Services;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Presentation.Configurations;

public static class ConfigurationEndpoints
{
    public static IEndpointRouteBuilder MapConfigurationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/configurations/status", (IConfigurationService configuration) =>
        {
            return Results.Ok(new
            {
                operational = configuration.AreMandatorySettingsSatisfied,
                missing = configuration.MissingRequired,
            });
        }).WithTags("Configurations");

        endpoints.MapPut("/api/configurations", async (
            HttpRequest request,
            IConfigurationApplyService apply,
            CancellationToken ct) =>
        {
            using var reader = new StreamReader(request.Body);
            var body = await reader.ReadToEndAsync(ct).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(body))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["body"] = ["JSON body is required."],
                });
            }

            List<(string SectionKey, string ValueJson)> sections;
            try
            {
                sections = ParseBatchBody(body);
            }
            catch (JsonException ex)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["body"] = [$"Invalid JSON: {ex.Message}"],
                });
            }
            catch (InvalidOperationException ex)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["body"] = [ex.Message],
                });
            }

            string? error;
            try
            {
                error = await apply.PutManyAndApplyAsync(sections, ct).ConfigureAwait(false);
            }
            catch (InvalidOperationException ex)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["configurations"] = [ex.Message],
                });
            }

            if (error is not null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["configurations"] = [error],
                });
            }

            return Results.Ok(new
            {
                ok = true,
                sections = sections.Select(s => s.SectionKey).ToArray(),
            });
        }).WithTags("Configurations");

        endpoints.MapGet("/api/configurations/{section}", async (
            string section,
            IConfigSectionStore store,
            IConfigurationService configuration,
            CancellationToken ct) =>
        {
            var key = ResolveKey(section);
            if (key is null)
                return Results.NotFound(new { error = $"Unknown section '{section}'." });

            if (string.Equals(key, ConfigSectionKeys.Journal, StringComparison.Ordinal))
            {
                return Results.Ok(configuration.GetJournalEvents());
            }

            var json = await store.GetSectionJsonAsync(key, ct).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(json))
            {
                return Results.Ok(EmptySection(key));
            }

            return Results.Content(json, "application/json");
        }).WithTags("Configurations");

        endpoints.MapPut("/api/configurations/{section}", async (
            string section,
            HttpRequest request,
            IConfigurationApplyService apply,
            CancellationToken ct) =>
        {
            var key = ResolveKey(section);
            if (key is null)
                return Results.NotFound(new { error = $"Unknown section '{section}'." });

            using var reader = new StreamReader(request.Body);
            var body = await reader.ReadToEndAsync(ct).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(body))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["body"] = ["JSON body is required."],
                });
            }

            // Normalize journal payload: accept raw events map or { events: { ... } }.
            if (string.Equals(key, ConfigSectionKeys.Journal, StringComparison.Ordinal))
            {
                body = NormalizeJournalBody(body);
            }

            string? error;
            try
            {
                error = await apply.PutAndApplyAsync(key, body, ct).ConfigureAwait(false);
            }
            catch (InvalidOperationException ex)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [section] = [ex.Message],
                });
            }

            if (error is not null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [section] = [error],
                });
            }

            return Results.Ok(new { ok = true, section = key });
        }).WithTags("Configurations");

        endpoints.MapGet("/api/journal/catalog", (IJournalCatalog catalog) =>
        {
            var types = catalog.Types.Select(d => new
            {
                d.Type,
                d.SchemaVersion,
                d.Name,
                d.Description,
                d.Owner,
                publishPolicy = d.PublishPolicy.ToString(),
                d.IsCanonical,
                enabled = catalog.IsTypeEnabled(d.Type),
            });
            return Results.Ok(types);
        }).WithTags("Journal");

        return endpoints;
    }

    private static string? ResolveKey(string section)
    {
        foreach (var key in ConfigSectionKeys.AllEngineSections)
        {
            if (string.Equals(section, key, StringComparison.Ordinal))
                return key;
        }

        return null;
    }

    private static object EmptySection(string key) => key switch
    {
        ConfigSectionKeys.Hosting => new HostingConfiguration(),
        ConfigSectionKeys.Navigation => new NavigationConfiguration(),
        ConfigSectionKeys.Sessions => new SessionsConfiguration(),
        ConfigSectionKeys.ResourceManagement => new ResourceManagementConfiguration(),
        _ => new { },
    };

    private static string NormalizeJournalBody(string body)
    {
        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.ValueKind == JsonValueKind.Object
            && doc.RootElement.TryGetProperty("events", out _))
        {
            return body;
        }

        // Raw map of type → bool
        var wrapped = new JournalEventsConfiguration
        {
            Events = JsonSerializer.Deserialize<Dictionary<string, bool>>(body)
                ?? new Dictionary<string, bool>(),
        };
        return JsonSerializer.Serialize(wrapped, ConfigSectionStore.SerializerOptions);
    }

    private static List<(string SectionKey, string ValueJson)> ParseBatchBody(string body)
    {
        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("Batch body must be a JSON object of section → payload.");

        var root = doc.RootElement;
        if (root.TryGetProperty("sections", out var nested)
            && nested.ValueKind == JsonValueKind.Object)
        {
            root = nested;
        }

        var sections = new List<(string SectionKey, string ValueJson)>();
        foreach (var property in root.EnumerateObject())
        {
            if (string.Equals(property.Name, "status", StringComparison.OrdinalIgnoreCase)
                || string.Equals(property.Name, "ok", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var key = ResolveKey(property.Name)
                ?? throw new InvalidOperationException($"Unknown configuration section '{property.Name}'.");

            var json = property.Value.ValueKind == JsonValueKind.String
                ? property.Value.GetString()
                    ?? throw new InvalidOperationException($"Section '{key}' JSON is required.")
                : property.Value.GetRawText();

            if (string.Equals(key, ConfigSectionKeys.Journal, StringComparison.Ordinal))
                json = NormalizeJournalBody(json);

            sections.Add((key, json));
        }

        if (sections.Count == 0)
            throw new InvalidOperationException("Batch body must include at least one configuration section.");

        return sections;
    }
}
