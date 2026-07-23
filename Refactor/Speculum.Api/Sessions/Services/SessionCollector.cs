using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class SessionCollector : ISessionCollector, IDisposable
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, Entry> _entries = new();
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ISessionEventsFactory _events;
    private readonly ILogger<SessionCollector> _logger;
    private readonly TimeSpan _detachedTimeout;

    public SessionCollector(
        IServiceScopeFactory scopeFactory,
        ISessionEventsFactory events,
        IOptions<SessionsConfiguration> options,
        ILogger<SessionCollector> logger)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));

        ArgumentNullException.ThrowIfNull(options);
        _detachedTimeout = options.Value.DetachedSessionTimeout;
        if (_detachedTimeout <= TimeSpan.Zero)
        {
            throw new InvalidOperationException(
                "Sessions.DetachedSessionTimeout must be greater than zero.");
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
        entry.Timer = new Timer(
            _ => _ = OnTimedOutAsync(sessionId),
            null,
            _detachedTimeout,
            Timeout.InfiniteTimeSpan);
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
            using var scope = _scopeFactory.CreateScope();
            var repository = scope.ServiceProvider.GetRequiredService<ISessionRepository>();
            var session = await repository.LoadAsync(sessionId).ConfigureAwait(false);
            if (session is not null)
            {
                _events.ForSessionLifecycle(session).TimedOut();
            }

            var sessions = scope.ServiceProvider.GetRequiredService<ISessionService>();
            await sessions.StopSessionAsync(new StopSession { SessionId = sessionId })
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Detached session {SessionId} timed out but stop failed.", sessionId);
        }
    }

    private sealed class Entry
    {
        public int RefCount;
        public Timer? Timer;
    }
}
