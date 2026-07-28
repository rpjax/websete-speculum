#pragma warning disable CA2252 // Kestrel WebTransport server APIs remain preview in .NET 10.
using System.Buffers;
using System.Buffers.Binary;
using System.IO.Pipelines;
using System.Threading.Channels;
using MessagePack;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// WebTransport data plane. Each stream starts with one <see cref="SessionPipeKind"/>
/// byte, followed by big-endian length-prefixed MessagePack messages.
/// </summary>
internal static class SessionWebTransportEndpoint
{
    private const int MaxMessageBytes = 1024 * 1024;

    public static IEndpointConventionBuilder Map(IEndpointRouteBuilder endpoints)
        => endpoints.Map("/vtransport", HandleAsync);

    private static async Task HandleAsync(HttpContext context)
    {
        if (!Guid.TryParse(context.Request.Query["sessionId"], out var sessionId)
            || string.IsNullOrWhiteSpace(context.Request.Query["token"]))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var token = context.Request.Query["token"].ToString();
        var bindings = context.RequestServices.GetRequiredService<ISessionBindingRegistry>();
        var liveSessions = context.RequestServices.GetRequiredService<ILiveSessionService>();
        if (!bindings.TryGetLive(sessionId, token, out _)
            || !liveSessions.TryGet(sessionId, out var live))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var feature = context.Features.Get<IHttpWebTransportFeature>();
        if (feature is not { IsWebTransportRequest: true })
        {
            context.Response.StatusCode = StatusCodes.Status426UpgradeRequired;
            return;
        }

        var session = await feature.AcceptAsync(context.RequestAborted);
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(
            context.RequestAborted);
        var pipeId = Guid.CreateVersion7();
        var registration = bindings.RegisterPipe(
            sessionId,
            token,
            pipeId,
            new CancellationResource(lifetime));
        if (registration.IsFailure)
        {
            session.Abort(0x010c);
            return;
        }

        try
        {
            await RunSessionAsync(session, live, lifetime);
        }
        finally
        {
            lifetime.Cancel();
            bindings.UnregisterPipe(pipeId);
        }
    }

