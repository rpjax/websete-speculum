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
    private Channel<PageProjectionDiff>? _diffs;
    private long _diffEpoch;

    private OutputStreamRegistration(
        Guid streamId,
        Guid consumerId,
        OutputStreamKind kind,
        Channel<Frame>? frames,
        Channel<PageProjectionDiff>? diffs,
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

    public Channel<PageProjectionDiff> PageProjectionDiffs
    {
        get
        {
            lock (_diffGate)
            {
                return _diffs
                    ?? throw new InvalidOperationException("Stream is not a PageProjectionDiff stream");
            }
        }
    }

    public long DiffEpoch
    {
        get
        {
            lock (_diffGate)
            {
                return _diffEpoch;
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

    public static OutputStreamRegistration CreatePageProjectionDiff(Guid streamId, Guid consumerId)
        => new(
            streamId,
            consumerId,
            OutputStreamKind.PageProjectionDiff,
            frames: null,
            SequencedDiffChannels.CreateForFanOutTarget<PageProjectionDiff>(
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

    public ChannelReader<PageProjectionDiff> ReplacePageProjectionDiffs()
    {
        lock (_diffGate)
        {
            if (_diffs is null)
            {
                throw new InvalidOperationException("Stream is not a PageProjectionDiff stream");
            }

            _diffs.Writer.TryComplete();
            _diffs = SequencedDiffChannels.CreateForFanOutTarget<PageProjectionDiff>(
                SequencedDiffChannels.FanOutTargetCapacity);
            _diffEpoch++;
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
