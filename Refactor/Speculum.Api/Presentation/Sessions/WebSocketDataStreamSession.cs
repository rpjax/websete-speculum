using System.Collections.Concurrent;
using System.IO.Pipelines;
using System.Net.WebSockets;
using System.Threading.Channels;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>WebSocket mux adapter for <see cref="IDataStreamSession"/>.</summary>
internal sealed class WebSocketDataStreamSession : IDataStreamSession, IAsyncDisposable
{
    private readonly WebSocket _socket;
    private readonly ConcurrentDictionary<ushort, MuxPipe> _pipes = new();
    private readonly Channel<IDataStreamPipe> _accepted =
        Channel.CreateUnbounded<IDataStreamPipe>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private int _nextServerStreamId = DataStreamMux.ServerStreamIdBase;
    private Task? _receiveLoop;
    private int _disposed;

    public WebSocketDataStreamSession(WebSocket socket)
    {
        _socket = socket ?? throw new ArgumentNullException(nameof(socket));
        _receiveLoop = Task.Run(() => ReceiveLoopAsync(_lifetime.Token));
    }

    public async Task<IDataStreamPipe?> AcceptClientPipeAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken,
                _lifetime.Token);
            return await _accepted.Reader.ReadAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        catch (ChannelClosedException)
        {
            return null;
        }
    }

    public async Task<IDataStreamPipe?> OpenUnidirectionalOutputAsync(
        CancellationToken cancellationToken)
    {
        if (_socket.State != WebSocketState.Open)
        {
            return null;
        }

        var streamId = (ushort)(Interlocked.Increment(ref _nextServerStreamId) - 1);
        var pipe = new MuxPipe(this, streamId, duplex: false);
        if (!_pipes.TryAdd(streamId, pipe))
        {
            return null;
        }

        await SendAsync(DataStreamMux.EncodeOpen(streamId), cancellationToken).ConfigureAwait(false);
        return pipe;
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _lifetime.Cancel();
        _accepted.Writer.TryComplete();
        foreach (var pipe in _pipes.Values)
        {
            await pipe.CompleteAsync().ConfigureAwait(false);
        }

        _pipes.Clear();

        try
        {
            if (_socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await _socket
                    .CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None)
                    .ConfigureAwait(false);
            }
        }
        catch
        {
            // ignore
        }

        if (_receiveLoop is not null)
        {
            try
            {
                await _receiveLoop.ConfigureAwait(false);
            }
            catch
            {
                // ignore
            }
        }

        _lifetime.Dispose();
        _sendLock.Dispose();
    }

    internal async Task SendDataAsync(
        ushort streamId,
        ReadOnlyMemory<byte> payload,
        CancellationToken cancellationToken)
    {
        await SendAsync(DataStreamMux.EncodeData(streamId, payload.Span), cancellationToken)
            .ConfigureAwait(false);
    }

    internal async Task SendCloseAsync(ushort streamId, CancellationToken cancellationToken)
    {
        try
        {
            await SendAsync(DataStreamMux.EncodeClose(streamId), cancellationToken)
                .ConfigureAwait(false);
        }
        catch
        {
            // peer may already be gone
        }
    }

    internal void Unregister(ushort streamId)
        => _pipes.TryRemove(streamId, out _);

    private async Task SendAsync(byte[] frame, CancellationToken cancellationToken)
    {
        await _sendLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_socket.State != WebSocketState.Open)
            {
                throw new WebSocketException("WebSocket is not open");
            }

            await _socket
                .SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken)
                .ConfigureAwait(false);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (!ct.IsCancellationRequested && _socket.State == WebSocketState.Open)
            {
                using var message = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await _socket
                        .ReceiveAsync(buffer, ct)
                        .ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        _accepted.Writer.TryComplete();
                        return;
                    }

                    if (result.MessageType != WebSocketMessageType.Binary)
                    {
                        continue;
                    }

                    message.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                if (!DataStreamMux.TryParse(message.ToArray(), out var op, out var streamId, out var payload))
                {
                    continue;
                }

                switch (op)
                {
                    case DataStreamMux.OpOpen:
                        HandleOpen(streamId);
                        break;
                    case DataStreamMux.OpData:
                        await HandleDataAsync(streamId, payload.ToArray()).ConfigureAwait(false);
                        break;
                    case DataStreamMux.OpClose:
                        await HandleCloseAsync(streamId).ConfigureAwait(false);
                        break;
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
        catch
        {
            // Tear down accept waiters; host observes pump end.
        }
        finally
        {
            _accepted.Writer.TryComplete();
        }
    }

    private void HandleOpen(ushort streamId)
    {
        if (streamId >= DataStreamMux.ServerStreamIdBase)
        {
            return;
        }

        var pipe = new MuxPipe(this, streamId, duplex: true);
        if (!_pipes.TryAdd(streamId, pipe))
        {
            return;
        }

        _ = _accepted.Writer.TryWrite(pipe);
    }

    private async Task HandleDataAsync(ushort streamId, byte[] payload)
    {
        if (!_pipes.TryGetValue(streamId, out var pipe))
        {
            return;
        }

        await pipe.WriteInboundAsync(payload).ConfigureAwait(false);
    }

    private async Task HandleCloseAsync(ushort streamId)
    {
        if (!_pipes.TryRemove(streamId, out var pipe))
        {
            return;
        }

        await pipe.CompleteAsync(sendClose: false).ConfigureAwait(false);
    }

    private sealed class MuxPipe : IDataStreamPipe
    {
        private readonly WebSocketDataStreamSession _session;
        private readonly ushort _streamId;
        private readonly Pipe _inbound = new();
        private readonly MuxOutputWriter? _output;
        private int _completed;

        public MuxPipe(WebSocketDataStreamSession session, ushort streamId, bool duplex)
        {
            _session = session;
            _streamId = streamId;
            _output = new MuxOutputWriter(session, streamId);
            Output = _output;
            if (duplex)
            {
                Input = _inbound.Reader;
            }
        }

        public PipeReader? Input { get; }

        public PipeWriter? Output { get; }

        public async Task WriteInboundAsync(byte[] payload)
        {
            if (payload.Length == 0)
            {
                return;
            }

            var memory = _inbound.Writer.GetMemory(payload.Length);
            payload.CopyTo(memory);
            _inbound.Writer.Advance(payload.Length);
            _ = await _inbound.Writer.FlushAsync().ConfigureAwait(false);
        }

        public async Task CompleteAsync(bool sendClose = true)
        {
            if (Interlocked.Exchange(ref _completed, 1) != 0)
            {
                return;
            }

            try
            {
                await _inbound.Writer.CompleteAsync().ConfigureAwait(false);
            }
            catch
            {
                // ignore
            }

            if (_output is not null)
            {
                await _output.CompleteAsync().ConfigureAwait(false);
            }

            if (sendClose)
            {
                await _session.SendCloseAsync(_streamId, CancellationToken.None).ConfigureAwait(false);
            }

            _session.Unregister(_streamId);
        }

        public async ValueTask DisposeAsync()
            => await CompleteAsync().ConfigureAwait(false);
    }

    private sealed class MuxOutputWriter : PipeWriter
    {
        private readonly WebSocketDataStreamSession _session;
        private readonly ushort _streamId;
        private readonly Pipe _pipe = new();
        private readonly CancellationTokenSource _cts = new();
        private readonly Task _pump;
        private int _completed;

        public MuxOutputWriter(WebSocketDataStreamSession session, ushort streamId)
        {
            _session = session;
            _streamId = streamId;
            _pump = Task.Run(PumpAsync);
        }

        public override void Advance(int bytes) => _pipe.Writer.Advance(bytes);

        public override void CancelPendingFlush() => _pipe.Writer.CancelPendingFlush();

        public override void Complete(Exception? exception = null)
        {
            _ = CompleteAsync(exception);
        }

        public override async ValueTask CompleteAsync(Exception? exception = null)
        {
            if (Interlocked.Exchange(ref _completed, 1) != 0)
            {
                return;
            }

            await _pipe.Writer.CompleteAsync(exception).ConfigureAwait(false);
            _cts.Cancel();
            try
            {
                await _pump.ConfigureAwait(false);
            }
            catch
            {
                // ignore
            }

            _cts.Dispose();
        }

        public override ValueTask<FlushResult> FlushAsync(CancellationToken cancellationToken = default)
            => _pipe.Writer.FlushAsync(cancellationToken);

        public override Memory<byte> GetMemory(int sizeHint = 0) => _pipe.Writer.GetMemory(sizeHint);

        public override Span<byte> GetSpan(int sizeHint = 0) => _pipe.Writer.GetSpan(sizeHint);

        private async Task PumpAsync()
        {
            try
            {
                while (true)
                {
                    var read = await _pipe.Reader.ReadAsync(_cts.Token).ConfigureAwait(false);
                    var buffer = read.Buffer;
                    if (buffer.Length > 0)
                    {
                        foreach (var segment in buffer)
                        {
                            if (segment.Length == 0)
                            {
                                continue;
                            }

                            await _session
                                .SendDataAsync(_streamId, segment, _cts.Token)
                                .ConfigureAwait(false);
                        }
                    }

                    _pipe.Reader.AdvanceTo(buffer.End);
                    if (read.IsCompleted)
                    {
                        break;
                    }
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch
            {
                // ignore
            }
            finally
            {
                await _pipe.Reader.CompleteAsync().ConfigureAwait(false);
            }
        }
    }
}
