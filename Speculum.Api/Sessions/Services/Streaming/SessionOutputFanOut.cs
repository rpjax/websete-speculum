using System.Collections.Concurrent;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Single-reader fan-out from <see cref="ISessionConnection"/> onto open
/// <see cref="OutputStreamRegistration"/>s of matching kind, applying output delivery policy.
/// </summary>
internal sealed class SessionOutputFanOut
{
    private readonly ISessionConnection _connection;
    private readonly ConcurrentDictionary<Guid, OutputStreamRegistration> _streams;
    private readonly OutputMultiplexingPolicy _policy;
    private readonly MirrorMode _mirrorMode;
    private readonly CancellationToken _lifetime;
    private readonly int _fanOutWriteBudgetMs;
    private readonly object _ownerGate = new();
    private readonly List<Guid> _streamOrder = [];
    private readonly Dictionary<OutputStreamKind, Guid> _exclusiveByKind = new();
    private Guid? _attachedConsumerId;
    private int _framePumpStarted;
    private int _consolePumpStarted;
    private int _notificationPumpStarted;
    private Task? _pageProjectionFramePumpTask;

    public SessionOutputFanOut(
        ISessionConnection connection,
        ConcurrentDictionary<Guid, OutputStreamRegistration> streams,
        OutputMultiplexingPolicy policy,
        MirrorMode mirrorMode,
        CancellationToken lifetime,
        int fanOutWriteBudgetMs = 15_000)
    {
        _connection = connection;
        _streams = streams;
        _policy = policy ?? new OutputMultiplexingPolicy();
        _mirrorMode = mirrorMode;
        _lifetime = lifetime;
        _fanOutWriteBudgetMs = fanOutWriteBudgetMs > 0 ? fanOutWriteBudgetMs : 15_000;
    }

    public void SetAttachedConsumer(Guid? consumerId)
    {
        lock (_ownerGate)
        {
            _attachedConsumerId = consumerId;
            if (_policy.Ownership != OutputOwnershipPolicy.FirstAttached)
            {
                return;
            }

            foreach (var kind in _exclusiveByKind.Keys.ToArray())
            {
                if (!_exclusiveByKind.TryGetValue(kind, out var owner)
                    || !_streams.TryGetValue(owner, out var reg))
                {
                    continue;
                }

                if (consumerId is null || reg.ConsumerId != consumerId)
                {
                    _exclusiveByKind.Remove(kind);
                }
            }
        }
    }

    public void OnStreamRegistered(Guid streamId)
    {
        OutputStreamKind? kind = null;
        lock (_ownerGate)
        {
            if (!_streamOrder.Contains(streamId))
                _streamOrder.Add(streamId);

            if (_streams.TryGetValue(streamId, out var registration))
            {
                kind = registration.Kind;
            }
        }

        if (kind is { } registeredKind)
        {
            EnsurePump(registeredKind);
        }
    }

    public void OnStreamUnregistered(Guid streamId)
    {
        lock (_ownerGate)
        {
            _streamOrder.Remove(streamId);
            foreach (var pair in _exclusiveByKind.ToArray())
            {
                if (pair.Value == streamId)
                {
                    _exclusiveByKind.Remove(pair.Key);
                }
            }
        }
    }

    /// <summary>
    /// Starts the outbound pump for <paramref name="kind"/> once that kind has a stream.
    /// Diff/Frame must not drain the connection before a matching stream exists (would drop
    /// frames with no client-visible recovery during start→wire dial).
    /// </summary>
    private void EnsurePump(OutputStreamKind kind)
    {
        switch (kind)
        {
            case OutputStreamKind.PageProjectionFrames
                when _mirrorMode == MirrorMode.PageProjection:
                EnsurePageProjectionFramePump();
                break;
            case OutputStreamKind.Frame
                when _mirrorMode == MirrorMode.VideoStreaming
                     && Interlocked.Exchange(ref _framePumpStarted, 1) == 0:
                _ = PumpAsync(
                    OutputStreamKind.Frame,
                    () => _connection.GetFrameReader(),
                    static (s, item) => s.Frames!.Writer.TryWrite(item),
                    static s => s.Frames!.Writer.TryComplete());
                break;
            case OutputStreamKind.Console
                when Interlocked.Exchange(ref _consolePumpStarted, 1) == 0:
                _ = PumpAsync(
                    OutputStreamKind.Console,
                    () => _connection.GetConsoleOutputReader(),
                    static (s, item) => s.Console!.Writer.TryWrite(item),
                    static s => s.Console!.Writer.TryComplete());
                break;
            case OutputStreamKind.Notification
                when Interlocked.Exchange(ref _notificationPumpStarted, 1) == 0:
                _ = PumpNotificationsAsync();
                break;
        }
    }

