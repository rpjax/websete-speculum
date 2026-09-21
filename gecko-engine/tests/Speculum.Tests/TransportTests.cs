using Speculum.Supervisor.Control;
using Speculum.Supervisor.Wire;

namespace Speculum.Tests;

/// <summary>
/// L2 — enquadramento (doc 19 §4).
///
/// Todo caso aqui já foi defeito real neste projeto. O mais caro deles — a
/// leitura curta — custou uma noite e teria morrido em dois segundos.
/// </summary>
public static class TransportTests
{
    public static async Task<int> RunAsync()
    {
        var report = new Report("L2 transporte");
        Console.WriteLine("L2 — transporte e enquadramento");

        await ShortReads(report);
        await GluedEnvelopes(report);
        await EmptyPayload(report);
        await CleanEndOfStream(report);
        await TruncatedMidMessage(report);
        await OversizedRejected(report);
        await KindTelemetryAndAsset(report);
        HistoryGoIsNotAssetEnvelope(report);

        return report.Finish();
    }

    private static async Task KindTelemetryAndAsset(Report report)
    {
        var telemetry = Frame(EnvelopeKind.Telemetry, 1, [0x01, 0x00, 0xaa]);
        var asset = Frame(EnvelopeKind.Asset, 1, AssetPayload.Encode(3, AssetPayload.PhaseDenied, 0, "text/html"u8.ToArray()));
        var reader = new EnvelopeReader(new DripStream(telemetry.Concat(asset).ToArray(), bytesPerRead: 2));
        var a = await reader.ReadAsync(CancellationToken.None);
        var b = await reader.ReadAsync(CancellationToken.None);
        report.Equal("kind 0x05 Telemetry", EnvelopeKind.Telemetry, a!.Value.Kind);
        report.Equal("kind 0x06 Asset", EnvelopeKind.Asset, b!.Value.Kind);
        report.Equal("asset denied phase", AssetPayload.PhaseDenied, AssetPayload.Decode(b.Value.Payload).Phase);
    }

    /// <summary>
    /// HistoryGo = 0x0106: o primeiro byte no fio é 0x06, o mesmo Kind Asset.
    /// Discriminar pelo envelope completo, senão o hub engole o comando.
    /// </summary>
    private static void HistoryGoIsNotAssetEnvelope(Report report)
    {
        var history = ControlCommand.HistoryGo(6, 0, -1);
        report.Equal("HistoryGo não é envelope Asset", false,
            Envelope.TryReadComplete(history, EnvelopeKind.Asset, out _, out _));

        var colliding = ControlCommand.HistoryGo(0x05000000, 0, -1);
        report.Equal("HistoryGo corr alta não é Asset", false,
            Envelope.TryReadComplete(colliding, EnvelopeKind.Asset, out _, out _));

        var asset = Frame(EnvelopeKind.Asset, 1, AssetPayload.Encode(3, AssetPayload.PhaseDenied, 0, "text/html"u8.ToArray()));
        report.Equal("envelope Asset completo reconhece", true,
            Envelope.TryReadComplete(asset, EnvelopeKind.Asset, out var ctx, out var length));
        report.Equal("envelope Asset contextId", 1u, ctx);
        report.Equal("envelope Asset length", asset.Length - Envelope.HeaderBytes, length);
    }

    /// <summary>O par escreve 1 byte por vez. O leitor tem que remontar a mensagem.</summary>
    private static async Task ShortReads(Report report)
    {
        var payload = new byte[] { 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00 };
        var stream = new DripStream(Frame(EnvelopeKind.Control, 1, payload), bytesPerRead: 1);
        var reader = new EnvelopeReader(stream);

        var message = await reader.ReadAsync(CancellationToken.None);
        if (message is null)
        {
            report.Fail("leitura curta de 1 byte por vez", "mensagem remontada", "fim de fluxo");
            return;
        }

        report.Bytes("leitura curta: payload remontado", payload, message.Value.Payload);
        report.Equal("leitura curta: contextId", 1u, message.Value.ContextId);
    }

