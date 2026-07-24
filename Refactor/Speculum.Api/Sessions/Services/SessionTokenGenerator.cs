using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class SessionTokenGenerator : ISessionTokenGenerator
{
    public string GetRandom() => Guid.NewGuid().ToString("N");
}
