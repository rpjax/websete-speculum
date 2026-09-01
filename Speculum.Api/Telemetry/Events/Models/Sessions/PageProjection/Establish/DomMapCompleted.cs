using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Establish.DomMapCompleted",
    schemaVersion: 3,
    Name = "PageProjection establish · DomMapCompleted",
    Description = "Legacy DomMap name — V4 cold/resync uses the stream seed path; residual journal only (not accept proof).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class DomMapCompleted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public string Path { get; init; } = "";

    /// <summary>Wall clock around page.evaluate (Node) — includes CDP marshalling. Mirror path ≈ clone ms.</summary>
    public long DurationMs { get; init; }

    public int? ApproxNodes { get; init; }

    public long TVirtualMs { get; init; }

    public long TakeRecordsMs { get; init; }

    public long ClearLedgerMs { get; init; }

    public long AnchorAllMs { get; init; }

    public long RemintMs { get; init; }

    public long MapNodeMs { get; init; }

    public long ResetPublishedMs { get; init; }

    /// <summary>Cssom portion when Dom+Cssom share one evaluate (establish); 0 on Dom-only resync map.</summary>
    public long CssomMs { get; init; }

    /// <summary>Sum of in-page phases (Date.now in the page) — excludes CDP transfer.</summary>
    public long PageTotalMs { get; init; }

    /// <summary>max(0, DurationMs - PageTotalMs) — Playwright/CDP return overhead estimate.</summary>
    public long CdpTransferMs { get; init; }

    /// <summary>True when Dom came from sidecar <c>domInstallRoot</c> clone (no page DomMap evaluate).</summary>
    public bool Mirror { get; init; }
}
