using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.BrowserProfiles.Aggregates;
using Speculum.Api.BrowserProfiles.Storage;
using Speculum.Api.BrowserSessions.Aggregates;
using Speculum.Api.BrowserSessions.Models;
using Speculum.Api.BrowserSessions.Storage;
using Speculum.Api.Database;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionRepositoryTests
{
    [Fact]
    public async Task SaveAndLoad_RoundTripsSession()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();

        var options = new DbContextOptionsBuilder<SpeculumDbContext>()
            .UseSqlite(connection)
            .Options;

        await using var db = new SpeculumDbContext(options);
        await db.Database.EnsureCreatedAsync();

        var repository = new EfSessionRepository(db);
        var session = Session.Create(Guid.NewGuid(), Guid.NewGuid());

        await repository.SaveAsync(session);
        var loaded = await repository.LoadAsync(session.Id);

        Assert.NotNull(loaded);
        Assert.Equal(session.Id, loaded.Id);
        Assert.Equal(session.ProfileId, loaded.ProfileId);
        Assert.Equal(LifecycleState.Live, loaded.State);
    }

    [Fact]
    public async Task Save_UpdatesExistingSessionState()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();

        var options = new DbContextOptionsBuilder<SpeculumDbContext>()
            .UseSqlite(connection)
            .Options;

        await using var db = new SpeculumDbContext(options);
        await db.Database.EnsureCreatedAsync();

        var repository = new EfSessionRepository(db);
        var session = Session.Create(Guid.NewGuid(), Guid.NewGuid());
        await repository.SaveAsync(session);

        session.MarkStopped();
        await repository.SaveAsync(session);

        var loaded = await repository.LoadAsync(session.Id);
        Assert.NotNull(loaded);
        Assert.Equal(LifecycleState.Stopped, loaded.State);
    }
}

public sealed class ProfileRepositoryTests
{
    [Fact]
    public async Task SaveAndLoad_RoundTripsProfileState()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();

        var options = new DbContextOptionsBuilder<SpeculumDbContext>()
            .UseSqlite(connection)
            .Options;

        await using var db = new SpeculumDbContext(options);
        await db.Database.EnsureCreatedAsync();

        var repository = new EfProfileRepository(db);
        var profile = Profile.Create(Guid.NewGuid());
        profile.State.Cookies.Add(new BrowserCookieState
        {
            Name = "sid",
            Value = "abc",
            Domain = "example.test",
            Path = "/",
        });

        await repository.SaveAsync(profile);
        Assert.True(await repository.ExistsAsync(profile.Id));

        var loaded = await repository.LoadAsync(profile.Id);
        Assert.NotNull(loaded);
        Assert.Single(loaded.State.Cookies);
        Assert.Equal("sid", loaded.State.Cookies[0].Name);
    }
}
