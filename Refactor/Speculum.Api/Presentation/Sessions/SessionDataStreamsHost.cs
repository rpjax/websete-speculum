using System.Buffers;
using System.Buffers.Binary;
using System.IO.Pipelines;
using System.Threading.Channels;
using MessagePack;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Runs logical data streams for one live session over any <see cref="IDataStreamSession"/> carrier.
/// Wire: one <see cref="SessionPipeKind"/> byte, then big-endian length-prefixed MessagePack.
/// </summary>
internal static class SessionDataStreamsHost
{
    private const int MaxMessageBytes = 1024 * 1024;

    public static async Task RunAsync(
        ILiveSession live,
        IDataStreamSession session,
        CancellationTokenSource lifetime)
    {
        ArgumentNullException.ThrowIfNull(live);
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(lifetime);

        var ct = lifetime.Token;
        var acceptTask = AcceptClientPipesAsync(session, live, lifetime);

        try
        {
            var pumps = new List<Task>
            {
                acceptTask,
                PumpFramesAsync(session, live, ct),
                PumpConsoleAsync(session, live, ct),
                PumpNotificationsAsync(session, live, ct),
            };

            await Task.WhenAll(pumps.Select(ObservePumpAsync)).ConfigureAwait(false);
        }
        finally
        {
            lifetime.Cancel();
        }
    }

    private static async Task AcceptClientPipesAsync(
        IDataStreamSession session,
        ILiveSession live,
        CancellationTokenSource lifetime)
    {
        var ct = lifetime.Token;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var pipe = await session.AcceptClientPipeAsync(ct).ConfigureAwait(false);
                if (pipe is null)
                {
                    break;
                }

                _ = ObservePumpAsync(HandleClientPipeAsync(pipe, live, ct));
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
        finally
        {
            lifetime.Cancel();
        }
    }

    private static async Task PumpFramesAsync(
        IDataStreamSession session,
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

        await PumpOutputAsync(session, SessionPipeKind.Frame, channel.Value, ct)
            .ConfigureAwait(false);
    }

    private static async Task PumpConsoleAsync(
        IDataStreamSession session,
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

        await PumpOutputAsync(session, SessionPipeKind.ConsoleOutput, channel.Value, ct)
            .ConfigureAwait(false);
    }

    private static async Task PumpNotificationsAsync(
        IDataStreamSession session,
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

        await PumpOutputAsync(session, SessionPipeKind.Notification, channel.Value, ct)
            .ConfigureAwait(false);
    }

    private static async Task PumpOutputAsync<T>(
        IDataStreamSession session,
        SessionPipeKind kind,
        ChannelReader<T> source,
        CancellationToken ct)
    {
        var pipe = await session.OpenUnidirectionalOutputAsync(ct).ConfigureAwait(false);
        if (pipe?.Output is null)
        {
            return;
        }

        await using (pipe.ConfigureAwait(false))
        {
            var output = pipe.Output;
            await output.WriteAsync(new[] { (byte)kind }, ct).ConfigureAwait(false);
            await output.FlushAsync(ct).ConfigureAwait(false);
            await foreach (var item in source.ReadAllAsync(ct).ConfigureAwait(false))
            {
                await WriteMessageAsync(output, item, ct).ConfigureAwait(false);
            }
        }
    }

    private static async Task HandleClientPipeAsync(
        IDataStreamPipe pipe,
        ILiveSession live,
        CancellationToken ct)
    {
        await using (pipe.ConfigureAwait(false))
        {
            if (pipe.Input is null)
            {
                return;
            }

            var kindBytes = await ReadExactAsync(pipe.Input, 1, ct).ConfigureAwait(false);
            if (kindBytes is null)
            {
                return;
            }

            var kind = (SessionPipeKind)kindBytes[0];
            switch (kind)
            {
                case SessionPipeKind.UserInput:
                    await HandleUserInputAsync(pipe.Input, live, ct).ConfigureAwait(false);
                    break;
                case SessionPipeKind.ConsoleInput:
                    await HandleConsoleInputAsync(pipe, live, ct).ConfigureAwait(false);
                    break;
                case SessionPipeKind.Status:
                    await HandleStatusAsync(pipe, live, ct).ConfigureAwait(false);
                    break;
            }
        }
    }

