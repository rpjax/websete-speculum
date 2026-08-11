using System.Text.Json;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry;
using Speculum.Api.Telemetry.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>Routes sidecar <c>parity_*</c> lifecycle payloads into Telemetry Journal facts.</summary>
internal static class PageProjectionParityTelemetryJournal
{
    public static void TryJournal(
        IJournalCatalog catalog,
        ISessionPageProjectionTelemetryEvents pageProjection,
        string phase,
        string payloadJson)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(pageProjection);
        if (string.IsNullOrWhiteSpace(phase) || string.IsNullOrWhiteSpace(payloadJson))
        {
            return;
        }

        using var doc = JsonDocument.Parse(payloadJson);
        var root = doc.RootElement;

        switch (phase.Trim())
        {
            case "parity_virtual_boot_marked":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionVirtualBootMarked)) return;
                pageProjection.Virtual.BootMarked(
                    Long(root, "browserLaunchedAtMs"),
                    Long(root, "firstCommitAtMs"),
                    Long(root, "bootMs"),
                    Str(root, "pageEpochId"));
                break;
            case "parity_virtual_nav_commit":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionVirtualNavCommit)) return;
                pageProjection.Virtual.NavCommit(
                    Required(root, "pageEpochId"),
                    Str(root, "url"),
                    Long(root, "generation"),
                    Str(root, "documentEpoch"),
                    Required(root, "navigationType"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_virtual_nav_timing":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionVirtualNavTiming)) return;
                pageProjection.Virtual.NavTiming(
                    Required(root, "pageEpochId"),
                    LongNull(root, "redirectMs"),
                    LongNull(root, "dnsMs"),
                    LongNull(root, "connectMs"),
                    LongNull(root, "ttfbMs"),
                    LongNull(root, "domInteractiveMs"),
                    LongNull(root, "domContentLoadedMs"),
                    LongNull(root, "loadEventMs"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_virtual_resource_summary":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionVirtualResourceSummary)) return;
                pageProjection.Virtual.ResourceSummary(
                    Required(root, "pageEpochId"),
                    JsonProp(root, "byType") ?? "[]",
                    JsonProp(root, "topSlow") ?? "[]",
                    Long(root, "tVirtualMs"));
                break;
            case "parity_virtual_page_error":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionVirtualPageError)) return;
                pageProjection.Virtual.PageError(
                    Required(root, "pageEpochId"),
                    Required(root, "source"),
                    Str(root, "message") ?? "",
                    Str(root, "urlKey"),
                    (int)Long(root, "count"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_virtual_lifecycle":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionVirtualLifecycle)) return;
                pageProjection.Virtual.Lifecycle(
                    Required(root, "pageEpochId"),
                    Required(root, "name"),
                    LongNull(root, "tSinceCommitMs"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_establish_styles_wait_started":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishStylesWaitStarted)) return;
                pageProjection.Establish.StylesWaitStarted(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    (int)Long(root, "timeoutMs"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_establish_styles_wait_completed":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishStylesWaitCompleted)) return;
                pageProjection.Establish.StylesWaitCompleted(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    (int)Long(root, "timeoutMs"),
                    Long(root, "waitedMs"),
                    Bool(root, "timedOut"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_establish_dom_map_started":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishDomMapStarted)) return;
                pageProjection.Establish.DomMapStarted(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    Required(root, "path"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_establish_dom_map_completed":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishDomMapCompleted)) return;
                pageProjection.Establish.DomMapCompleted(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    Required(root, "path"),
                    Long(root, "durationMs"),
                    IntNull(root, "approxNodes"),
                    Long(root, "tVirtualMs"),
                    Long(root, "takeRecordsMs"),
                    Long(root, "clearLedgerMs"),
                    Long(root, "anchorAllMs"),
                    Long(root, "remintMs"),
                    Long(root, "mapNodeMs"),
                    Long(root, "resetPublishedMs"),
                    Long(root, "cssomMs"),
                    Long(root, "pageTotalMs"),
                    Long(root, "cdpTransferMs"));
                break;
            case "parity_establish_cssom_install_started":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishCssomInstallStarted)) return;
                pageProjection.Establish.CssomInstallStarted(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    Required(root, "source"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_establish_cssom_install_completed":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishCssomInstallCompleted)) return;
                pageProjection.Establish.CssomInstallCompleted(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    Required(root, "source"),
                    Long(root, "durationMs"),
                    (int)Long(root, "sheetCount"),
                    (int)Long(root, "ruleCount"),
                    (int)Long(root, "seededSheetCount"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_establish_first_diff_emitted":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishFirstDiffEmitted)) return;
                pageProjection.Establish.FirstDiffEmitted(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    Required(root, "plane"),
                    Required(root, "operation"),
                    Long(root, "sequence"),
                    LongNull(root, "tSinceCommitMs"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_establish_completed":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishCompleted)) return;
                pageProjection.Establish.EstablishCompleted(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    Long(root, "totalMs"),
                    LongNull(root, "tSinceCommitMs"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_establish_failed":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionEstablishFailed)) return;
                pageProjection.Establish.EstablishFailed(
                    Required(root, "pageEpochId"),
                    Long(root, "generation"),
                    Required(root, "errorCode"),
                    Required(root, "phase"),
                    Str(root, "message"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_asset_rewrite_summary":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionAssetRewriteSummary)) return;
                pageProjection.Asset.RewriteSummary(
                    Required(root, "pageEpochId"),
                    (int)Long(root, "candidates"),
                    (int)Long(root, "rewritten"),
                    (int)Long(root, "bareSkipped"),
                    (int)Long(root, "dataInlined"),
                    (int)Long(root, "blobQueued"),
                    (int)Long(root, "deferredFetches"),
                    Long(root, "tVirtualMs"));
                break;
            case "parity_asset_fetch_finished":
                if (!catalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionAssetFetchFinished)) return;
                pageProjection.Asset.FetchFinished(
                    Required(root, "pageEpochId"),
                    Required(root, "urlKey"),
                    Long(root, "durationMs"),
                    Long(root, "bytes"),
                    Required(root, "mode"),
                    Bool(root, "ok"),
                    Long(root, "tVirtualMs"));
                break;
        }
    }

    private static string Required(JsonElement root, string name)
    {
        var v = Str(root, name);
        if (string.IsNullOrWhiteSpace(v))
        {
            throw new InvalidOperationException($"parity payload missing '{name}'");
        }

        return v;
    }

    private static string? Str(JsonElement root, string name)
        => root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;

    private static long Long(JsonElement root, string name)
        => LongNull(root, name) ?? 0;

    private static long? LongNull(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var el) || el.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return el.ValueKind switch
        {
            JsonValueKind.Number when el.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(el.GetString(), out var n) => n,
            _ => null,
        };
    }

    private static int? IntNull(JsonElement root, string name)
    {
        var n = LongNull(root, name);
        return n is null ? null : (int)n.Value;
    }

    private static bool Bool(JsonElement root, string name)
        => root.TryGetProperty(name, out var el)
            && el.ValueKind is JsonValueKind.True or JsonValueKind.False
            && el.GetBoolean();

    private static string? JsonProp(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var el))
        {
            return null;
        }

        return el.GetRawText();
    }
}
