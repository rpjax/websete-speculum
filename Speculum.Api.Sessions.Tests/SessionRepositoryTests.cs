using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Database;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Storage;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Storage;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionRepositoryTests
{
    private static async Task<SpeculumDbContext> OpenDbAsync(SqliteConnection connection)
    {
        var options = new DbContextOptionsBuilder<SpeculumDbContext>()
            .UseSqlite(connection)
            .Options;
        var db = new SpeculumDbContext(options);
        await db.Database.EnsureCreatedAsync();
        return db;
    }

    [Fact]
    public async Task SaveAndLoad_RoundTripsMirrorModeViewportAndTimestamps()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = await OpenDbAsync(connection);

        var repository = new EfSessionRepository(db);
        var session = Session.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            mirrorMode: MirrorMode.PageProjection,
            viewportWidth: 1280,
            viewportHeight: 720);
        await repository.SaveAsync(session);

        session.MarkStopped(StopReason.UserStop);
        await repository.SaveAsync(session);

        var loaded = await repository.LoadAsync(session.Id);
        Assert.NotNull(loaded);
        Assert.Equal(MirrorMode.PageProjection, loaded.MirrorMode);
        Assert.Equal(1280, loaded.ViewportWidth);
        Assert.Equal(720, loaded.ViewportHeight);
        Assert.NotNull(loaded.EndedAt);
        Assert.Equal(StopReason.UserStop, loaded.StopReason);
    }

    [Fact]
    public async Task ListAsync_FiltersByStateAndMirrorMode()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = await OpenDbAsync(connection);

        var repository = new EfSessionRepository(db);

        var live = Session.Create(Guid.NewGuid(), Guid.NewGuid(), mirrorMode: MirrorMode.VideoStreaming);
        await repository.SaveAsync(live);

        var ended = Session.Create(Guid.NewGuid(), Guid.NewGuid(), mirrorMode: MirrorMode.PageProjection);
        ended.MarkStopped(StopReason.UserStop);
        await repository.SaveAsync(ended);

        var (liveOnly, liveTotal) = await repository.ListAsync(
            new ListSessions { State = LifecycleState.Live });
        Assert.Equal(1, liveTotal);
        Assert.Equal(live.Id, Assert.Single(liveOnly).SessionId);

        var (domOnly, domTotal) = await repository.ListAsync(
            new ListSessions { MirrorMode = MirrorMode.PageProjection });
        Assert.Equal(1, domTotal);
        Assert.Equal(ended.Id, Assert.Single(domOnly).SessionId);
    }

    [Fact]
    public async Task DeleteAsync_RemovesSessionRow()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = await OpenDbAsync(connection);

        var repository = new EfSessionRepository(db);
        var session = Session.Create(Guid.NewGuid(), Guid.NewGuid());
        await repository.SaveAsync(session);

        var deleted = await repository.DeleteAsync(session.Id);
        Assert.True(deleted);
        Assert.Null(await repository.LoadAsync(session.Id));

        var deletedAgain = await repository.DeleteAsync(session.Id);
        Assert.False(deletedAgain);
    }

    [Fact]
    public async Task ListEndedSessionIdsAsync_ExcludesLiveAndOrdersByEndedAtAscending()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = await OpenDbAsync(connection);

        var repository = new EfSessionRepository(db);

        var live = Session.Create(Guid.NewGuid(), Guid.NewGuid());
        await repository.SaveAsync(live);

        var endedEarlier = Session.Create(Guid.NewGuid(), Guid.NewGuid());
        endedEarlier.MarkStopped(StopReason.UserStop, DateTimeOffset.UtcNow.AddHours(-2));
        await repository.SaveAsync(endedEarlier);

        var endedLater = Session.Create(Guid.NewGuid(), Guid.NewGuid());
        endedLater.MarkAborted(StopReason.Faulted, DateTimeOffset.UtcNow.AddHours(-1));
        await repository.SaveAsync(endedLater);

        var ids = await repository.ListEndedSessionIdsAsync(endedBefore: null, take: 10);

        Assert.Equal(2, ids.Count);
        Assert.Equal(endedEarlier.Id, ids[0]);
        Assert.Equal(endedLater.Id, ids[1]);
        Assert.DoesNotContain(live.Id, ids);
    }
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

        session.MarkStopped(StopReason.UserStop);
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
