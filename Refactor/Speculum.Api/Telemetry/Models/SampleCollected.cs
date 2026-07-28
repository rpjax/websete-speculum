using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Models;

[JournalFact(
    "Telemetry.SampleCollected",
    schemaVersion: 1,
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed record SampleCollected(
    HostTelemetry? Host,
    ApiProcessTelemetry? ApiProcess,
    SessionsTelemetry? Sessions,
    SidecarTelemetrySample? Sidecar,
    ProfilesTelemetry? Profiles,
    JournalTelemetry? Journal,
    DockerTelemetry? Docker);
