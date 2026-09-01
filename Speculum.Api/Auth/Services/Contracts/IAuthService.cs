using Aidan.Core.Patterns;

namespace Speculum.Api.Auth.Services.Contracts;

public interface IAuthService
{
    Task EnsureDefaultOperatorAsync(CancellationToken ct = default);

    Task<IResult<AuthTokenPair>> LoginAsync(string username, string password, CancellationToken ct = default);

    Task<IResult<AuthTokenPair>> RefreshAsync(string refreshToken, CancellationToken ct = default);

    Task<IResult> ChangePasswordAsync(
        Guid userId,
        string currentPassword,
        string newPassword,
        CancellationToken ct = default);

    Task<IResult<AuthenticatedOperator>> ValidateAccessTokenAsync(
        string accessToken,
        CancellationToken ct = default);
}

public sealed record AuthTokenPair(
    string AccessToken,
    DateTimeOffset AccessExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshExpiresAt);

public sealed record AuthenticatedOperator(Guid UserId, string Username);
