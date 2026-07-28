using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Models;

[JournalFact(
    "Telemetry.SessionSampleCollected",
    schemaVersion: 1,
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed record SessionSampleCollected(
    [property: JournalIndex("session", Format = "D")] Guid SessionId,
    Guid ProfileId,
    bool JsBridgeEnabled,
    bool ConnectionOpen,
    long UptimeMs,
    double? Fps,
    string? UrlHost);
