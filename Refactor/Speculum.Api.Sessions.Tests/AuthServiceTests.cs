using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Auth;
using Speculum.Api.Auth.Services;
using Speculum.Api.Auth.Services.Contracts;
using Speculum.Api.Database;

namespace Speculum.Api.Sessions.Tests;

public sealed class AuthServiceTests
{
    [Fact]
    public async Task Login_DefaultAdmin_IssuesAccessAndRefresh()
    {
        await using var harness = await AuthHarness.CreateAsync();
        var login = await harness.Auth.LoginAsync("admin", "admin");
        Assert.True(login.IsSuccess, string.Join("; ", login.Errors));
        Assert.False(string.IsNullOrWhiteSpace(login.Value.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(login.Value.RefreshToken));

        var validated = await harness.Auth.ValidateAccessTokenAsync(login.Value.AccessToken);
        Assert.True(validated.IsSuccess);
        Assert.Equal("admin", validated.Value.Username);
    }

    [Fact]
    public async Task Refresh_RotatesAndInvalidatesOldRefresh()
    {
        await using var harness = await AuthHarness.CreateAsync();
        var login = await harness.Auth.LoginAsync("admin", "admin");
        Assert.True(login.IsSuccess);

        var refreshed = await harness.Auth.RefreshAsync(login.Value.RefreshToken);
        Assert.True(refreshed.IsSuccess, string.Join("; ", refreshed.Errors));
        Assert.NotEqual(login.Value.AccessToken, refreshed.Value.AccessToken);

        var reuse = await harness.Auth.RefreshAsync(login.Value.RefreshToken);
        Assert.True(reuse.IsFailure);
    }

    [Fact]
    public async Task ChangePassword_RevokesTokens_AndAcceptsNewPassword()
    {
        await using var harness = await AuthHarness.CreateAsync();
        var login = await harness.Auth.LoginAsync("admin", "admin");
        Assert.True(login.IsSuccess);

        var user = (await harness.Auth.ValidateAccessTokenAsync(login.Value.AccessToken)).Value;
        var changed = await harness.Auth.ChangePasswordAsync(user.UserId, "admin", "new-secret");
        Assert.True(changed.IsSuccess, string.Join("; ", changed.Errors));

        var oldAccess = await harness.Auth.ValidateAccessTokenAsync(login.Value.AccessToken);
        Assert.True(oldAccess.IsFailure);

        var relogin = await harness.Auth.LoginAsync("admin", "new-secret");
        Assert.True(relogin.IsSuccess);
    }

    [Fact]
    public void PasswordHasher_RoundTrips()
    {
        var hasher = new Pbkdf2PasswordHasher();
        var hash = hasher.Hash("s3cret");
        Assert.True(hasher.Verify("s3cret", hash));
        Assert.False(hasher.Verify("wrong", hash));
    }

    private sealed class AuthHarness : IAsyncDisposable
    {
        private readonly SqliteConnection _connection;
        private readonly ServiceProvider _services;
        private readonly IServiceScope _scope;

        private AuthHarness(SqliteConnection connection, ServiceProvider services, IServiceScope scope)
        {
            _connection = connection;
            _services = services;
            _scope = scope;
        }

        public IAuthService Auth => _scope.ServiceProvider.GetRequiredService<IAuthService>();

        public static async Task<AuthHarness> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();

            var services = new ServiceCollection();
            services.AddDbContext<SpeculumDbContext>(options => options.UseSqlite(connection));
            services.AddOperatorAuth();
            var provider = services.BuildServiceProvider();

            var scope = provider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SpeculumDbContext>();
            await db.Database.EnsureCreatedAsync();
            await scope.ServiceProvider.GetRequiredService<IAuthService>()
                .EnsureDefaultOperatorAsync();

            return new AuthHarness(connection, provider, scope);
        }

        public async ValueTask DisposeAsync()
        {
            _scope.Dispose();
            await _services.DisposeAsync();
            await _connection.DisposeAsync();
        }
    }
}