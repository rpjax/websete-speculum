namespace Speculum.Api.Shared.Services.Contracts;

/// <summary>
/// Sync keyed lock. Each <see cref="Guid"/> has an independent critical section.
/// Acquire a lease with <see cref="Acquire"/> and release it via <c>using</c>.
/// Hold only around short bookkeeping — never across I/O.
/// </summary>
public interface IScopedMutex
{
    /// <summary>
    /// Acquires the lock for <paramref name="id"/>.
    /// Dispose the returned lease (<c>using</c>) to release.
    /// </summary>
    IDisposable Acquire(Guid id, CancellationToken ct = default);
}
