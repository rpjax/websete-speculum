using Aidan.Core.Patterns;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Events;
using Speculum.Api.Profiles.Events.Services;
using Speculum.Api.Profiles.Requests;
using Speculum.Api.Profiles.Services;
using Speculum.Api.Profiles.Storage;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Storage;

namespace Speculum.Api.Sessions.Tests;

public sealed class ProfileServiceTests
{
    [Fact]
    public async Task Ensure_WithoutId_CreatesProfileAndReturnsNewId()
    {
        await using var harness = await Harness.CreateAsync();
        var journal = harness.Journal;

        var result = await harness.Service.EnsureProfileAsync(new EnsureProfile());

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Created);
        Assert.NotEqual(Guid.Empty, result.Value.ProfileId);
        Assert.True(await harness.Profiles.ExistsAsync(result.Value.ProfileId));
        Assert.Contains(journal.Appended, e => e is ProfileCreated created
            && created.ProfileId == result.Value.ProfileId);
    }

    [Fact]
    public async Task Ensure_WithExistingId_ReusesWithoutTouchingState()
    {
        await using var harness = await Harness.CreateAsync();
        var profile = Profile.Create(Guid.NewGuid());
        profile.State.Cookies.Add(new BrowserCookieState
        {
            Name = "sid",
            Value = "keep-me",
            Domain = "example.test",
            Path = "/",
        });
        await harness.Profiles.SaveAsync(profile);

        var result = await harness.Service.EnsureProfileAsync(new EnsureProfile
        {
            ProfileId = profile.Id,
            CorrelationId = "corr-1",
        });

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Created);
        Assert.Equal(profile.Id, result.Value.ProfileId);

        var loaded = await harness.Profiles.LoadAsync(profile.Id);
        Assert.NotNull(loaded);
        Assert.Single(loaded.State.Cookies);
        Assert.Equal("keep-me", loaded.State.Cookies[0].Value);
        Assert.Contains(harness.Journal.Appended, e => e is ProfileReused reused
            && reused.ProfileId == profile.Id
            && reused.CorrelationId == "corr-1");
    }

    [Fact]
    public async Task Ensure_WithUnknownId_CreatesDifferentId()
    {
        await using var harness = await Harness.CreateAsync();
        var forged = Guid.NewGuid();

        var result = await harness.Service.EnsureProfileAsync(new EnsureProfile
        {
            ProfileId = forged,
        });

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Created);
        Assert.NotEqual(forged, result.Value.ProfileId);
        Assert.False(await harness.Profiles.ExistsAsync(forged));
        Assert.True(await harness.Profiles.ExistsAsync(result.Value.ProfileId));
    }

    [Fact]
    public async Task List_PagesAndCounts()
    {
        await using var harness = await Harness.CreateAsync();
        for (var i = 0; i < 3; i++)
            await harness.Profiles.SaveAsync(Profile.Create(Guid.NewGuid()));

        var page = await harness.Service.ListProfilesAsync(new ListProfiles
        {
            Skip = 1,
            Take = 1,
        });

        Assert.True(page.IsSuccess);
        Assert.Equal(3, page.Value.Total);
        Assert.Single(page.Value.Items);
    }

    [Fact]
    public async Task ReplaceState_WithDirtyCookies_PersistsBucket()
    {
        await using var harness = await Harness.CreateAsync();
        var profile = Profile.Create(Guid.NewGuid());
        profile.State.Cookies.Add(new BrowserCookieState
        {
            Name = "sf_marker",
            Value = "state-cookie",
            Domain = "fixture.test",
            Path = "/",
            Expires = 1_900_000_000,
            SameSite = "Lax",
        });
        await harness.Profiles.SaveAsync(profile);

        var dirty = new ProfileState();
        dirty.Cookies.Add(new BrowserCookieState
        {
            Name = "sf_marker",
            Value = "state-cookie",
            Domain = "fixture.test",
            Path = "/",
            Expires = -1,
            Secure = true,
            SameSite = "",
        });
        dirty.Cookies.Add(new BrowserCookieState
        {
            Name = "",
            Value = "drop-me",
            Domain = "fixture.test",
            Path = "/",
        });

        var result = await harness.Service.ReplaceProfileStateAsync(new ReplaceProfileState
        {
            ProfileId = profile.Id,
            State = dirty,
            CorrelationId = "e8b-unit",
        });

        Assert.True(result.IsSuccess);
        var loaded = await harness.Profiles.LoadAsync(profile.Id);
        Assert.NotNull(loaded);
        Assert.Equal(2, loaded.State.Cookies.Count);
        Assert.Equal(-1, loaded.State.Cookies[0].Expires);
        Assert.Equal("", loaded.State.Cookies[0].SameSite);
        Assert.Contains(harness.Journal.Appended, e => e is ProfileStateReplaced replaced
            && replaced.ProfileId == profile.Id
            && replaced.CookieCount == 2
            && replaced.CorrelationId == "e8b-unit");
    }

    [Fact]
    public async Task Get_ReturnsCountsAfterExport()
    {
        await using var harness = await Harness.CreateAsync();
        var profile = Profile.Create(Guid.NewGuid());
        profile.ApplySessionExport(new SessionState
        {
            Cookies =
            [
                new BrowserCookieState
                {
                    Name = "a",
                    Value = "1",
                    Domain = "example.test",
                    Path = "/",
                },
            ],
            LocalStorage =
            [
                new BrowserLocalStorageState
                {
                    Origin = "https://example.test",
                    Key = "k",
                    Value = "v",
                },
            ],
            History =
            [
                new BrowserHistoryState
                {
                    Url = "https://example.test/",
                    Title = "Example",
                },
            ],
        });
        await harness.Profiles.SaveAsync(profile);

        var detail = await harness.Service.GetProfileAsync(profile.Id);

        Assert.True(detail.IsSuccess);
        Assert.Equal(1, detail.Value.CookieCount);
        Assert.Equal(1, detail.Value.LocalStorageCount);
        Assert.Equal(0, detail.Value.IdbRecordCount);
        Assert.Equal(1, detail.Value.HistoryCount);
    }

    [Fact]
    public async Task MergeSessionExport_ExpandsRecordWithoutWipingOmittedKeys()
    {
        await using var harness = await Harness.CreateAsync();
        var profileId = Guid.NewGuid();
        var profile = Profile.Create(profileId);
        profile.ApplySessionExport(new SessionState
        {
            Cookies =
            [
                new BrowserCookieState
                {
                    Name = "a",
                    Value = "1",
                    Domain = "example.test",
                    Path = "/",
                },
            ],
            LocalStorage =
            [
                new BrowserLocalStorageState
                {
                    Origin = "https://example.test",
                    Key = "keep",
                    Value = "old",
                },
            ],
        });
        await harness.Profiles.SaveAsync(profile);

        var merged = await harness.Profiles.MergeSessionExportAsync(
            profileId,
            new SessionState
            {
                Cookies =
                [
                    new BrowserCookieState
                    {
                        Name = "b",
                        Value = "2",
                        Domain = "example.test",
                        Path = "/",
                    },
                    new BrowserCookieState
                    {
                        Name = "a",
                        Value = "updated",
                        Domain = "example.test",
                        Path = "/",
                    },
                ],
                LocalStorage =
                [
                    new BrowserLocalStorageState
                    {
                        Origin = "https://example.test",
                        Key = "new",
                        Value = "n",
                    },
                ],
            });

        Assert.True(merged);
        var loaded = await harness.Profiles.LoadAsync(profileId);
        Assert.NotNull(loaded);
        Assert.Equal(2, loaded!.State.Cookies.Count);
        Assert.Contains(loaded.State.Cookies, c => c.Name == "a" && c.Value == "updated");
        Assert.Contains(loaded.State.Cookies, c => c.Name == "b" && c.Value == "2");
        Assert.Equal(2, loaded.State.LocalStorage.Count);
        Assert.Contains(loaded.State.LocalStorage, e => e.Key == "keep" && e.Value == "old");
        Assert.Contains(loaded.State.LocalStorage, e => e.Key == "new" && e.Value == "n");
    }

    [Fact]
    public async Task Delete_RemovesProfileRow()
    {
        await using var harness = await Harness.CreateAsync();
        var profile = Profile.Create(Guid.NewGuid());
        await harness.Profiles.SaveAsync(profile);

        var deleted = await harness.Service.DeleteProfileAsync(new DeleteProfile
        {
            ProfileId = profile.Id,
            Reason = ProfileDeletionReason.UserRequested,
        });

        Assert.True(deleted.IsSuccess);
        Assert.False(await harness.Profiles.ExistsAsync(profile.Id));
        Assert.Contains(harness.Journal.Appended, e => e is ProfileDeleted d
            && d.ProfileId == profile.Id
            && d.Reason == ProfileDeletionReason.UserRequested);
    }

    [Fact]
    public async Task Delete_WithLiveSession_FailsAndKeepsProfile()
    {
        await using var harness = await Harness.CreateAsync();
        var profile = Profile.Create(Guid.NewGuid());
        await harness.Profiles.SaveAsync(profile);

        var session = Session.Create(Guid.NewGuid(), profile.Id);
        await harness.Sessions.SaveAsync(session);

        var deleted = await harness.Service.DeleteProfileAsync(new DeleteProfile
        {
            ProfileId = profile.Id,
        });

        Assert.True(deleted.IsFailure);
        Assert.True(await harness.Profiles.ExistsAsync(profile.Id));
        Assert.Contains(harness.Journal.Appended, e => e is ProfileDeleteRejectedSessionLive rejected
            && rejected.ProfileId == profile.Id);
    }

    private sealed class Harness : IAsyncDisposable
    {
        private readonly SqliteConnection _connection;

        private Harness(
            SqliteConnection connection,
            SpeculumDbContext db,
            EfProfileRepository profiles,
            EfSessionRepository sessions,
            ProfileService service,
            RecordingJournalWriter journal)
        {
            _connection = connection;
            Db = db;
            Profiles = profiles;
            Sessions = sessions;
            Service = service;
            Journal = journal;
        }

        public SpeculumDbContext Db { get; }
        public EfProfileRepository Profiles { get; }
        public EfSessionRepository Sessions { get; }
        public ProfileService Service { get; }
        public RecordingJournalWriter Journal { get; }

        public static async Task<Harness> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();

            var options = new DbContextOptionsBuilder<SpeculumDbContext>()
                .UseSqlite(connection)
                .Options;

            var db = new SpeculumDbContext(options);
            await db.Database.EnsureCreatedAsync();

            var profiles = new EfProfileRepository(db);
            var sessions = new EfSessionRepository(db);
            var journal = new RecordingJournalWriter();
            var service = new ProfileService(profiles, sessions, new ProfileEventsFactory(journal));

            return new Harness(connection, db, profiles, sessions, service, journal);
        }

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            await _connection.DisposeAsync();
        }
    }

    private sealed class RecordingJournalWriter : IJournalWriter
    {
        public List<object> Appended { get; } = [];

        public void Append<T>(T payload)
        {
            ArgumentNullException.ThrowIfNull(payload);
            Appended.Add(payload);
        }
    }
}
