using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Pipes.Streaming;

/// <summary>
/// Merges inbound pipe pumps into a single connection consume path,
/// with Shared/Exclusive access and JsBridge gating for console input.
/// </summary>
internal sealed class SessionInputMerger
{
    private readonly ISessionConnection _connection;
    private readonly InputAccessPolicy _inputAccess;
    private readonly bool _jsBridgeEnabled;
    private readonly Func<Guid, bool> _isPipeAttached;
    private readonly object _ownershipGate = new();

    private readonly Channel<string> _userInputMerge = Channel.CreateUnbounded<string>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    private readonly Channel<ConsoleInput> _consoleInputMerge = Channel.CreateUnbounded<ConsoleInput>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    private int _userInputDrainStarted;
    private int _consoleInputDrainStarted;
    private Guid? _userInputOwner;
    private Guid? _consoleInputOwner;

    public SessionInputMerger(
        ISessionConnection connection,
        InputAccessPolicy inputAccess,
        bool jsBridgeEnabled,
        Func<Guid, bool> isPipeAttached)
    {
        _connection = connection;
        _inputAccess = inputAccess;
        _jsBridgeEnabled = jsBridgeEnabled;
        _isPipeAttached = isPipeAttached;
    }

    public IResult<Task> StartUserInputPump(
        Guid pipeId,
        ChannelReader<string> channelReader,
        CancellationToken ct)
    {
        if (!_isPipeAttached(pipeId))
        {
            return Result<Task>.Failure("Pipe is closed");
        }

        if (_inputAccess == InputAccessPolicy.Exclusive
            && !TryClaimOwnership(ref _userInputOwner, pipeId))
        {
            return Result<Task>.Failure("Input owned by another pipe");
        }

        EnsureUserInputDrainStarted();
        return Result<Task>.Success(PumpIntoAsync(channelReader, _userInputMerge.Writer, ct));
    }

    public IResult<Task> StartConsoleInputPump(
        Guid pipeId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct)
    {
        if (!_jsBridgeEnabled)
        {
            return Result<Task>.Failure("JsBridge is disabled");
        }

        if (!_isPipeAttached(pipeId))
        {
            return Result<Task>.Failure("Pipe is closed");
        }

        if (_inputAccess == InputAccessPolicy.Exclusive
            && !TryClaimOwnership(ref _consoleInputOwner, pipeId))
        {
            return Result<Task>.Failure("Input owned by another pipe");
        }

        EnsureConsoleInputDrainStarted();
        return Result<Task>.Success(PumpIntoAsync(channelReader, _consoleInputMerge.Writer, ct));
    }

    public void ReleaseOwnership(Guid pipeId)
    {
        if (_inputAccess != InputAccessPolicy.Exclusive)
        {
            return;
        }

        lock (_ownershipGate)
        {
            if (_userInputOwner == pipeId)
            {
                _userInputOwner = null;
            }

            if (_consoleInputOwner == pipeId)
            {
                _consoleInputOwner = null;
            }
        }
    }

    public void Complete()
    {
        _userInputMerge.Writer.TryComplete();
        _consoleInputMerge.Writer.TryComplete();
    }

    private bool TryClaimOwnership(ref Guid? ownerSlot, Guid pipeId)
    {
        lock (_ownershipGate)
        {
            if (ownerSlot is { } owner && owner != pipeId)
            {
                return false;
            }

            ownerSlot = pipeId;
            return true;
        }
    }

    private void EnsureUserInputDrainStarted()
    {
        if (Interlocked.Exchange(ref _userInputDrainStarted, 1) != 0)
        {
            return;
        }

        var start = _connection.ConsumeUserInputAsync(_userInputMerge.Reader);
        if (start.IsFailure)
        {
            Interlocked.Exchange(ref _userInputDrainStarted, 0);
            _userInputMerge.Writer.TryComplete();
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
