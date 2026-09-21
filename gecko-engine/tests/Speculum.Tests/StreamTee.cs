namespace Speculum.Tests;

/// <summary>
/// Tee por offset: o mesmo streamId reconstitui o corpo na ordem dos chunks.
/// </summary>
public sealed class StreamTee
{
    private readonly Dictionary<uint, SortedDictionary<ulong, byte[]>> _chunks = [];
    private readonly HashSet<uint> _denied = [];
    private readonly HashSet<uint> _complete = [];

    public void Apply(uint streamId, byte phase, ulong offset, ReadOnlySpan<byte> data)
    {
        if (phase == AssetPayload.PhaseDenied)
        {
            _denied.Add(streamId);
            _chunks.Remove(streamId);
            return;
        }

        if (phase == AssetPayload.PhaseComplete)
        {
            _complete.Add(streamId);
            return;
        }

        if (phase != AssetPayload.PhaseChunk)
        {
            return;
        }

        if (_denied.Contains(streamId))
        {
            return;
        }

        if (!_chunks.TryGetValue(streamId, out var parts))
        {
            parts = [];
            _chunks[streamId] = parts;
        }

        parts[offset] = data.ToArray();
    }

    public bool Denied(uint streamId) => _denied.Contains(streamId);

    public bool Complete(uint streamId) => _complete.Contains(streamId);

    public byte[] Assemble(uint streamId)
    {
        if (!_chunks.TryGetValue(streamId, out var parts) || parts.Count == 0)
        {
            return [];
        }

        using var ms = new MemoryStream();
        ulong expected = 0;
        foreach (var (offset, chunk) in parts)
        {
            if (offset != expected)
            {
                throw new InvalidDataException($"tee buraco no offset {expected}, veio {offset}");
            }

            ms.Write(chunk);
            expected += (ulong)chunk.Length;
        }

        return ms.ToArray();
    }
}
