using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Latest-wins resize debounce: a burst collapses to one sidecar RPC after a short delay.
/// Waiters in the same debounce window share that window's result.
/// Once flush starts, the window is released so a concurrent resize can observe
/// <c>resize_busy</c> from the command gate instead of joining the in-flight RPC.
/// Debounce is not tied to any caller's cancellation token.
/// </summary>
public sealed class SessionResizeCoalescer
{
    public static readonly TimeSpan DefaultDebounce = TimeSpan.FromMilliseconds(32);

    private readonly TimeSpan _debounce;
    private readonly object _gate = new();
    private ResizeSession? _pending;
    private TaskCompletionSource<IResult<ResizeResult>>? _window;

    public SessionResizeCoalescer(TimeSpan? debounce = null)
    {
        _debounce = debounce ?? DefaultDebounce;
    }

    public Task<IResult<ResizeResult>> SubmitAsync(
        ResizeSession request,
        Func<ResizeSession, CancellationToken, Task<IResult<ResizeResult>>> execute,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(execute);

        TaskCompletionSource<IResult<ResizeResult>> window;
        var startFlush = false;
        lock (_gate)
        {
            _pending = request;
            if (_window is null)
            {
                _window = new TaskCompletionSource<IResult<ResizeResult>>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                startFlush = true;
            }

            window = _window;
        }

        if (startFlush)
        {
            _ = FlushAfterDebounceAsync(execute);
        }

        return window.Task.WaitAsync(ct);
    }

    private async Task FlushAfterDebounceAsync(
        Func<ResizeSession, CancellationToken, Task<IResult<ResizeResult>>> execute)
    {
        await Task.Delay(_debounce, CancellationToken.None).ConfigureAwait(false);

        ResizeSession toSend;
        TaskCompletionSource<IResult<ResizeResult>> window;
        lock (_gate)
        {
            toSend = _pending
                ?? throw new InvalidOperationException("resize coalesce flush without pending request");
            _pending = null;
            window = _window
                ?? throw new InvalidOperationException("resize coalesce flush without window");
            // Release before execute so overlapping submits open a new window and can hit Busy.
            _window = null;
        }

        try
        {
            var result = await execute(toSend, CancellationToken.None).ConfigureAwait(false);
            window.TrySetResult(result);
        }
        catch (Exception ex)
        {
            window.TrySetResult(Result<ResizeResult>.Failure(ex.Message));
        }
    }
}