    private static async Task HandleUserInputAsync(
        PipeReader input,
        ILiveSession live,
        CancellationToken ct)
    {
        await foreach (var item in ReadMessagesAsync<UserInput>(input, ct).ConfigureAwait(false))
        {
            live.TraceInputPathWtReceived(item.Type);
            _ = live.AdmitUserInput(item);
        }
    }

    private static async Task HandleConsoleInputAsync(
        IDataStreamPipe pipe,
        ILiveSession live,
        CancellationToken ct)
    {
        if (pipe.Input is null)
        {
            return;
        }

        var channel = DropOldestChannels.Create<ConsoleInput>(16);
        var consume = live.ConsumeConsoleInputAsync(channel.Reader, ct);
        if (consume.IsFailure)
        {
            await foreach (var input in ReadMessagesAsync<ConsoleInput>(pipe.Input, ct)
                               .ConfigureAwait(false))
            {
                if (pipe.Output is null)
                {
                    continue;
                }

                await WriteMessageAsync(
                        pipe.Output,
                        new ConsoleOutput
                        {
                            Kind = ConsoleOutputKind.EvalResult,
                            RequestId = input.Id,
                            Ok = false,
                            Error = "JsBridge is disabled",
                        },
                        ct)
                    .ConfigureAwait(false);
            }

            return;
        }

        await ReadMessagesAsync(pipe.Input, channel.Writer, ct).ConfigureAwait(false);
        channel.Writer.TryComplete();
        await ObservePumpAsync(consume.Value).ConfigureAwait(false);
    }

    private static async Task HandleStatusAsync(
        IDataStreamPipe pipe,
        ILiveSession live,
        CancellationToken ct)
    {
        if (pipe.Output is null)
        {
            return;
        }

        var status = await live.GetStatusAsync(ct).ConfigureAwait(false);
        if (status.IsSuccess)
        {
            await WriteMessageAsync(pipe.Output, status.Value, ct).ConfigureAwait(false);
        }
    }

    private static async Task ReadMessagesAsync<T>(
        PipeReader reader,
        ChannelWriter<T> destination,
        CancellationToken ct)
    {
        await foreach (var item in ReadMessagesAsync<T>(reader, ct).ConfigureAwait(false))
        {
            _ = destination.TryWrite(item);
        }
    }

    private static async IAsyncEnumerable<T> ReadMessagesAsync<T>(
        PipeReader reader,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var lengthBytes = await ReadExactAsync(reader, sizeof(int), ct).ConfigureAwait(false);
            if (lengthBytes is null)
            {
                yield break;
            }

            var length = BinaryPrimitives.ReadInt32BigEndian(lengthBytes);
            if (length is <= 0 or > MaxMessageBytes)
            {
                yield break;
            }

            var payload = await ReadExactAsync(reader, length, ct).ConfigureAwait(false);
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
                Console.Error.WriteLine(
                    $"[data-streams] MessagePack deserialize {typeof(T).Name} failed: {ex.Message}");
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
        await writer.WriteAsync(header, ct).ConfigureAwait(false);
        await writer.WriteAsync(payload, ct).ConfigureAwait(false);
        await writer.FlushAsync(ct).ConfigureAwait(false);
    }

    private static async Task<byte[]?> ReadExactAsync(
        PipeReader reader,
        int length,
        CancellationToken ct)
    {
        while (true)
        {
            var read = await reader.ReadAsync(ct).ConfigureAwait(false);
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
            await task.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // One failed stream must not terminate the live session.
        }
    }

    /// <summary>Wire pipe kinds — must match client <c>PipeKind</c>.</summary>
    internal enum SessionPipeKind : byte
    {
        Frame = 1,
        ConsoleOutput = 2,
        Notification = 3,
        UserInput = 4,
        ConsoleInput = 5,
        Status = 6,
    }
}
