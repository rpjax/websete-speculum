using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services.Contracts;

/// <summary>
/// Journal-local operational health (not Diagnostics capability taxonomy).
/// </summary>
/// <remarks>
/// Degraded is the OR of two independent factors:
/// <list type="bullet">
/// <item><description>Persist Degraded — sticky until <see cref="NoteSuccess"/> × N or <see cref="Recover"/>.</description></item>
/// <item><description>Queue pressure — set by HardQueueDepth; cleared when depth falls (no successful persist required).</description></item>
/// </list>
/// </remarks>
public interface IJournalHealth
{
    JournalHealthState State { get; }

    string? LastError { get; }

    /// <summary>True when HardQueueDepth pressure is active.</summary>
    bool IsQueuePressureActive { get; }

    /// <summary>True when persist failures (or Guaranteed admission failures) keep Journal Degraded.</summary>
    bool IsPersistDegraded { get; }

    /// <summary>True while the drain worker execute loop is expected to be running.</summary>
    bool IsDrainRunning { get; }

    /// <summary>
    /// True when Append may enqueue. Open until the drain has started once and then stopped
    /// (or during crash backoff / crash-budget exit).
    /// </summary>
    bool IsAdmissionOpen { get; }

    /// <summary>Set by <c>JournalWorker</c> Start/Stop (and crash backoff / budget exit).</summary>
    void SetDrainRunning(bool running);

    void MarkDegraded(Exception exception);

    void MarkDegraded(string reason);

    /// <summary>Raises queue-pressure Degraded (HardQueueDepth rising edge).</summary>
    void MarkQueuePressure(string reason);

    /// <summary>Clears queue-pressure Degraded when depth falls below the clear threshold.</summary>
    void ClearQueuePressure();

    /// <summary>
    /// Records a successful persist batch that inserted at least one row;
    /// may auto-recover persist Degraded after consecutive successes.
    /// </summary>
    void NoteSuccess();

    /// <summary>Clears persist Degraded and queue pressure immediately (operator / tests).</summary>
    void Recover();
}