    private void EnsurePageProjectionFramePump()
    {
        lock (_ownerGate)
        {
            var existing = _pageProjectionFramePumpTask;
            if (existing is { IsCompleted: false })
            {
                return;
            }

            _pageProjectionFramePumpTask = PumpPageProjectionFramesAsync();
        }
    }

    private async Task PumpPageProjectionFramesAsync()
    {
        while (!_lifetime.IsCancellationRequested)
        {
            var cutForRecovery = false;
            var completeTargets = true;
            try
            {
                var opened = _connection.GetPageProjectionFrameReader();
                if (opened.IsFailure)
                {
                    completeTargets = false;
                    if (_lifetime.IsCancellationRequested)
                    {
                        return;
                    }

                    await Task.Delay(50, _lifetime).ConfigureAwait(false);
                    continue;
                }

                await foreach (var item in opened.Value.ReadAllAsync(_lifetime).ConfigureAwait(false))
                {
                    _connection.NotifyPageProjectionFrameConnectionDequeued();
                    var targets = ResolveTargets(OutputStreamKind.PageProjectionFrames).ToList();
                    if (targets.Count == 0)
                    {
                        _connection.ReportPageProjectionFrameQueueDropped(
                            "api_fanout_no_target",
                            droppedCount: 1,
                            capacity: PageProjectionFrameChannels.FanOutTargetCapacity,
                            sequence: item.Sequence,
                            generation: item.Generation,
                            plane: item.Plane,
                            operation: item.Operation,
                            lowestDroppedSequence: item.Sequence,
                            highestDroppedSequence: item.Sequence);
                        continue;
                    }

                    for (var i = 0; i < targets.Count; i++)
                    {
                        try
                        {
                            await WriteFanOutDiffAsync(targets[i], item, i, targets.Count)
                                .ConfigureAwait(false);
                        }
                        catch (ChannelClosedException)
                        {
                            var blocked = targets[i];
                            _connection.ReportPageProjectionFrameQueueDropped(
                                "api_fanout_pipe_closed",
                                droppedCount: 1,
                                capacity: PageProjectionFrameChannels.FanOutTargetCapacity,
                                sequence: item.Sequence,
                                generation: item.Generation,
                                plane: item.Plane,
                                operation: item.Operation,
                                lowestDroppedSequence: item.Sequence,
                                highestDroppedSequence: item.Sequence,
                                streamId: blocked.StreamId,
                                consumerId: blocked.ConsumerId,
                                kind: OutputStreamKindNames.ToTelemetry(blocked.Kind),
                                targetCount: targets.Count,
                                frameChannelCount: FrameChannelCountOrUnknown(blocked),
                                frameEpoch: blocked.FrameEpoch);
                            cutForRecovery = true;
                            break;
                        }
                    }

                    if (cutForRecovery)
                    {
                        break;
                    }

                    ReportConsumerPressure(draining: false);
                }
            }
            catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
            {
                break;
            }
            catch (ChannelClosedException)
            {
                break;
            }
            catch (InvalidOperationException ex) when (ex.Message == "api_fanout_backpressure")
            {
                cutForRecovery = true;
            }
            finally
            {
                if (completeTargets)
                {
                    foreach (var stream in StreamsOfKind(OutputStreamKind.PageProjectionFrames))
                    {
                        stream.PageProjectionFrames.Writer.TryComplete();
                    }
                }
            }

            if (!cutForRecovery || _lifetime.IsCancellationRequested)
            {
                break;
            }

            foreach (var stream in StreamsOfKind(OutputStreamKind.PageProjectionFrames))
            {
                stream.ReplacePageProjectionFrames();
            }

            ReportConsumerPressure(draining: true);
        }
    }

    private void ReportConsumerPressure(bool draining)
    {
        var connectionDepth = _connection.GetPageProjectionFrameConnectionQueueDepth();
        var fanOutDepth = 0;
        foreach (var stream in StreamsOfKind(OutputStreamKind.PageProjectionFrames))
        {
            var reader = stream.PageProjectionFrames.Reader;
            if (reader.CanCount)
            {
                fanOutDepth += reader.Count;
            }
        }

        var queuedFrames = (uint)(connectionDepth + fanOutDepth);
        if (queuedFrames == 0 && !draining)
        {
            return;
        }

        var oldestMs = _connection.GetPageProjectionFrameOldestQueuedMs();
        _connection.TrySendConsumerPressure(new ConsumerPressureSnapshot(
            queuedFrames,
            _connection.GetPageProjectionFrameConnectionQueuedBytes(),
            oldestMs,
            draining));
    }

