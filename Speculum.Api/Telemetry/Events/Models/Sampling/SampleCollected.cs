using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;
using Speculum.Api.Telemetry.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sampling;

[JournalFact(
    "Telemetry.Sampling.SampleCollected",
    schemaVersion: 1,
    Name = "Sample collected",
    Description = "Periodic composite resource sample.",
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
