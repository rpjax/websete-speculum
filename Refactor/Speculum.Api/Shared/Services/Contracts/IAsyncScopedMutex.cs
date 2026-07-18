namespace Speculum.Api.Shared.Services.Contracts;

/// <summary>
/// Async keyed lock. Prefer <see cref="IScopedMutex"/> for short critical sections.
/// Use this when waiting for the lock itself must not block a thread.
/// </summary>
public interface IAsyncScopedMutex
{
    /// <summary>
    /// Acquires the lock for <paramref name="id"/>.
    /// Dispose the returned lease (<c>await using</c>) to release.
    /// </summary>
    Task<IAsyncDisposable> AcquireAsync(Guid id, CancellationToken ct = default);
}
