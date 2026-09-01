using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class SessionCollector : ISessionCollector, IDisposable
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, Entry> _entries = new();
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ISessionEventsFactory _events;
    private readonly IConfigurationService _configuration;
    private readonly ILogger<SessionCollector> _logger;

    public SessionCollector(
        IServiceScopeFactory scopeFactory,
        ISessionEventsFactory events,
        IConfigurationService configuration,
        ILogger<SessionCollector> logger)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    private TimeSpan DetachedTimeout
    {
        get
        {
            var timeout = _configuration.GetCurrent().Sessions.DetachedSessionTimeout;
            if (timeout <= TimeSpan.Zero)
            {
                throw new InvalidOperationException(
                    "Sessions.DetachedSessionTimeout must be greater than zero.");
            }

            return timeout;
        }
    }

    public void Watch(Guid sessionId)
    {
        lock (_gate)
        {
            if (!_entries.TryGetValue(sessionId, out var entry))
            {
                entry = new Entry();
                _entries[sessionId] = entry;
            }

            entry.RefCount = 0;
            ArmTimer(sessionId, entry);
        }
    }

    public void AddRef(Guid sessionId)
    {
        lock (_gate)
        {
            if (!_entries.TryGetValue(sessionId, out var entry))
            {
                return;
            }

            entry.RefCount++;
            if (entry.RefCount == 1)
            {
                DisarmTimer(entry);
            }
        }
    }

    public void Release(Guid sessionId)
    {
        lock (_gate)
        {
            if (!_entries.TryGetValue(sessionId, out var entry))
            {
                return;
            }

            if (entry.RefCount > 0)
            {
                entry.RefCount--;
            }

            if (entry.RefCount == 0)
            {
                ArmTimer(sessionId, entry);
            }
        }
    }

    public void Unwatch(Guid sessionId)
    {
        lock (_gate)
        {
            if (_entries.Remove(sessionId, out var entry))
            {
                DisarmTimer(entry);
            }
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            foreach (var entry in _entries.Values)
            {
                DisarmTimer(entry);
            }

            _entries.Clear();
        }
    }

    private void ArmTimer(Guid sessionId, Entry entry)
    {
        DisarmTimer(entry);
        Timer? timer = null;
        timer = new Timer(
            _ =>
            {
                if (!TryClaimTimedOut(sessionId, timer))
                {
                    return;
                }

                _ = OnTimedOutAsync(sessionId);
            },
            null,
            DetachedTimeout,
            Timeout.InfiniteTimeSpan);
        entry.Timer = timer;
    }

    private bool TryClaimTimedOut(Guid sessionId, Timer? timer)
    {
        lock (_gate)
        {
            if (!_entries.TryGetValue(sessionId, out var entry)
                || entry.RefCount != 0
                || !ReferenceEquals(entry.Timer, timer))
            {
                return false;
            }

            entry.Timer = null;
            return true;
        }
    }

    private static void DisarmTimer(Entry entry)
    {
        entry.Timer?.Dispose();
        entry.Timer = null;
    }

    private async Task OnTimedOutAsync(Guid sessionId)
    {
        try
        {
            // Timer may have claimed while RefCount was still 0; AddRef can win the race
            // before/during the awaits below. Re-check attachment before any side effect.
            if (!IsDetached(sessionId))
            {
                return;
            }

            using var scope = _scopeFactory.CreateScope();
            var repository = scope.ServiceProvider.GetRequiredService<ISessionRepository>();
            var session = await repository.LoadAsync(sessionId).ConfigureAwait(false);
            if (session is null
                || session.State is LifecycleState.Stopped or LifecycleState.Aborted)
            {
                Unwatch(sessionId);
                return;
            }

            if (!IsDetached(sessionId))
            {
                return;
            }

            if (session.State == LifecycleState.Live)
            {
                _events.ForSessionLifecycle(session).TimedOut(StopReason.TimedOut);
            }

            var sessions = scope.ServiceProvider.GetRequiredService<ISessionService>();
            var stop = await sessions.StopSessionAsync(new StopSession
                {
                    SessionId = sessionId,
                    Reason = StopReason.TimedOut,
                })
                .ConfigureAwait(false);
            if (stop.IsFailure)
            {
                ReArmIfStillDetached(sessionId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Detached session {SessionId} timed out but stop failed.", sessionId);
            ReArmIfStillDetached(sessionId);
        }
    }

    private bool IsDetached(Guid sessionId)
    {
        lock (_gate)
        {
            return _entries.TryGetValue(sessionId, out var entry) && entry.RefCount == 0;
        }
    }

    private void ReArmIfStillDetached(Guid sessionId)
    {
        lock (_gate)
        {
            if (!_entries.TryGetValue(sessionId, out var entry)
                || entry.RefCount != 0
                || entry.Timer is not null)
            {
                return;
            }

            ArmTimer(sessionId, entry);
        }
    }

    private sealed class Entry
    {
        public int RefCount;
        public Timer? Timer;
    }
}