    private async Task WriteFanOutDiffAsync(
        OutputStreamRegistration stream,
        PageProjectionFrame item,
        int targetIndex,
        int targetCount)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(_lifetime);
        budget.CancelAfter(_fanOutWriteBudgetMs);
        var journalEnqueue = _connection.IsPageProjectionFrameFanOutEnqueuedEnabled();
        var waitClock = journalEnqueue ? System.Diagnostics.Stopwatch.StartNew() : null;
        try
        {
            await stream.PageProjectionFrames.Writer
                .WriteAsync(item, budget.Token)
                .ConfigureAwait(false);
            if (journalEnqueue)
            {
                _connection.ReportPageProjectionFrameFanOutEnqueued(
                    item,
                    waitClock!.ElapsedMilliseconds,
                    stream.StreamId,
                    stream.ConsumerId,
                    OutputStreamKindNames.ToTelemetry(stream.Kind),
                    targetIndex,
                    targetCount,
                    FrameChannelCountOrUnknown(stream),
                    stream.FrameEpoch);
            }

            return;
        }
        catch (OperationCanceledException) when (!_lifetime.IsCancellationRequested)
        {
            ReportConsumerPressure(draining: false);
            stream.PageProjectionFrames.Writer.TryComplete(
                new InvalidOperationException("api_fanout_backpressure"));
            throw new InvalidOperationException("api_fanout_backpressure");
        }
    }

    private static int FrameChannelCountOrUnknown(OutputStreamRegistration stream)
    {
        var reader = stream.PageProjectionFrames.Reader;
        return reader.CanCount ? reader.Count : -1;
    }

    /// <summary>
    /// Broadcast: every open stream of <paramref name="kind"/>.
    /// Exclusive: one stream of that kind chosen by Ownership (FirstAttached / FirstClaim / PreemptiveClaim).
    /// </summary>
    private IEnumerable<OutputStreamRegistration> ResolveTargets(OutputStreamKind kind)
    {
        if (_policy.Delivery != OutputDeliveryPolicy.Exclusive)
        {
            return StreamsOfKind(kind);
        }

        lock (_ownerGate)
        {
            if (_policy.Ownership == OutputOwnershipPolicy.FirstAttached
                && _attachedConsumerId is Guid attached)
            {
                foreach (var streamId in _streamOrder)
                {
                    if (!_streams.TryGetValue(streamId, out var stream)
                        || stream.Kind != kind
                        || stream.ConsumerId != attached)
                    {
                        continue;
                    }

                    _exclusiveByKind[kind] = streamId;
                    return [stream];
                }

                return [];
            }

            if (_policy.Ownership == OutputOwnershipPolicy.PreemptiveClaim)
            {
                OutputStreamRegistration? last = null;
                foreach (var streamId in _streamOrder)
                {
                    if (_streams.TryGetValue(streamId, out var stream) && stream.Kind == kind)
                    {
                        last = stream;
                    }
                }

                if (last is not null)
                {
                    _exclusiveByKind[kind] = last.StreamId;
                    return [last];
                }

                return [];
            }

            // FirstClaim (default exclusive ownership): first stream of this kind wins.
            if (_exclusiveByKind.TryGetValue(kind, out var owner)
                && _streams.TryGetValue(owner, out var owned)
                && owned.Kind == kind)
            {
                return [owned];
            }

            foreach (var streamId in _streamOrder)
            {
                if (!_streams.TryGetValue(streamId, out var stream) || stream.Kind != kind)
                    continue;

                _exclusiveByKind[kind] = streamId;
                return [stream];
            }
        }

        return [];
    }

    private IEnumerable<OutputStreamRegistration> StreamsOfKind(OutputStreamKind kind)
    {
        foreach (var stream in _streams.Values)
        {
            if (stream.Kind == kind)
            {
                yield return stream;
            }
        }
    }

    private async Task PumpNotificationsAsync()
    {
        var crashSeen = false;
        try
        {
            var opened = _connection.GetNotificationReader();
            if (opened.IsFailure)
            {
                return;
            }

            await foreach (var item in opened.Value.ReadAllAsync(_lifetime).ConfigureAwait(false))
            {
                if (item.Kind == SessionNotificationKind.Crashed)
                {
                    crashSeen = true;
                }
                else if (crashSeen)
                {
                    continue;
                }

                foreach (var stream in ResolveTargets(OutputStreamKind.Notification))
                {
                    stream.Notifications!.Writer.TryWrite(item);
                }
            }
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (ChannelClosedException)
        {
        }
        finally
        {
            foreach (var stream in StreamsOfKind(OutputStreamKind.Notification))
            {
                stream.Notifications!.Writer.TryComplete();
            }
        }
    }

    private async Task PumpAsync<T>(
        OutputStreamKind kind,
        Func<IResult<ChannelReader<T>>> openReader,
        Action<OutputStreamRegistration, T> write,
        Action<OutputStreamRegistration> complete)
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
                foreach (var stream in ResolveTargets(kind))
                {
                    write(stream, item);
                }
            }
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (ChannelClosedException)
        {
        }
        finally
        {
            foreach (var stream in StreamsOfKind(kind))
            {
                complete(stream);
            }
        }
    }
}
