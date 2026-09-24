using Speculum.Wire;

namespace Speculum.Supervisor.Control;

/// <summary>
/// Typed Fault dispatch — matches catalogued FaultCode, never parses text.
/// </summary>
public sealed class FaultDispatcher
{
    public event Action<Fault>? Received;

    public int HandledCount { get; private set; }

    public bool TryDispatch(ushort opcode, ReadOnlySpan<byte> payload)
    {
        if (opcode != OpFault.Code)
        {
            return false;
        }

        var fault = Codecs.DecodeFaultBytes(payload);
        HandledCount++;
        Received?.Invoke(fault);
        return true;
    }

    public static bool IsCatalogued(FaultCode code) => Enum.IsDefined(code);
}
