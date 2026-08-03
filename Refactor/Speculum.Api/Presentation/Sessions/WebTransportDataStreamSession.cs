#pragma warning disable CA2252 // Kestrel WebTransport server APIs remain preview in .NET 10.
using System.IO.Pipelines;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.Http.Features;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>WebTransport adapter for <see cref="IDataStreamSession"/>.</summary>
internal sealed class WebTransportDataStreamSession : IDataStreamSession
{
    private readonly IWebTransportSession _session;

    public WebTransportDataStreamSession(IWebTransportSession session)
    {
        _session = session ?? throw new ArgumentNullException(nameof(session));
    }

    public async Task<IDataStreamPipe?> AcceptClientPipeAsync(CancellationToken cancellationToken)
    {
        var stream = await _session.AcceptStreamAsync(cancellationToken).ConfigureAwait(false);
        return stream is null ? null : new ConnectionDataStreamPipe(stream);
    }

    public async Task<IDataStreamPipe?> OpenUnidirectionalOutputAsync(CancellationToken cancellationToken)
    {
        var stream = await _session.OpenUnidirectionalStreamAsync(cancellationToken)
            .ConfigureAwait(false);
        return stream is null ? null : new ConnectionDataStreamPipe(stream);
    }

    private sealed class ConnectionDataStreamPipe : IDataStreamPipe
    {
        private readonly ConnectionContext _connection;

        public ConnectionDataStreamPipe(ConnectionContext connection)
        {
            _connection = connection;
        }

        public PipeReader? Input => _connection.Transport.Input;

        public PipeWriter? Output => _connection.Transport.Output;

        public ValueTask DisposeAsync() => _connection.DisposeAsync();
    }
}
#pragma warning restore CA2252
