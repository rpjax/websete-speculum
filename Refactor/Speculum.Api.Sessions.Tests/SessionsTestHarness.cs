using Microsoft.Extensions.Options;

namespace Speculum.Api.Sessions.Tests;

internal sealed class SessionsTestOptionsMonitor<T> : IOptionsMonitor<T>
{
    private readonly T _value;

    public SessionsTestOptionsMonitor(T value) => _value = value;

    public T CurrentValue => _value;

    public T Get(string? name) => _value;

    public IDisposable? OnChange(Action<T, string?> listener) => null;
}

internal static class SessionsTestHarness
{
    public static Configurations.Models.ResourceManagement.ResourceManagementConfiguration ResourceManagement(
        int maxConcurrentSessions = 2)
        => new()
        {
            Sessions = new Configurations.Models.ResourceManagement.SessionResourceConfiguration
            {
                MaxConcurrentSessions = maxConcurrentSessions,
            },
        };

    public static Configurations.Models.Sessions.SessionsConfiguration Sessions(
        TimeSpan? detachedTimeout = null)
        => new()
        {
            DetachedSessionTimeout = detachedTimeout ?? TimeSpan.FromMilliseconds(200),
        };
}
