namespace Speculum.SessionsAssert.Tests;

/// <summary>
/// Shared assert stack endpoints. Defaults match
/// <c>Refactor/deploy/compose/docker-compose.sessions-assert.yml</c>.
/// </summary>
public sealed class SessionsAssertHost
{
    public string ApiBase { get; }

    public SessionsAssertHost()
    {
        ApiBase = (Environment.GetEnvironmentVariable("SESSIONS_ASSERT_API_BASE")
            ?? "http://127.0.0.1:18090").TrimEnd('/');
    }
}
