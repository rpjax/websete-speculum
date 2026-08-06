using Aidan.Core.Patterns;
using Microsoft.Extensions.Logging;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Maintenance.Requests;
using Speculum.Api.Maintenance.Responses;
using Speculum.Api.Maintenance.Services.Contracts;
using Speculum.Api.Profiles.Retention;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Maintenance.Services;

/// <summary>
/// See <see cref="IMaintenanceService"/> — this is the ONLY place that may delete a
/// session row or a Journal fact. Presentation endpoints and every other service call
/// into this type; none of them touch <see cref="ISessionRepository.DeleteAsync"/> or
/// <c>IJournalRepository</c>'s delete methods directly.
/// </summary>
public sealed class MaintenanceService : IMaintenanceService
{
    private readonly SpeculumDbContext _db;
    private readonly ISessionRepository _sessions;
    private readonly IJournalRepository _journal;
    private readonly IProfileRepository _profiles;
    private readonly ILogger<MaintenanceService> _logger;

    public MaintenanceService(
        SpeculumDbContext db,
        ISessionRepository sessions,
        IJournalRepository journal,
        IProfileRepository profiles,
        ILogger<MaintenanceService> logger)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
        _sessions = sessions ?? throw new ArgumentNullException(nameof(sessions));
        _journal = journal ?? throw new ArgumentNullException(nameof(journal));
        _profiles = profiles ?? throw new ArgumentNullException(nameof(profiles));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IResult<MaintenanceSummary>> GetSummaryAsync(CancellationToken ct = default)
    {
        var endedSessionIds = await _sessions
            .ListEndedSessionIdsAsync(endedBefore: null, take: int.MaxValue, ct)
            .ConfigureAwait(false);
        var independentFacts = await _journal
            .CountIndependentFactsAsync(type: null, olderThan: null, ct)
            .ConfigureAwait(false);
        var live = await _sessions.ListLiveProfileIdsAsync(ct).ConfigureAwait(false);

        // Rough signal for the summary card — profiles idle at least a day. The actual
        // cutoff used to delete is whatever the caller passes to DeleteInactiveProfilesAsync.
        var idleCandidates = await _profiles.ListExpiredInactiveAsync(
                DateTimeOffset.UtcNow - TimeSpan.FromDays(1),
                take: 10_000,
                excludeLiveProfileIds: live,
                ct)
            .ConfigureAwait(false);

        return Result<MaintenanceSummary>.Success(new MaintenanceSummary
        {
            EndedSessionsCount = endedSessionIds.Count,
            IndependentJournalFactsCount = independentFacts,
            InactiveProfilesCount = idleCandidates.Count,
        });
    }

    public async Task<IResult<MaintenanceDeletionResult>> DeleteSessionAsync(
        Guid sessionId,
        CancellationToken ct = default)
    {
        var session = await _sessions.LoadAsync(sessionId, ct).ConfigureAwait(false);
        if (session is null)
        {
            return Result<MaintenanceDeletionResult>.Failure("Session not found");
        }

        if (session.State == LifecycleState.Live)
        {
            return Result<MaintenanceDeletionResult>.Failure(
                "Session is live; stop it before deleting");
        }

        int factsDeleted;
        bool sessionDeleted;
        await using (var tx = await _db.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
        {
            // Session-associated facts ALWAYS go with the session — this is the only place
            // DeleteByIndexKeyAsync (which can remove session-scoped facts) may be called.
            factsDeleted = await _journal
                .DeleteByIndexKeyAsync("session", sessionId.ToString(), ct)
                .ConfigureAwait(false);
            sessionDeleted = await _sessions.DeleteAsync(sessionId, ct).ConfigureAwait(false);
            await tx.CommitAsync(ct).ConfigureAwait(false);
        }

        _logger.LogInformation(
            "Maintenance deleted session {SessionId} ({FactCount} Journal fact(s) cascaded).",
            sessionId,
            factsDeleted);

        return Result<MaintenanceDeletionResult>.Success(new MaintenanceDeletionResult
        {
            SessionsDeleted = sessionDeleted ? 1 : 0,
            JournalFactsDeleted = factsDeleted,
        });
    }

    public async Task<IResult<MaintenanceDeletionResult>> DeleteEndedSessionsAsync(
        DeleteEndedSessions request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var take = request.Take > 0 ? request.Take : 100;
        var candidates = await _sessions
            .ListEndedSessionIdsAsync(request.EndedBefore, take, ct)
            .ConfigureAwait(false);

        var sessionsDeleted = 0;
        var factsDeleted = 0;
        foreach (var sessionId in candidates)
        {
            var result = await DeleteSessionAsync(sessionId, ct).ConfigureAwait(false);
            if (result.IsSuccess)
            {
                sessionsDeleted += result.Value.SessionsDeleted;
                factsDeleted += result.Value.JournalFactsDeleted;
            }
        }

        return Result<MaintenanceDeletionResult>.Success(new MaintenanceDeletionResult
        {
            SessionsDeleted = sessionsDeleted,
            JournalFactsDeleted = factsDeleted,
        });
    }

    public async Task<IResult<MaintenanceDeletionResult>> DeleteIndependentFactsAsync(
        DeleteIndependentFacts request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // DeleteIndependentFactsAsync's own query excludes anything carrying a "session"
        // index key — the rule is enforced there, not by an extra check here.
        var deleted = await _journal
            .DeleteIndependentFactsAsync(request.Type, request.OlderThan, ct)
            .ConfigureAwait(false);

        return Result<MaintenanceDeletionResult>.Success(new MaintenanceDeletionResult
        {
            JournalFactsDeleted = deleted,
        });
    }

    public async Task<IResult<MaintenanceDeletionResult>> DeleteInactiveProfilesAsync(
        DeleteInactiveProfiles request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var take = request.Take > 0 ? request.Take : 100;
        var live = await _sessions.ListLiveProfileIdsAsync(ct).ConfigureAwait(false);
        var candidates = await _profiles
            .ListExpiredInactiveAsync(request.OlderThan, take, live, ct)
            .ConfigureAwait(false);

        var deleted = 0;
        foreach (var profileId in candidates)
        {
            if (await RetentionPurgeExecutor
                    .TryDeleteInactiveProfileAsync(_db, profileId, ct)
                    .ConfigureAwait(false))
            {
                deleted++;
            }
        }

        return Result<MaintenanceDeletionResult>.Success(new MaintenanceDeletionResult
        {
            ProfilesDeleted = deleted,
        });
    }
}
