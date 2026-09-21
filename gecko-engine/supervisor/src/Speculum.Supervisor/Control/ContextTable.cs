using System.Collections.Concurrent;

namespace Speculum.Supervisor.Control;

/// <summary>
/// Os contextos da sessão. O supervisor é quem nomeia — nem o consumidor nem o
/// C++ escolhem id (doc 17 §6).
///
/// Ids começam em 1 porque 1 é a raiz para o cliente projetado, e a raiz é o
/// primeiro contexto pedido. 0 nunca é um contexto: significa "não se aplica"
/// no envelope (doc 18 §1).
/// </summary>
public sealed class ContextTable
{
    private readonly ConcurrentDictionary<uint, ContextEntry> _contexts = new();
    private int _nextId;

    public uint Allocate(string url)
    {
        var id = (uint)Interlocked.Increment(ref _nextId);
        _contexts[id] = new ContextEntry(id, url, 0);
        return id;
    }

    public void MarkCreated(uint contextId, ulong browsingContextId)
    {
        _contexts.AddOrUpdate(
            contextId,
            _ => new ContextEntry(contextId, string.Empty, browsingContextId),
            (_, existing) => existing with { BrowsingContextId = browsingContextId });
    }

    public void Remove(uint contextId) => _contexts.TryRemove(contextId, out _);

    public bool TryGet(uint contextId, out ContextEntry entry) => _contexts.TryGetValue(contextId, out entry);

    /// <summary>
    /// O contexto raiz da sessão, se existir. É o primeiro alocado e é o que o
    /// cliente projetado desenha.
    /// </summary>
    public bool TryGetRoot(out ContextEntry entry) => TryGet(1, out entry);

    public int Count => _contexts.Count;
}

public readonly record struct ContextEntry(uint ContextId, string Url, ulong BrowsingContextId);
