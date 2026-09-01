using System.IO.Pipelines;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Byte pipe on a data-stream carrier (readable and/or writable).
/// </summary>
internal interface IDataStreamPipe : IAsyncDisposable
{
    PipeReader? Input { get; }

    PipeWriter? Output { get; }
}

/// <summary>
/// Carrier session for logical data streams. Implementations: WebTransport now; WebSocket later.
/// </summary>
internal interface IDataStreamSession
{
    /// <summary>Accepts the next client-initiated pipe, or null when the peer is done.</summary>
    Task<IDataStreamPipe?> AcceptClientPipeAsync(CancellationToken cancellationToken);

    /// <summary>Opens a server→client unidirectional pipe, or null if unavailable.</summary>
    Task<IDataStreamPipe?> OpenUnidirectionalOutputAsync(CancellationToken cancellationToken);
}
