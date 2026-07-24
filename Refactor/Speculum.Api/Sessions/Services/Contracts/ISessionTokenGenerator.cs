namespace Speculum.Api.Sessions.Services;

public interface ISessionTokenGenerator
{
    string GetRandom();
}
