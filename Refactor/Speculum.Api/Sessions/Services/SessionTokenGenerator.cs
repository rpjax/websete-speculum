namespace Speculum.Api.Sessions.Services;

public sealed class SessionTokenGenerator : ISessionTokenGenerator
{
    public string GetRandom() => Guid.NewGuid().ToString("N");
}
