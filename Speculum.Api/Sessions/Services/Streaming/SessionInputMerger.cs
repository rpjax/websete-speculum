using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Merges inbound consumer pumps into a single connection consume path,
/// applying <see cref="InputMultiplexingPolicy"/> (Access / Ownership / Scheduling).
/// </summary>
internal sealed class SessionInputMerger
{
    private readonly ISessionConnection _connection;
    private readonly InputMultiplexingPolicy _policy;
    private readonly bool _jsBridgeEnabled;
    private readonly Func<Guid, bool> _isConsumerAttached;
    private readonly object _ownershipGate = new();

    private readonly Channel<VideoStreamingInput> _videoStreamingInputMerge = DropOldestChannels.Create<VideoStreamingInput>(
        SessionInputPipe.DefaultCapacity);

    private readonly Channel<ConsoleInput> _consoleInputMerge = Channel.CreateUnbounded<ConsoleInput>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    private int _userInputDrainStarted;
    private int _consoleInputDrainStarted;
    private Guid? _userInputOwner;
    private Guid? _consoleInputOwner;

    public SessionInputMerger(
        ISessionConnection connection,
        InputMultiplexingPolicy policy,
        bool jsBridgeEnabled,
        Func<Guid, bool> isConsumerAttached)
    {
        _connection = connection;
        _policy = policy ?? new InputMultiplexingPolicy();
        _jsBridgeEnabled = jsBridgeEnabled;
        _isConsumerAttached = isConsumerAttached;
    }

    public IResult<Task> StartVideoStreamingInputPump(
        Guid consumerId,
        ChannelReader<VideoStreamingInput> channelReader,
        CancellationToken ct)
    {
        if (!_isConsumerAttached(consumerId))
        {
            return Result<Task>.Failure("Consumer is closed");
        }

        if (RequiresExclusiveOwnership()
            && !TryClaimOwnership(ref _userInputOwner, consumerId))
        {
            return Result<Task>.Failure("Input owned by another consumer");
        }

        EnsureVideoStreamingInputDrainStarted();
        return Result<Task>.Success(PumpIntoAsync(channelReader, _videoStreamingInputMerge.Writer, ct));
    }

    public IResult<Task> StartConsoleInputPump(
        Guid consumerId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct)
    {
        if (!_jsBridgeEnabled)
        {
            return Result<Task>.Failure("JsBridge is disabled");
        }

        if (!_isConsumerAttached(consumerId))
        {
            return Result<Task>.Failure("Consumer is closed");
        }

        if (RequiresExclusiveOwnership()
            && !TryClaimOwnership(ref _consoleInputOwner, consumerId))
        {
            return Result<Task>.Failure("Input owned by another consumer");
        }

        EnsureConsoleInputDrainStarted();
        return Result<Task>.Success(PumpIntoAsync(channelReader, _consoleInputMerge.Writer, ct));
    }

    public void ReleaseOwnership(Guid consumerId)
    {
        if (!RequiresExclusiveOwnership())
        {
            return;
        }

        lock (_ownershipGate)
        {
            if (_userInputOwner == consumerId)
            {
                _userInputOwner = null;
            }

            if (_consoleInputOwner == consumerId)
            {
                _consoleInputOwner = null;
            }
        }
    }

    public void Complete()
    {
        _videoStreamingInputMerge.Writer.TryComplete();
        _consoleInputMerge.Writer.TryComplete();
    }

    /// <summary>
    /// Exclusive access uses ownership. Shared ignores Ownership/Scheduling for claim
    /// (merge channel is arrival-order). True RoundRobin Shared scheduling is deferred to 1.1.
    /// </summary>
    private bool RequiresExclusiveOwnership()
        => _policy.Access == InputAccessPolicy.Exclusive;

    private bool TryClaimOwnership(ref Guid? ownerSlot, Guid consumerId)
    {
        lock (_ownershipGate)
        {
            if (ownerSlot is null)
            {
                ownerSlot = consumerId;
                return true;
            }

            if (ownerSlot == consumerId)
            {
                return true;
            }

            // FirstAttached / FirstClaim: first owner wins.
            // PreemptiveClaim: new consumer steals ownership.
            if (_policy.Ownership == InputOwnershipPolicy.PreemptiveClaim)
            {
                ownerSlot = consumerId;
                return true;
            }

            return false;
        }
    }

    private void EnsureVideoStreamingInputDrainStarted()
    {
        if (Interlocked.Exchange(ref _userInputDrainStarted, 1) != 0)
        {
            return;
        }

        // Scheduling.ArrivalOrder = natural channel write order.
        // Scheduling.RoundRobin with Shared still drains one merge channel (arrival order) — 1.1.
        // Exclusive ownership already serializes a single owner consumer.
        _ = _policy.Scheduling;

        var start = _connection.ConsumeVideoStreamingInputAsync(_videoStreamingInputMerge.Reader);
        if (start.IsFailure)
        {
            Interlocked.Exchange(ref _userInputDrainStarted, 0);
            _videoStreamingInputMerge.Writer.TryComplete();
            return;
        }

        _ = ObserveDrainAsync(start.Value);
    }

    private void EnsureConsoleInputDrainStarted()
    {
        if (Interlocked.Exchange(ref _consoleInputDrainStarted, 1) != 0)
        {
            return;
        }

        _ = _policy.Scheduling;

        var start = _connection.ConsumeConsoleInputAsync(_consoleInputMerge.Reader);
        if (start.IsFailure)
        {
            Interlocked.Exchange(ref _consoleInputDrainStarted, 0);
            _consoleInputMerge.Writer.TryComplete();
            return;
        }

        _ = ObserveDrainAsync(start.Value);
    }

    private static async Task PumpIntoAsync<T>(
        ChannelReader<T> source,
        ChannelWriter<T> destination,
        CancellationToken ct)
    {
        try
        {
            await foreach (var item in source.ReadAllAsync(ct).ConfigureAwait(false))
            {
                await destination.WriteAsync(item, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
        catch (ChannelClosedException)
        {
        }
    }

    private static async Task ObserveDrainAsync(Task drain)
    {
        try
        {
            await drain.ConfigureAwait(false);
        }
        catch
        {
            // Connection/input faults are owned by the connection layer.
        }
    }
}
