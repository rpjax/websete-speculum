using System.Collections.Concurrent;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Pipes.Streaming;

/// <summary>
/// Single-reader fan-out from <see cref="ISessionConnection"/> outbound streams
/// onto per-pipe <see cref="PipeStreamChannels"/>.
/// </summary>
internal sealed class SessionOutputFanOut
{
    private readonly ISessionConnection _connection;
    private readonly ConcurrentDictionary<Guid, PipeStreamChannels> _pipes;
    private readonly CancellationToken _lifetime;
    private int _started;

    public SessionOutputFanOut(
        ISessionConnection connection,
        ConcurrentDictionary<Guid, PipeStreamChannels> pipes,
        CancellationToken lifetime)
    {
        _connection = connection;
        _pipes = pipes;
        _lifetime = lifetime;
    }

    public void EnsureStarted()
    {
        if (Interlocked.Exchange(ref _started, 1) != 0)
        {
            return;
        }

        _ = PumpAsync(
            () => _connection.GetFrameReader(),
            static (c, item) => c.Frames.Writer.TryWrite(item));
        _ = PumpAsync(
            () => _connection.GetConsoleOutputReader(),
            static (c, item) => c.Console.Writer.TryWrite(item));
        _ = PumpAsync(
            () => _connection.GetNotificationReader(),
            static (c, item) => c.Notifications.Writer.TryWrite(item));
    }

    private async Task PumpAsync<T>(
        Func<IResult<ChannelReader<T>>> openReader,
        Action<PipeStreamChannels, T> write)
    {
        try
        {
            var opened = openReader();
            if (opened.IsFailure)
            {
                return;
            }

            await foreach (var item in opened.Value.ReadAllAsync(_lifetime).ConfigureAwait(false))
            {
                foreach (var channels in _pipes.Values)
                {
                    write(channels, item);
                }
            }
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (ChannelClosedException)
        {
        }
    }
}
