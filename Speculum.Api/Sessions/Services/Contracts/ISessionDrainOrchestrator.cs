namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Stops live sessions and cancels in-flight starts so configuration Apply / process
/// shutdown do not leave browsers on stale Navigation/Hosting policy.
/// </summary>
public interface ISessionDrainOrchestrator
{
    /// <summary>True while a drain is in progress (blocks new starts).</summary>
    bool IsDraining { get; }

    /// <summary>
    /// Cancels starting sessions, stops live ones with <see cref="Models.StopReason.Drain"/>,
    /// then <see cref="Models.StopReason.ForceStop"/> any still live after
    /// <see cref="SessionDrainRequest.ForceAfter"/>. Ends with a final sweep. No-op when
    /// nothing is live/starting.
    /// </summary>
    Task DrainAsync(SessionDrainRequest request, CancellationToken ct = default);
}

/// <summary>Session drain request.</summary>
/// <param name="Trigger">Stable cause label (section key(s) or <c>Shutdown</c>).</param>
/// <param name="ForceAfter">
/// Soft-drain budget before ForceStop of remainders. Soft stops ignore caller cancellation
/// so export can finish; the budget wait still honors the drain <c>CancellationToken</c>.
/// </param>
public sealed record SessionDrainRequest(string Trigger, TimeSpan ForceAfter);
