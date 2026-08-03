namespace Speculum.Api.Configurations.Models.Sessions;

/// <summary>Carrier for session data streams (frames, input, console).</summary>
public enum DataStreamTransportKind
{
    WebTransport = 0,
    WebSocket = 1,
}
