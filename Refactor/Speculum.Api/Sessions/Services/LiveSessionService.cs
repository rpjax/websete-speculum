using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Microsoft.Extensions.Logging;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services;
using Speculum.Api.Telemetry.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Tracks one <see cref="LiveSession"/> context per live connection.
/// </summary>
public sealed class LiveSessionService : ILiveSessionService
{
    private readonly ConcurrentDictionary<Guid, LiveSession> _sessions = new();
    private readonly ISessionCollector _collector;
    private readonly ISessionFaultScheduler _faults;
    private readonly IUrlResolver _urls;
    private readonly IConfigurationService _configuration;
    private readonly ISessionEventsFactory _events;
    private readonly ISessionTelemetryEventsFactory _telemetry;
    private readonly IJournalCatalog _journalCatalog;
    private readonly ISharedAssetCacheL2 _sharedAssetCacheL2;
    private readonly ILoggerFactory _loggerFactory;
    /// <summary>
    /// Registry lock only. Must not be the session lifecycle gate — <c>StopSession</c>
    /// already holds that lock when it calls <see cref="Release"/>.
    /// </summary>
    private readonly ScopedMutex _registryGate = new();

    public LiveSessionService(
        ISessionCollector collector,
        ISessionFaultScheduler faults,
        IUrlResolver urls,
        IConfigurationService configuration,
        ISessionEventsFactory events,
        ISessionTelemetryEventsFactory telemetry,
        IJournalCatalog journalCatalog,
        ISharedAssetCacheL2 sharedAssetCacheL2,
        ILoggerFactory loggerFactory)
    {
        _collector = collector;
        _faults = faults;
        _urls = urls;
        _configuration = configuration;
        _events = events;
        _telemetry = telemetry;
        _journalCatalog = journalCatalog;
        _sharedAssetCacheL2 = sharedAssetCacheL2;
        _loggerFactory = loggerFactory;
    }

    public IResult<ILiveSession> Create(
        Guid sessionId,
        Guid profileId,
        ISessionConnection connection,
        string requestHost,
        bool jsBridgeEnabled)
    {
        ArgumentNullException.ThrowIfNull(connection);
        if (string.IsNullOrWhiteSpace(requestHost))
        {
            return Result<ILiveSession>.Failure("Request host is required");
        }

        if (connection.SessionId != sessionId)
        {
            return Result<ILiveSession>.Failure("Connection does not belong to this session");
        }

        if (!connection.IsOpen)
        {
            return Result<ILiveSession>.Failure("The session does not have an active connection");
        }

        using (_registryGate.Acquire(sessionId))
        {
            if (_sessions.ContainsKey(sessionId))
            {
                return Result<ILiveSession>.Failure("Live session already exists");
            }

            var options = _configuration.GetCurrent().Sessions;
            var mux = new SessionStreamMultiplexer(
                connection,
                options.InputMultiplexingPolicy,
                options.OutputMultiplexingPolicy,
                jsBridgeEnabled,
                options.MirrorMode);
            var hooks = new SessionHooks(sessionId);
            var live = new LiveSession(
                sessionId,
                profileId,
                connection,
                mux,
                hooks,
                _collector,
                _faults,
                _urls,
                requestHost,
                jsBridgeEnabled,
                options.MirrorMode,
                _events.ForSessionLive(sessionId, profileId),
                _telemetry.ForSession(sessionId, profileId),
                _journalCatalog,
                _sharedAssetCacheL2,
                _loggerFactory.CreateLogger<LiveSession>());

            if (!_sessions.TryAdd(sessionId, live))
            {
                live.Release();
                return Result<ILiveSession>.Failure("Live session already exists");
            }

            return Result<ILiveSession>.Success(live);
        }
    }

    public bool TryGet(Guid sessionId, [NotNullWhen(true)] out ILiveSession? session)
    {
        if (_sessions.TryGetValue(sessionId, out var concrete))
        {
            session = concrete;
            return true;
        }

        session = null;
        return false;
    }

    public IReadOnlyList<LiveSessionTelemetrySnapshot> ListSnapshots()
        => _sessions.Values.Select(session => session.GetTelemetrySnapshot()).ToArray();

    public void Release(Guid sessionId)
    {
        LiveSession? live;
        using (_registryGate.Acquire(sessionId))
        {
            if (!_sessions.TryRemove(sessionId, out live))
            {
                return;
            }
        }

        live.Release();
    }
}
