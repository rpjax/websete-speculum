using System.Threading.Channels;
using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Bounded wait-mode input pipe — forwards without coalescing or dropping (M2 dumb pipe).
/// </summary>
internal static class SessionInputPipe
{
    public const int DefaultCapacity = 64;

    public static Channel<T> Create<T>()
        => Channel.CreateBounded<T>(new BoundedChannelOptions(DefaultCapacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false,
        });

    public static IResult Write<T>(ChannelWriter<T> writer, T item, CancellationToken ct)
    {
        try
        {
            writer.WriteAsync(item, ct).AsTask().GetAwaiter().GetResult();
            return Result.Success();
        }
        catch (ChannelClosedException)
        {
            return Result.Failure("Input pipe is closed");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return Result.Failure("Live session is released");
        }
    }
}
