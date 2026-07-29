using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.BrowserClients;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionDrainOrchestratorTests
{
    [Fact]
    public void RequiresDrain_OnlyNavigationAndHosting()
    {
        Assert.True(SessionDrainTriggers.RequiresDrain("Navigation"));
        Assert.True(SessionDrainTriggers.RequiresDrain("Hosting"));
        Assert.False(SessionDrainTriggers.RequiresDrain("ResourceManagement"));
        Assert.False(SessionDrainTriggers.RequiresDrain("Sessions"));
        Assert.False(SessionDrainTriggers.RequiresDrain("Journal"));
        Assert.False(SessionDrainTriggers.RequiresDrain("Telemetry"));
    }

    [Fact]
    public async Task DrainAsync_WhenEmpty_IsNoOp()
    {
        var journal = new RecordingJournalWriter();
        var live = new DrainFakeLiveSessions();
        var bindings = new SessionBindingRegistry(live);
        var orchestrator = CreateOrchestrator(live, bindings, journal, new RecordingSessionService());

        await orchestrator.DrainAsync(
            new SessionDrainRequest("Navigation", TimeSpan.FromSeconds(1)));

        Assert.Empty(journal.Payloads);
        Assert.False(orchestrator.IsDraining);
    }

    [Fact]
    public async Task DrainAsync_StopsLiveSessionsWithDrainReason()
    {
        var sessionId = Guid.NewGuid();
        var journal = new RecordingJournalWriter();
        var live = new DrainFakeLiveSessions();
        live.Add(sessionId);
        var bindings = new SessionBindingRegistry(live);
        var sessions = new RecordingSessionService { Live = live };
        var orchestrator = CreateOrchestrator(live, bindings, journal, sessions);

        await orchestrator.DrainAsync(
            new SessionDrainRequest("Hosting", TimeSpan.FromSeconds(5)));

        Assert.Equal([(sessionId, StopReason.Drain)], sessions.Stops);
        Assert.Contains(journal.Payloads, p => p is DrainStarted started
            && started.SessionCount == 1
            && started.Trigger == "Hosting");
        Assert.Contains(journal.Payloads, p => p is DrainCompleted completed
            && completed.ForcedCount == 0
            && completed.Trigger == "Hosting");
        Assert.False(orchestrator.IsDraining);
    }

    [Fact]
    public async Task DrainAsync_CancelsStartingSessions()
    {
        var journal = new RecordingJournalWriter();
        var live = new DrainFakeLiveSessions();
        var bindings = new SessionBindingRegistry(live);
        var start = bindings.BeginStart("caller-a", Guid.NewGuid());
        var sessions = new RecordingSessionService();
        var orchestrator = CreateOrchestrator(live, bindings, journal, sessions);

        await orchestrator.DrainAsync(
            new SessionDrainRequest("Navigation", TimeSpan.FromSeconds(1)));

        Assert.True(start.CancellationToken.IsCancellationRequested);
        Assert.Contains(journal.Payloads, p => p is DrainStarted started && started.SessionCount == 1);
        Assert.Empty(sessions.Stops);
    }

    [Fact]
    public async Task DrainAsync_FinalSweep_ForceStopsLeftoverLive()
    {
        var sessionId = Guid.NewGuid();
        var journal = new RecordingJournalWriter();
        var live = new DrainFakeLiveSessions();
        live.Add(sessionId);
        var bindings = new SessionBindingRegistry(live);
        var sessions = new RecordingSessionService
        {
            Live = live,
            LeaveLiveOnDrain = true,
        };
        var orchestrator = CreateOrchestrator(live, bindings, journal, sessions);

        await orchestrator.DrainAsync(
            new SessionDrainRequest("Navigation", TimeSpan.FromSeconds(5)));

        Assert.Contains(sessions.Stops, s => s.SessionId == sessionId && s.Reason == StopReason.Drain);
        Assert.Contains(sessions.Stops, s => s.SessionId == sessionId && s.Reason == StopReason.ForceStop);
        Assert.Contains(journal.Payloads, p => p is DrainCompleted completed && completed.ForcedCount >= 1);
        Assert.Empty(live.ListSnapshots());
    }

    [Fact]
    public async Task DrainAsync_ForceStopsWhenSoftBudgetElapses()
    {
        var sessionId = Guid.NewGuid();
        var journal = new RecordingJournalWriter();
        var live = new DrainFakeLiveSessions();
        live.Add(sessionId);
        var bindings = new SessionBindingRegistry(live);
        var sessions = new RecordingSessionService
        {
            SoftDelay = TimeSpan.FromMilliseconds(250),
            Live = live,
        };
        var orchestrator = CreateOrchestrator(live, bindings, journal, sessions);

        await orchestrator.DrainAsync(
            new SessionDrainRequest("Shutdown", TimeSpan.FromMilliseconds(30)));

        Assert.Contains(sessions.Stops, s => s.SessionId == sessionId && s.Reason == StopReason.Drain);
        Assert.Contains(sessions.Stops, s => s.SessionId == sessionId && s.Reason == StopReason.ForceStop);
        Assert.Contains(journal.Payloads, p => p is DrainCompleted completed && completed.ForcedCount >= 1);
    }

    private static SessionDrainOrchestrator CreateOrchestrator(
        ILiveSessionService live,
        ISessionBindingRegistry bindings,
        IJournalWriter journal,
        ISessionService sessions)
    {
        var services = new ServiceCollection();
        services.AddSingleton(sessions);
        var provider = services.BuildServiceProvider();
        return new SessionDrainOrchestrator(
            live,
            bindings,
            provider.GetRequiredService<IServiceScopeFactory>(),
            journal,
            NullLogger<SessionDrainOrchestrator>.Instance);
    }

    private sealed class RecordingJournalWriter : IJournalWriter
    {
        public List<object> Payloads { get; } = [];

        public void Append<T>(T payload) => Payloads.Add(payload!);
    }

    private sealed class RecordingSessionService : ISessionService
    {
        public List<(Guid SessionId, StopReason Reason)> Stops { get; } = [];
        public TimeSpan SoftDelay { get; init; }
        public bool LeaveLiveOnDrain { get; init; }
        public DrainFakeLiveSessions? Live { get; init; }

        public Task<IResult<StartSessionResponse>> StartSessionAsync(
            StartSession request,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public async Task<IResult> StopSessionAsync(StopSession request, CancellationToken ct = default)
        {
            Stops.Add((request.SessionId, request.Reason));
            if (request.Reason == StopReason.Drain
                && (SoftDelay > TimeSpan.Zero || LeaveLiveOnDrain))
            {
                if (SoftDelay > TimeSpan.Zero)
                {
                    await Task.Delay(SoftDelay, CancellationToken.None).ConfigureAwait(false);
                }

                return Result.Success();
            }

            Live?.Remove(request.SessionId);
            return Result.Success();
        }
    }

    private sealed class DrainFakeLiveSessions : ILiveSessionService
    {
        private readonly Dictionary<Guid, Guid> _sessions = new();

        public void Add(Guid sessionId) => _sessions[sessionId] = Guid.NewGuid();

        public void Remove(Guid sessionId) => _sessions.Remove(sessionId);

        public IResult<ILiveSession> Create(
            Guid sessionId,
            Guid profileId,
            ISessionConnection connection,
            string requestHost,
            bool jsBridgeEnabled)
            => throw new NotSupportedException();

        public bool TryGet(Guid sessionId, [NotNullWhen(true)] out ILiveSession? session)
        {
            session = null;
            return false;
        }

        public IReadOnlyList<LiveSessionTelemetrySnapshot> ListSnapshots()
            => _sessions
                .Select(pair => new LiveSessionTelemetrySnapshot(
                    pair.Key,
                    pair.Value,
                    false,
                    true,
                    0))
                .ToArray();

        public void Release(Guid sessionId) => _sessions.Remove(sessionId);
    }
}
