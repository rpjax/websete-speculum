using Aidan.Core.Patterns;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Maintenance.Requests;
using Speculum.Api.Maintenance.Responses;
using Speculum.Api.Maintenance.Services.Contracts;
using Speculum.Api.Profiles.Retention;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
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
    private readonly ISessionService _sessionLifecycle;
    private readonly IJournalRepository _journal;
    private readonly IProfileRepository _profiles;
    private readonly ILogger<MaintenanceService> _logger;

    public MaintenanceService(
        SpeculumDbContext db,
        ISessionRepository sessions,
        ISessionService sessionLifecycle,
        IJournalRepository journal,
        IProfileRepository profiles,
        ILogger<MaintenanceService> logger)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
        _sessions = sessions ?? throw new ArgumentNullException(nameof(sessions));
        _sessionLifecycle = sessionLifecycle ?? throw new ArgumentNullException(nameof(sessionLifecycle));
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
        var liveSessionIds = await _sessions.ListLiveSessionIdsAsync(ct).ConfigureAwait(false);

        var idleCandidates = await _profiles.ListExpiredInactiveAsync(
                DateTimeOffset.UtcNow - TimeSpan.FromDays(1),
                take: 10_000,
                excludeLiveProfileIds: live,
                ct)
            .ConfigureAwait(false);

        return Result<MaintenanceSummary>.Success(new MaintenanceSummary
        {
            EndedSessionsCount = endedSessionIds.Count,
            LiveSessionsCount = liveSessionIds.Count,
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

    public async Task<IResult<MaintenanceDeletionResult>> LabResetAsync(
        LabResetRequest request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!string.Equals(request.Confirm?.Trim(), "RESET", StringComparison.Ordinal))
        {
            return Result<MaintenanceDeletionResult>.Failure(
                "Lab reset requires confirm token RESET");
        }

        var liveProfiles = await _sessions.ListLiveProfileIdsAsync(ct).ConfigureAwait(false);
        if (liveProfiles.Count > 0)
        {
            return Result<MaintenanceDeletionResult>.Failure(
                $"Lab reset refused: {liveProfiles.Count} live profile session(s) — stop them first");
        }

        var ended = await DeleteEndedSessionsAsync(
                new DeleteEndedSessions { EndedBefore = null, Take = int.MaxValue },
                ct)
            .ConfigureAwait(false);
        if (!ended.IsSuccess)
        {
            return ended;
        }

        var remainingFacts = await _journal.DeleteAllAsync(ct).ConfigureAwait(false);

        var profiles = await DeleteInactiveProfilesAsync(
                new DeleteInactiveProfiles
                {
                    OlderThan = DateTimeOffset.UnixEpoch,
                    Take = int.MaxValue,
                },
                ct)
            .ConfigureAwait(false);
        if (!profiles.IsSuccess)
        {
            return profiles;
        }

        var signalsDeleted = await _db.ResourceSignals.ExecuteDeleteAsync(ct).ConfigureAwait(false);
        var reportsDeleted = await _db.ResourceReports.ExecuteDeleteAsync(ct).ConfigureAwait(false);
        _db.ChangeTracker.Clear();

        await _db.Database.ExecuteSqlRawAsync("VACUUM;", ct).ConfigureAwait(false);

        _logger.LogWarning(
            "Lab reset completed: sessions={Sessions} journal={Journal} profiles={Profiles} signals={Signals} reports={Reports}",
            ended.Value.SessionsDeleted,
            ended.Value.JournalFactsDeleted + remainingFacts,
            profiles.Value.ProfilesDeleted,
            signalsDeleted,
            reportsDeleted);

        return Result<MaintenanceDeletionResult>.Success(new MaintenanceDeletionResult
        {
            SessionsDeleted = ended.Value.SessionsDeleted,
            JournalFactsDeleted = ended.Value.JournalFactsDeleted + remainingFacts,
            ProfilesDeleted = profiles.Value.ProfilesDeleted,
            ResourceSignalsDeleted = signalsDeleted,
            ResourceReportsDeleted = reportsDeleted,
            VacuumRan = true,
        });
    }

    public async Task<IResult<MaintenanceDeletionResult>> StopLiveSessionsAsync(
        CancellationToken ct = default)
    {
        var stop = await _sessionLifecycle
            .StopAllLiveSessionsAsync(StopReason.ForceStop, ct)
            .ConfigureAwait(false);
        if (stop.IsFailure)
        {
            return Result<MaintenanceDeletionResult>.Failure(stop.Errors.ToArray());
        }

        _logger.LogWarning("Maintenance stopped {Count} live session(s).", stop.Value);
        return Result<MaintenanceDeletionResult>.Success(new MaintenanceDeletionResult
        {
            SessionsStopped = stop.Value,
        });
    }

    public async Task<IResult<MaintenanceDeletionResult>> StopLiveSessionAsync(
        Guid sessionId,
        CancellationToken ct = default)
    {
        var stop = await _sessionLifecycle
            .StopSessionAsync(
                new StopSession
                {
                    SessionId = sessionId,
                    Reason = StopReason.ForceStop,
                },
                ct)
            .ConfigureAwait(false);
        if (stop.IsFailure)
        {
            return Result<MaintenanceDeletionResult>.Failure(stop.Errors.ToArray());
        }

        return Result<MaintenanceDeletionResult>.Success(new MaintenanceDeletionResult
        {
            SessionsStopped = 1,
        });
    }
}
