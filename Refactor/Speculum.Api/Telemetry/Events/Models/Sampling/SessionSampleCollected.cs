using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sampling;

[JournalFact(
    "Telemetry.Sampling.SessionSampleCollected",
    schemaVersion: 1,
    Name = "Session sample collected",
    Description = "Per-session slice of a periodic telemetry sample.",
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
