using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class SessionSlotRegistry : ISessionSlotRegistry
{
    private readonly object _gate = new();
    private readonly HashSet<Guid> _acquired = new();
    private readonly IConfigurationService _configuration;

    public SessionSlotRegistry(IConfigurationService configuration)
    {
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
    }

    private int MaxConcurrentSessions
        => Math.Max(0, _configuration.GetCurrent().ResourceManagement.Sessions.MaxConcurrentSessions);

    public int GetAvailableSlots()
    {
        lock (_gate)
        {
            return Math.Max(0, MaxConcurrentSessions - _acquired.Count);
        }
    }

    public bool IsAquired(Guid sessionId)
    {
        lock (_gate)
        {
            return _acquired.Contains(sessionId);
        }
    }

    public bool TryAquire(Guid sessionId)
    {
        lock (_gate)
        {
            if (_acquired.Contains(sessionId))
            {
                return true;
            }

            var max = MaxConcurrentSessions;
            if (max <= 0 || _acquired.Count >= max)
            {
                return false;
            }

            _acquired.Add(sessionId);
            return true;
        }
    }

    public void Release(Guid sessionId)
    {
        lock (_gate)
        {
            _acquired.Remove(sessionId);
        }
    }
}
