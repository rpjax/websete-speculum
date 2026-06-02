using System.Diagnostics.CodeAnalysis;

namespace Websete.Speculum.Host.Virtualization.Contracts;

/// <summary>
/// Registo singleton de sessões de virtualização ativas, indexadas por
/// <c>ConnectionId</c> do SignalR.
/// </summary>
public interface IVSessionRegistry
{
    /// <summary>Associa (ou substitui) uma sessão ao ID de conexão dado.</summary>
    void Register(string connectionId, VSession session);

    /// <summary>Devolve a sessão associada ou <c>null</c> se não existir.</summary>
    VSession? Get(string connectionId);

    /// <summary>
    /// Remove e devolve a sessão associada.
    /// Devolve <c>true</c> se existia uma sessão registada.
    /// </summary>
    bool TryRemove(string connectionId, [NotNullWhen(true)] out VSession? session);
}
