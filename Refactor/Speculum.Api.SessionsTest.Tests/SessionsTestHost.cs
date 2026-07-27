namespace Speculum.SessionsTest.Tests;

/// <summary>
/// Shared SessionsTest stack endpoints. Defaults match
/// <c>Refactor/deploy/compose/docker-compose.sessions-test.yml</c>.
/// </summary>
public sealed class SessionsTestHost
{
    public string ApiBase { get; }

    public SessionsTestHost()
    {
        ApiBase = (Environment.GetEnvironmentVariable("SESSIONS_TEST_API_BASE")
            ?? "http://127.0.0.1:18090").TrimEnd('/');
    }
}
