using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Input;

/// <summary>
/// Hop 1 when input arrives on the control plane (SignalR). Used while client-initiated
/// WebTransport UserInput streams are unreliable on some lab paths (~60s Accept delay).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.Input.ControlReceived",
    schemaVersion: 1,
    Name = "Input control received",
    Description = "User input was admitted on the SignalR control plane.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ControlReceived
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }
}
