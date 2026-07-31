using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Auth.Services.Contracts;

namespace Speculum.Api.Presentation.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var g = endpoints.MapGroup("/api/auth").WithTags("Auth");

        g.MapPost("/login", async (
            LoginRequest body,
            IAuthService auth,
            CancellationToken ct) =>
        {
            var result = await auth.LoginAsync(body.Username ?? "", body.Password ?? "", ct)
                .ConfigureAwait(false);
            if (result.IsFailure)
            {
                return Results.Json(
                    new { error = result.Errors.FirstOrDefault() ?? "login_failed" },
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            return Results.Ok(ToResponse(result.Value));
        });

        g.MapPost("/refresh", async (
            RefreshRequest body,
            IAuthService auth,
            CancellationToken ct) =>
        {
            var result = await auth.RefreshAsync(body.RefreshToken ?? "", ct).ConfigureAwait(false);
            if (result.IsFailure)
            {
                return Results.Json(
                    new { error = result.Errors.FirstOrDefault() ?? "refresh_failed" },
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            return Results.Ok(ToResponse(result.Value));
        });

        g.MapPost("/change-password", async (
            HttpContext http,
            ChangePasswordRequest body,
            IAuthService auth,
            CancellationToken ct) =>
        {
            if (http.Items[ApiAuthMiddleware.OperatorItemKey] is not AuthenticatedOperator op)
            {
                return Results.Json(
                    new { error = "authorization_required" },
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            var result = await auth.ChangePasswordAsync(
                    op.UserId,
                    body.CurrentPassword ?? "",
                    body.NewPassword ?? "",
                    ct)
                .ConfigureAwait(false);
            if (result.IsFailure)
            {
                return Results.Json(
                    new { error = result.Errors.FirstOrDefault() ?? "change_password_failed" },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            return Results.Ok(new { ok = true });
        });

        return endpoints;
    }

    private static object ToResponse(AuthTokenPair pair) => new
    {
        accessToken = pair.AccessToken,
        accessExpiresAt = pair.AccessExpiresAt,
        refreshToken = pair.RefreshToken,
        refreshExpiresAt = pair.RefreshExpiresAt,
    };

    public sealed class LoginRequest
    {
        public string? Username { get; set; }
        public string? Password { get; set; }
    }

    public sealed class RefreshRequest
    {
        public string? RefreshToken { get; set; }
    }

    public sealed class ChangePasswordRequest
    {
        public string? CurrentPassword { get; set; }
        public string? NewPassword { get; set; }
    }
}
