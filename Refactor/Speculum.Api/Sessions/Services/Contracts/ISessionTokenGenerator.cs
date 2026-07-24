namespace Speculum.Api.Sessions.Services.Contracts;

public interface ISessionTokenGenerator
{
    string GetRandom();
}
