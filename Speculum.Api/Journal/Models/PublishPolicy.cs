namespace Speculum.Api.Journal.Models;

/// <summary>
/// Internal drain contract for a fact after it has been accepted into the Journal queue.
/// </summary>
/// <remarks>
/// <para>
/// Callers never await durable I/O. They only append into the Journal admission path
/// (in-process queue). <see cref="PublishPolicy"/> tells the Journal's background
/// drain how hard it must try to persist the fact — it is not a synchronous handshake
/// with the emit site, and propagating store errors to the caller does not create a guarantee.
/// </para>
/// <para>
/// <see cref="Guaranteed"/> means: under healthy operational conditions, the Journal will
/// persist the fact at least once. It does not mean already on disk when <c>Append</c> returns,
/// nor does it survive arbitrary process death before flush.
/// </para>
/// <para>
/// This is not retention, TTL, or storage purge. Feature enable/disable is orthogonal and
/// lives on <c>IJournalCatalog</c> (per fact type). The entry does not carry capability or
/// domain taxonomy.
/// </para>
/// </remarks>
public enum PublishPolicy
{
    /// <summary>
    /// No persistence promise after enqueue.
    /// </summary>
    /// <remarks>
    /// The drain may buffer further, delay, sample, throttle, or drop under pressure.
    /// If the process dies with the fact still uncommitted, loss is acceptable —
    /// the system did what it could.
    /// </remarks>
    BestEffort,

    /// <summary>
    /// Journal operational promise: persist at least once while the system is healthy.
    /// </summary>
    /// <remarks>
    /// <para>
    /// After enqueue, the drain must not shed this fact merely because the runtime is
    /// Degraded or BestEffort traffic is being throttled. Prefer for Act-Assert lifecycle
    /// facts and other decisive narrative beats.
    /// </para>
    /// <para>
    /// Does not block the caller on durable write. Does not imply indefinite retention
    /// after a successful store commit. Sustained sink failure is a Journal health problem
    /// (for example entering Degraded), not the caller's responsibility to retry.
    /// </para>
    /// </remarks>
    Guaranteed,
}
