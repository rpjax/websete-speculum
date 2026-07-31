using System.Security.Cryptography;
using Speculum.Api.Auth.Services.Contracts;

namespace Speculum.Api.Auth.Services;

public sealed class Pbkdf2PasswordHasher : IPasswordHasher
{
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const int Iterations = 210_000;
    private static readonly HashAlgorithmName Algorithm = HashAlgorithmName.SHA256;

    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, Algorithm, KeySize);
        return $"pbkdf2${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public bool Verify(string password, string passwordHash)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);
        ArgumentException.ThrowIfNullOrEmpty(passwordHash);

        var parts = passwordHash.Split('$', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 4 || parts[0] != "pbkdf2")
            return false;

        if (!int.TryParse(parts[1], out var iterations) || iterations < 1)
            return false;

        byte[] salt;
        byte[] expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, Algorithm, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}
