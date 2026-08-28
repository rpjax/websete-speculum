using System.Security.Cryptography;
using System.Text;
using Aidan.Core.Patterns;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Auth.Services.Contracts;
using Speculum.Api.Auth.Storage;
using Speculum.Api.Database;

namespace Speculum.Api.Auth.Services;

public sealed class AuthService : IAuthService
{
    public const string DefaultUsername = "admin";
    public const string DefaultPassword = "admin";
    public const string AccessKind = "access";
    public const string RefreshKind = "refresh";

    public static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(14);

    /// <summary>Dummy hash so missing-user login does not short-circuit Verify (timing).</summary>
    private static readonly string DummyPasswordHash = new Pbkdf2PasswordHasher().Hash("timing-dummy");

    private readonly SpeculumDbContext _db;
    private readonly IPasswordHasher _passwordHasher;

    public AuthService(SpeculumDbContext db, IPasswordHasher passwordHasher)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
        _passwordHasher = passwordHasher ?? throw new ArgumentNullException(nameof(passwordHasher));
    }

    public async Task EnsureDefaultOperatorAsync(CancellationToken ct = default)
    {
        var exists = await _db.OperatorUsers.AsNoTracking()
            .AnyAsync(ct)
            .ConfigureAwait(false);
        if (exists)
            return;

        var now = DateTimeOffset.UtcNow;
        _db.OperatorUsers.Add(new OperatorUserRecord
        {
            Id = Guid.NewGuid(),
            Username = DefaultUsername,
            PasswordHash = _passwordHasher.Hash(DefaultPassword),
            CreatedAt = now,
            UpdatedAt = now,
        });

        try
        {
            await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            // Concurrent first-boot seed — unique username won elsewhere.
            _db.ChangeTracker.Clear();
        }
    }

    public async Task<IResult<AuthTokenPair>> LoginAsync(
        string username,
        string password,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
        {
            return Result<AuthTokenPair>.Failure("invalid_credentials");
        }

        var user = await _db.OperatorUsers
            .FirstOrDefaultAsync(u => u.Username == username.Trim(), ct)
            .ConfigureAwait(false);

        var hash = user?.PasswordHash ?? DummyPasswordHash;
        var ok = _passwordHasher.Verify(password, hash);
        if (user is null || !ok)
        {
            return Result<AuthTokenPair>.Failure("invalid_credentials");
        }

        return await IssuePairAsync(user.Id, familyId: null, ct).ConfigureAwait(false);
    }

    public async Task<IResult<AuthTokenPair>> RefreshAsync(
        string refreshToken,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken))
        {
            return Result<AuthTokenPair>.Failure("invalid_refresh_token");
        }

        var hash = HashToken(refreshToken);
        var now = DateTimeOffset.UtcNow;

        await using var tx = await _db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);

        var existing = await _db.AuthTokens
            .FirstOrDefaultAsync(t => t.Kind == RefreshKind && t.TokenHash == hash, ct)
            .ConfigureAwait(false);

        if (existing is null)
        {
            await tx.RollbackAsync(ct).ConfigureAwait(false);
            return Result<AuthTokenPair>.Failure("invalid_refresh_token");
        }

        // Reuse of an already-rotated refresh → revoke the whole family (theft detection).
        if (existing.RevokedAt is not null)
        {
            await RevokeFamilyAsync(existing.FamilyId, now, ct).ConfigureAwait(false);
            await _db.SaveChangesAsync(ct).ConfigureAwait(false);
            await tx.CommitAsync(ct).ConfigureAwait(false);
            return Result<AuthTokenPair>.Failure("invalid_refresh_token");
        }

        if (existing.ExpiresAt <= now)
        {
            existing.RevokedAt = now;
            await _db.SaveChangesAsync(ct).ConfigureAwait(false);
            await tx.CommitAsync(ct).ConfigureAwait(false);
            return Result<AuthTokenPair>.Failure("invalid_refresh_token");
        }

        // Conditional single-winner revoke (concurrent refresh loses without family kill).
        var affected = await _db.AuthTokens
            .Where(t => t.Id == existing.Id && t.Kind == RefreshKind && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct)
            .ConfigureAwait(false);

        if (affected != 1)
        {
            await tx.RollbackAsync(ct).ConfigureAwait(false);
            return Result<AuthTokenPair>.Failure("invalid_refresh_token");
        }

        // Drop sibling access tokens; keep FamilyId stable for reuse/theft detection.
        await _db.AuthTokens
            .Where(t => t.FamilyId == existing.FamilyId
                && t.Kind == AccessKind
                && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct)
            .ConfigureAwait(false);

        var pair = await IssuePairAsync(existing.UserId, existing.FamilyId, ct).ConfigureAwait(false);
        if (pair.IsFailure)
        {
            await tx.RollbackAsync(ct).ConfigureAwait(false);
            return pair;
        }

        await tx.CommitAsync(ct).ConfigureAwait(false);
        return pair;
    }

    public async Task<IResult> ChangePasswordAsync(
        Guid userId,
        string currentPassword,
        string newPassword,
        CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(currentPassword) || string.IsNullOrEmpty(newPassword))
        {
            return Result.Failure("password_required");
        }

        if (newPassword.Length < 4)
        {
            return Result.Failure("password_too_short");
        }

        var user = await _db.OperatorUsers
            .FirstOrDefaultAsync(u => u.Id == userId, ct)
            .ConfigureAwait(false);
        if (user is null || !_passwordHasher.Verify(currentPassword, user.PasswordHash))
        {
            return Result.Failure("invalid_credentials");
        }

        var now = DateTimeOffset.UtcNow;
        await using var tx = await _db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);

        user.PasswordHash = _passwordHasher.Hash(newPassword);
        user.UpdatedAt = now;

        await _db.AuthTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct)
            .ConfigureAwait(false);

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await tx.CommitAsync(ct).ConfigureAwait(false);
        return Result.Success();
    }

    public async Task<IResult<AuthenticatedOperator>> ValidateAccessTokenAsync(
        string accessToken,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            return Result<AuthenticatedOperator>.Failure("invalid_access_token");
        }

        var hash = HashToken(accessToken);
        var now = DateTimeOffset.UtcNow;
        var token = await _db.AuthTokens.AsNoTracking()
            .FirstOrDefaultAsync(
                t => t.Kind == AccessKind && t.TokenHash == hash,
                ct)
            .ConfigureAwait(false);

        if (token is null || token.RevokedAt is not null || token.ExpiresAt <= now)
        {
            return Result<AuthenticatedOperator>.Failure("invalid_access_token");
        }

        var user = await _db.OperatorUsers.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == token.UserId, ct)
            .ConfigureAwait(false);
        if (user is null)
        {
            return Result<AuthenticatedOperator>.Failure("invalid_access_token");
        }

        return Result<AuthenticatedOperator>.Success(
            new AuthenticatedOperator(user.Id, user.Username));
    }

    private async Task RevokeFamilyAsync(Guid familyId, DateTimeOffset now, CancellationToken ct)
    {
        await _db.AuthTokens
            .Where(t => t.FamilyId == familyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct)
            .ConfigureAwait(false);
    }

    /// <param name="familyId">
    /// Null on login (new family). On refresh, pass the existing family so reuse can revoke the chain.
    /// </param>
    private async Task<IResult<AuthTokenPair>> IssuePairAsync(
        Guid userId,
        Guid? familyId,
        CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var family = familyId ?? Guid.NewGuid();
        var accessRaw = CreateToken();
        var refreshRaw = CreateToken();
        var accessExpires = now.Add(AccessTokenLifetime);
        var refreshExpires = now.Add(RefreshTokenLifetime);

        _db.AuthTokens.Add(new AuthTokenRecord
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = AccessKind,
            TokenHash = HashToken(accessRaw),
            ExpiresAt = accessExpires,
            CreatedAt = now,
            FamilyId = family,
        });
        _db.AuthTokens.Add(new AuthTokenRecord
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = RefreshKind,
            TokenHash = HashToken(refreshRaw),
            ExpiresAt = refreshExpires,
            CreatedAt = now,
            FamilyId = family,
        });
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        return Result<AuthTokenPair>.Success(
            new AuthTokenPair(accessRaw, accessExpires, refreshRaw, refreshExpires));
    }

    internal static string CreateToken()
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    internal static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
