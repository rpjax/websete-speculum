namespace Speculum.Api.Auth.Services.Contracts;

public interface IPasswordHasher
{
    string Hash(string password);

    bool Verify(string password, string passwordHash);
}
