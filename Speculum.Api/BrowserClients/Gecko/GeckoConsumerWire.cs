using Speculum.Supervisor.Wire;

namespace Speculum.Api.BrowserClients.Gecko;

/// <summary>
/// Classifica mensagens do WS consumidor do supervisor — o mesmo contrato do Lab
/// (<c>Speculum.Lab.Upstream.SupervisorClient</c>).
/// Frame PP chega como carga crua; Asset / Telemetry / BrowserEvent vêm envelopados.
/// </summary>
internal static class GeckoConsumerWire
{
    public enum Kind : byte
    {
        ProjectionFrame = 0,
        Asset = 1,
        BrowserEvent = 2,
        Telemetry = 3,
    }

    /// <summary>
    /// Espelha o lab: tenta envelopes conhecidos; senão a mensagem inteira é frame PP.
    /// </summary>
    public static bool TryClassify(
        byte[] message,
        out Kind kind,
        out uint contextId,
        out ArraySegment<byte> payload)
    {
        kind = Kind.ProjectionFrame;
        contextId = 0;
        payload = default;

        if (message is null || message.Length == 0)
        {
            return false;
        }

        if (Envelope.TryReadComplete(message, EnvelopeKind.Asset, out contextId, out var assetLen))
        {
            kind = Kind.Asset;
            payload = new ArraySegment<byte>(message, Envelope.HeaderBytes, assetLen);
            return true;
        }

        if (Envelope.TryReadComplete(message, EnvelopeKind.BrowserEvent, out contextId, out var eventLen))
        {
            kind = Kind.BrowserEvent;
            payload = new ArraySegment<byte>(message, Envelope.HeaderBytes, eventLen);
            return true;
        }

        if (Envelope.TryReadComplete(message, EnvelopeKind.Telemetry, out contextId, out var telLen))
        {
            kind = Kind.Telemetry;
            payload = new ArraySegment<byte>(message, Envelope.HeaderBytes, telLen);
            return true;
        }

        // BrowserLink.Broadcast(Frame) envia a carga PP sem envelope — igual ao lab.
        if (Envelope.TryReadComplete(message, EnvelopeKind.Frame, out contextId, out var frameLen))
        {
            kind = Kind.ProjectionFrame;
            payload = new ArraySegment<byte>(message, Envelope.HeaderBytes, frameLen);
            return true;
        }

        kind = Kind.ProjectionFrame;
        contextId = 0;
        payload = new ArraySegment<byte>(message);
        return true;
    }
}
