using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Input;

[JournalFact(
    "Telemetry.Sessions.Input.WebTransportReceived",
    schemaVersion: 1,
    Name = "Input WebTransport received",
    Description = "User input framed message was received on the WebTransport UserInput pipe.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class WebTransportReceived
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }
}