    private static async Task RunSessionAsync(
        IWebTransportSession transport,
        ILiveSession live,
        CancellationTokenSource lifetime)
    {
        var ct = lifetime.Token;
        var pumps = new List<Task>
        {
            PumpFramesAsync(transport, live, ct),
            PumpConsoleAsync(transport, live, ct),
            PumpNotificationsAsync(transport, live, ct),
        };

        try
        {
            while (!ct.IsCancellationRequested)
            {
                var stream = await transport.AcceptStreamAsync(ct);
                if (stream is null)
                {
                    break;
                }

                pumps.Add(HandleClientStreamAsync(stream, live, ct));
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
        finally
        {
            lifetime.Cancel();
            await Task.WhenAll(pumps.Select(ObservePumpAsync));
        }
    }

    private static async Task PumpFramesAsync(
        IWebTransportSession transport,
        ILiveSession live,
        CancellationToken ct)
    {
        var opened = live.OpenFrameStream();
        if (opened.IsFailure)
        {
            return;
        }

        using var source = opened.Value;
        var channel = source.GetFramesChannel();
        if (channel.IsFailure)
        {
            return;
        }

        await PumpOutputAsync(
            transport,
            SessionPipeKind.Frame,
            channel.Value,
            ct);
    }

    private static async Task PumpConsoleAsync(
        IWebTransportSession transport,
        ILiveSession live,
        CancellationToken ct)
    {
        var opened = live.OpenConsoleOutputStream();
        if (opened.IsFailure)
        {
            return;
        }

        using var source = opened.Value;
        var channel = source.GetConsoleOutputChannel();
        if (channel.IsFailure)
        {
            return;
        }

        await PumpOutputAsync(
            transport,
            SessionPipeKind.ConsoleOutput,
            channel.Value,
            ct);
    }

    private static async Task PumpNotificationsAsync(
        IWebTransportSession transport,
        ILiveSession live,
        CancellationToken ct)
    {
        var opened = live.OpenNotificationStream();
        if (opened.IsFailure)
        {
            return;
        }

        using var source = opened.Value;
        var channel = source.GetNotificationChannel();
        if (channel.IsFailure)
        {
            return;
        }

        await PumpOutputAsync(
            transport,
            SessionPipeKind.Notification,
            channel.Value,
            ct);
    }

    private static async Task PumpOutputAsync<T>(
        IWebTransportSession transport,
        SessionPipeKind kind,
        ChannelReader<T> source,
        CancellationToken ct)
    {
        var stream = await transport.OpenUnidirectionalStreamAsync(ct);
        if (stream is null)
        {
            return;
        }

        await using var ownedStream = stream;
        await stream.Transport.Output.WriteAsync(
            new[] { (byte)kind },
            ct);
        await foreach (var item in source.ReadAllAsync(ct))
        {
            await WriteMessageAsync(stream.Transport.Output, item, ct);
        }
    }

    private static async Task HandleClientStreamAsync(
        ConnectionContext stream,
        ILiveSession live,
        CancellationToken ct)
    {
        await using (stream)
        {
            var kindBytes = await ReadExactAsync(stream.Transport.Input, 1, ct);
            if (kindBytes is null)
            {
                return;
            }

            switch ((SessionPipeKind)kindBytes[0])
            {
                case SessionPipeKind.UserInput:
                    await HandleUserInputAsync(stream, live, ct);
                    break;
                case SessionPipeKind.ConsoleInput:
                    await HandleConsoleInputAsync(stream, live, ct);
                    break;
                case SessionPipeKind.Status:
                    await HandleStatusAsync(stream, live, ct);
                    break;
            }
        }
    }

    private static async Task HandleUserInputAsync(
        ConnectionContext stream,
        ILiveSession live,
        CancellationToken ct)
    {
        var channel = DropOldestChannels.Create<UserInput>(32);
        var consume = live.ConsumeUserInputAsync(channel.Reader, ct);
        if (consume.IsFailure)
        {
            return;
        }

        await foreach (var item in ReadMessagesAsync<UserInput>(stream.Transport.Input, ct))
        {
            live.TraceInputPathWtReceived(item.Type);
            // DropOldest: never block the WT reader waiting for buffer space.
            _ = channel.Writer.TryWrite(item);
        }

        channel.Writer.TryComplete();
        await ObservePumpAsync(consume.Value);
    }

    private static async Task HandleConsoleInputAsync(
        ConnectionContext stream,
        ILiveSession live,
        CancellationToken ct)
    {
        var channel = DropOldestChannels.Create<ConsoleInput>(16);
        var consume = live.ConsumeConsoleInputAsync(channel.Reader, ct);
        if (consume.IsFailure)
        {
            await foreach (var input in ReadMessagesAsync<ConsoleInput>(
                               stream.Transport.Input,
                               ct))
            {
                await WriteMessageAsync(
                    stream.Transport.Output,
                    new ConsoleOutput
                    {
                        Kind = ConsoleOutputKind.EvalResult,
                        RequestId = input.Id,
                        Ok = false,
                        Error = "JsBridge is disabled",
                    },
                    ct);
            }

            return;
        }

        await ReadMessagesAsync(stream.Transport.Input, channel.Writer, ct);
        channel.Writer.TryComplete();
        await ObservePumpAsync(consume.Value);
    }

    private static async Task HandleStatusAsync(
        ConnectionContext stream,
        ILiveSession live,
        CancellationToken ct)
    {
        var status = await live.GetStatusAsync(ct);
        if (status.IsSuccess)
        {
            await WriteMessageAsync(stream.Transport.Output, status.Value, ct);
        }
    }

    private static async Task ReadMessagesAsync<T>(
        PipeReader reader,
        ChannelWriter<T> destination,
        CancellationToken ct)
    {
        await foreach (var item in ReadMessagesAsync<T>(reader, ct))
        {
            // DropOldest: never block the WT reader waiting for buffer space.
            _ = destination.TryWrite(item);
        }
    }

    private static async IAsyncEnumerable<T> ReadMessagesAsync<T>(
        PipeReader reader,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var lengthBytes = await ReadExactAsync(reader, sizeof(int), ct);
            if (lengthBytes is null)
            {
                yield break;
            }

            var length = BinaryPrimitives.ReadInt32BigEndian(lengthBytes);
            if (length is <= 0 or > MaxMessageBytes)
            {
                yield break;
            }

            var payload = await ReadExactAsync(reader, length, ct);
            if (payload is null)
            {
                yield break;
            }

            T item;
            try
            {
                item = MessagePackSerializer.Deserialize<T>(
                    payload,
                    SessionHubMessagePack.Options,
                    ct);
            }
            catch (MessagePackSerializationException ex)
            {
                // Was a silent continue — every bad UserInput looked like "canvas dead".
                Console.Error.WriteLine(
                    $"[vtransport] MessagePack deserialize {typeof(T).Name} failed: {ex.Message}");
                continue;
            }

            yield return item;
        }
    }

    private static async Task WriteMessageAsync<T>(
        PipeWriter writer,
        T value,
        CancellationToken ct)
    {
        var payload = MessagePackSerializer.Serialize(
            value,
            SessionHubMessagePack.Options,
            ct);
        var header = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32BigEndian(header, payload.Length);
        await writer.WriteAsync(header, ct);
        await writer.WriteAsync(payload, ct);
    }

    private static async Task<byte[]?> ReadExactAsync(
        PipeReader reader,
        int length,
        CancellationToken ct)
    {
        while (true)
        {
            var read = await reader.ReadAsync(ct);
            var buffer = read.Buffer;
            if (buffer.Length >= length)
            {
                var bytes = new byte[length];
                buffer.Slice(0, length).CopyTo(bytes);
                reader.AdvanceTo(buffer.GetPosition(length));
                return bytes;
            }

            reader.AdvanceTo(buffer.Start, buffer.End);
            if (read.IsCompleted)
            {
                return null;
            }
        }
    }

    private static async Task ObservePumpAsync(Task task)
    {
        try
        {
            await task;
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // One failed stream must not terminate the live session.
        }
    }

    private enum SessionPipeKind : byte
    {
        Frame = 1,
        ConsoleOutput = 2,
        Notification = 3,
        UserInput = 4,
        ConsoleInput = 5,
        Status = 6,
    }

    private sealed class CancellationResource : IDisposable
    {
        private readonly CancellationTokenSource _source;

        public CancellationResource(CancellationTokenSource source)
        {
            _source = source;
        }

        public void Dispose()
        {
            try
            {
                _source.Cancel();
            }
            catch (ObjectDisposedException)
            {
            }
        }
    }
}
#pragma warning restore CA2252
