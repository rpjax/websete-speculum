namespace Speculum.Supervisor.Wire;

/// <summary>
/// Tipo do envelope trocado entre o processo pai do Gecko e o supervisor.
/// </summary>
public enum EnvelopeKind : byte
{
    /// <summary>Bytes de um frame de projeção. Opacos para o supervisor.</summary>
    Frame = 0x01,

    /// <summary>Evento do browser para o supervisor, em JSON UTF-8 (doc 12).</summary>
    BrowserEvent = 0x02,

    /// <summary>Apresentação do browser ao conectar. Payload vazio na v1.</summary>
    Hello = 0x03,

    /// <summary>Comando do supervisor para o browser, em JSON UTF-8 (doc 12).</summary>
    Control = 0x04,
}

/// <summary>
/// Cabeçalho de 9 bytes, little-endian:
/// <code>
///   u8  Kind
///   u32 ContextId   — roteamento; 0 quando não se aplica
///   u32 Length      — bytes de payload
/// </code>
///
/// O <c>ContextId</c> viaja NO ENVELOPE, não é lido de dentro do frame. É isso
/// que permite ao supervisor rotear sem nunca interpretar o conteúdo — a regra
/// do doc 11 §9: o supervisor é cego ao frame. O frame é carga opaca.
/// </summary>
public static class Envelope
{
    public const int HeaderBytes = 9;

    /// <summary>Teto de sanidade por payload. Frame maior que isso é erro de protocolo.</summary>
    public const int MaxPayloadBytes = 64 * 1024 * 1024;

    public static void WriteHeader(Span<byte> destination, EnvelopeKind kind, uint contextId, int length)
    {
        if (destination.Length < HeaderBytes)
        {
            throw new ArgumentException("buffer menor que o cabeçalho", nameof(destination));
        }

        if (length is < 0 or > MaxPayloadBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(length), length, "payload fora do limite");
        }

        destination[0] = (byte)kind;
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(destination[1..5], contextId);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(destination[5..9], (uint)length);
    }

    public static (EnvelopeKind Kind, uint ContextId, int Length) ReadHeader(ReadOnlySpan<byte> source)
    {
        if (source.Length < HeaderBytes)
        {
            throw new ArgumentException("buffer menor que o cabeçalho", nameof(source));
        }

        var kind = (EnvelopeKind)source[0];
        var contextId = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(source[1..5]);
        var length = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(source[5..9]);

        if (length > MaxPayloadBytes)
        {
            throw new InvalidDataException($"payload de {length} bytes excede o limite de {MaxPayloadBytes}");
        }

        return (kind, contextId, (int)length);
    }
}