    /// <summary>Dois envelopes num único write não podem virar um só.</summary>
    private static async Task GluedEnvelopes(Report report)
    {
        var first = new byte[] { 0xaa, 0xbb };
        var second = new byte[] { 0xcc, 0xdd, 0xee };
        var glued = Frame(EnvelopeKind.Frame, 7, first).Concat(Frame(EnvelopeKind.Frame, 9, second)).ToArray();

        var reader = new EnvelopeReader(new DripStream(glued, bytesPerRead: 1024));

        var a = await reader.ReadAsync(CancellationToken.None);
        var b = await reader.ReadAsync(CancellationToken.None);

        if (a is null || b is null)
        {
            report.Fail("envelopes colados", "dois envelopes", $"a={a is not null} b={b is not null}");
            return;
        }

        report.Bytes("colados: primeiro payload", first, a.Value.Payload);
        report.Bytes("colados: segundo payload", second, b.Value.Payload);
        report.Equal("colados: contextId do segundo", 9u, b.Value.ContextId);
    }

    private static async Task EmptyPayload(Report report)
    {
        var reader = new EnvelopeReader(new DripStream(Frame(EnvelopeKind.Hello, 0, []), 1));
        var message = await reader.ReadAsync(CancellationToken.None);

        if (message is null)
        {
            report.Fail("payload vazio", "envelope Hello", "fim de fluxo");
            return;
        }

        report.Equal("payload vazio: kind", EnvelopeKind.Hello, message.Value.Kind);
        report.Equal("payload vazio: tamanho", 0, message.Value.Payload.Length);
    }

    /// <summary>Fim de fluxo na fronteira de um envelope é encerramento limpo, não erro.</summary>
    private static async Task CleanEndOfStream(Report report)
    {
        var reader = new EnvelopeReader(new DripStream([], 1));
        var message = await reader.ReadAsync(CancellationToken.None);
        report.Equal("fim de fluxo limpo devolve null", true, message is null);
    }

    /// <summary>Queda no meio da mensagem é erro reportado, nunca leitura fora de limite.</summary>
    private static async Task TruncatedMidMessage(Report report)
    {
        var full = Frame(EnvelopeKind.Control, 1, [1, 2, 3, 4, 5, 6, 7, 8]);
        var cut = full[..(full.Length - 3)];
        var reader = new EnvelopeReader(new DripStream(cut, 1));

        try
        {
            await reader.ReadAsync(CancellationToken.None);
            report.Fail("queda no meio da mensagem", "exceção de fim inesperado", "leu sem reclamar");
        }
        catch (EndOfStreamException)
        {
            report.Pass("queda no meio da mensagem reportada");
        }
        catch (InvalidDataException)
        {
            report.Pass("queda no meio da mensagem reportada");
        }
    }

    /// <summary>Payload acima do teto é violação de protocolo, não condição a tratar.</summary>
    private static async Task OversizedRejected(Report report)
    {
        var header = new byte[Envelope.HeaderBytes];
        header[0] = (byte)EnvelopeKind.Frame;
        BitConverter.TryWriteBytes(header.AsSpan(1), 1u);
        BitConverter.TryWriteBytes(header.AsSpan(5), (uint)(Envelope.MaxPayloadBytes + 1));

        var reader = new EnvelopeReader(new DripStream(header, 1));
        try
        {
            await reader.ReadAsync(CancellationToken.None);
            report.Fail("payload acima do teto", "InvalidDataException", "aceitou");
        }
        catch (InvalidDataException)
        {
            report.Pass("payload acima do teto recusado");
        }
    }

    private static byte[] Frame(EnvelopeKind kind, uint contextId, byte[] payload)
    {
        var buffer = new byte[Envelope.HeaderBytes + payload.Length];
        Envelope.WriteHeader(buffer, kind, contextId, payload.Length);
        payload.CopyTo(buffer, Envelope.HeaderBytes);
        return buffer;
    }

    /// <summary>
    /// Fluxo hostil: devolve no máximo <c>bytesPerRead</c> por leitura. É assim
    /// que um socket real se comporta, e é o que quase nenhum código trata.
    /// </summary>
    private sealed class DripStream(byte[] data, int bytesPerRead) : Stream
    {
        private int _position;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => data.Length;
        public override long Position { get => _position; set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count) =>
            Read(buffer.AsSpan(offset, count));

        public override int Read(Span<byte> buffer)
        {
            var remaining = data.Length - _position;
            if (remaining <= 0)
            {
                return 0;
            }

            var take = Math.Min(Math.Min(bytesPerRead, buffer.Length), remaining);
            data.AsSpan(_position, take).CopyTo(buffer);
            _position += take;
            return take;
        }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Read(buffer.Span));

        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
