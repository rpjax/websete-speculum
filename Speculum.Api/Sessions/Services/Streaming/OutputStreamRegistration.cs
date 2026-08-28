using System.Threading.Channels;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// One outbound stream: a single channel of one <see cref="OutputStreamKind"/> owned by a consumer.
/// </summary>
internal sealed class OutputStreamRegistration
{
    private readonly object _diffGate = new();
    private Channel<PageProjectionFrame>? _diffs;
    private long _frameEpoch;

    private OutputStreamRegistration(
        Guid streamId,
        Guid consumerId,
        OutputStreamKind kind,
        Channel<Frame>? frames,
        Channel<PageProjectionFrame>? diffs,
        Channel<ConsoleOutput>? console,
        Channel<SessionNotification>? notifications)
    {
        StreamId = streamId;
        ConsumerId = consumerId;
        Kind = kind;
        Frames = frames;
        _diffs = diffs;
        Console = console;
        Notifications = notifications;
    }

    public Guid StreamId { get; }
    public Guid ConsumerId { get; }
    public OutputStreamKind Kind { get; }

    public Channel<Frame>? Frames { get; }
    public Channel<ConsoleOutput>? Console { get; }
    public Channel<SessionNotification>? Notifications { get; }

    public Channel<PageProjectionFrame> PageProjectionFrames
    {
        get
        {
            lock (_diffGate)
            {
                return _diffs
                    ?? throw new InvalidOperationException("Stream is not a PageProjectionFrame stream");
            }
        }
    }

    public long FrameEpoch
    {
        get
        {
            lock (_diffGate)
            {
                return _frameEpoch;
            }
        }
    }

    public static OutputStreamRegistration CreateFrame(Guid streamId, Guid consumerId)
        => new(
            streamId,
            consumerId,
            OutputStreamKind.Frame,
            DropOldestChannels.Create<Frame>(capacity: 2),
            diffs: null,
            console: null,
            notifications: null);

    public static OutputStreamRegistration CreatePageProjectionFrames(Guid streamId, Guid consumerId)
        => new(
            streamId,
            consumerId,
            OutputStreamKind.PageProjectionFrames,
            frames: null,
            SequencedDiffChannels.CreateForFanOutTarget<PageProjectionFrame>(
                SequencedDiffChannels.FanOutTargetCapacity),
            console: null,
            notifications: null);

    public static OutputStreamRegistration CreateConsole(Guid streamId, Guid consumerId)
        => new(
            streamId,
            consumerId,
            OutputStreamKind.Console,
            frames: null,
            diffs: null,
            DropOldestChannels.Create<ConsoleOutput>(capacity: 256),
            notifications: null);

    public static OutputStreamRegistration CreateNotification(Guid streamId, Guid consumerId)
        => new(
            streamId,
            consumerId,
            OutputStreamKind.Notification,
            frames: null,
            diffs: null,
            console: null,
            DropOldestChannels.Create<SessionNotification>(capacity: 512));

    public ChannelReader<PageProjectionFrame> ReplacePageProjectionFrames()
    {
        lock (_diffGate)
        {
            if (_diffs is null)
            {
                throw new InvalidOperationException("Stream is not a PageProjectionFrame stream");
            }

            _diffs.Writer.TryComplete();
            _diffs = SequencedDiffChannels.CreateForFanOutTarget<PageProjectionFrame>(
                SequencedDiffChannels.FanOutTargetCapacity);
            _frameEpoch++;
            return _diffs.Reader;
        }
    }

    public void Complete()
    {
        Frames?.Writer.TryComplete();
        lock (_diffGate)
        {
            _diffs?.Writer.TryComplete();
        }

        Console?.Writer.TryComplete();
        Notifications?.Writer.TryComplete();
    }
}
