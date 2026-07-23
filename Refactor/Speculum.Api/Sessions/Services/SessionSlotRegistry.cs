using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class SessionSlotRegistry : ISessionSlotRegistry
{
    private readonly object _gate = new();
    private readonly HashSet<Guid> _acquired = new();
    private readonly int _maxConcurrentSessions;

    public SessionSlotRegistry(IOptions<ResourceManagementConfiguration> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _maxConcurrentSessions = options.Value.Sessions.MaxConcurrentSessions;
        if (_maxConcurrentSessions <= 0)
        {
            throw new InvalidOperationException(
                "ResourceManagement.Sessions.MaxConcurrentSessions must be greater than zero.");
        }
    }

    public int GetAvailableSlots()
    {
        lock (_gate)
        {
            return Math.Max(0, _maxConcurrentSessions - _acquired.Count);
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

            if (_acquired.Count >= _maxConcurrentSessions)
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
