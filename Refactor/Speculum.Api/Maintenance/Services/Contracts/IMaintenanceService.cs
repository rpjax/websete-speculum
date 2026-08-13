using Aidan.Core.Patterns;
using Speculum.Api.Maintenance.Requests;
using Speculum.Api.Maintenance.Responses;

namespace Speculum.Api.Maintenance.Services.Contracts;

/// <summary>
/// Single application-layer choke point for every destructive cleanup operation across
/// Sessions, Profiles, and Journal facts. The deletion rules live ONLY here:
/// <list type="bullet">
/// <item>Deleting a session always cascades all of its Journal facts, in one transaction.</item>
/// <item>Facts associated with a session can never be deleted independently of that session.</item>
/// <item>Every other (non-session-associated) fact can be deleted independently.</item>
/// </list>
/// No other service or endpoint may delete a session row or a Journal fact — that guarantee
/// only holds if every deletion path funnels through this interface.
/// </summary>
public interface IMaintenanceService
{
    /// <summary>Cleanup-candidate counts, for the front-end Maintenance page to show before acting.</summary>
    Task<IResult<MaintenanceSummary>> GetSummaryAsync(CancellationToken ct = default);

    /// <summary>
    /// Deletes one durable session row and ALL of its Journal facts, in one transaction.
    /// Fails when the session is currently Live — stop it first.
    /// </summary>
    Task<IResult<MaintenanceDeletionResult>> DeleteSessionAsync(
        Guid sessionId,
        CancellationToken ct = default);

    /// <summary>
    /// Bulk-deletes ended (Stopped/Aborted) sessions matching the filter, cascading each
    /// one's Journal facts. Never touches a Live session.
    /// </summary>
    Task<IResult<MaintenanceDeletionResult>> DeleteEndedSessionsAsync(
        DeleteEndedSessions request,
        CancellationToken ct = default);

    /// <summary>
    /// Deletes Journal facts that carry no <c>session</c> index key. Structurally cannot
    /// remove a session-associated fact — that exclusion is baked into the underlying query.
    /// </summary>
    Task<IResult<MaintenanceDeletionResult>> DeleteIndependentFactsAsync(
        DeleteIndependentFacts request,
        CancellationToken ct = default);

    /// <summary>Manual trigger of the same inactive-profile sweep the retention background job runs.</summary>
    Task<IResult<MaintenanceDeletionResult>> DeleteInactiveProfilesAsync(
        DeleteInactiveProfiles request,
        CancellationToken ct = default);

    /// <summary>
    /// Lab wipe: refuse if any Live session exists; otherwise delete ended sessions (+ journal cascade),
    /// remaining journal rows, inactive profiles, resource signals/reports, then VACUUM.
    /// Does not touch config_sections or auth tables. Requires <c>confirm=RESET</c>.
    /// </summary>
    Task<IResult<MaintenanceDeletionResult>> LabResetAsync(
        LabResetRequest request,
        CancellationToken ct = default);

    /// <summary>
    /// Stops every Live session (ForceStop). Does not delete durable rows — use delete-ended / lab-reset after.
    /// </summary>
    Task<IResult<MaintenanceDeletionResult>> StopLiveSessionsAsync(CancellationToken ct = default);

    /// <summary>
    /// Stops one Live session (ForceStop) when present. Idempotent for already-ended sessions.
    /// </summary>
    Task<IResult<MaintenanceDeletionResult>> StopLiveSessionAsync(
        Guid sessionId,
        CancellationToken ct = default);
}
