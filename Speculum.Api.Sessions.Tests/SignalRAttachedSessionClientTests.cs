using Speculum.Api.Presentation.Sessions;
using Speculum.Api.Presentation.Sessions.Dtos;

namespace Speculum.Api.Sessions.Tests;

public sealed class SignalRAttachedSessionClientTests
{
    [Fact]
    public async Task SyncUrlAsync_TrimsAndForwardsAbsoluteHttpUrl()
    {
        var hub = new FakeHubClient();
        var client = new SignalRAttachedSessionClient(hub);

        await client.SyncUrlAsync("  https://example.test/path  ");

        Assert.Equal("https://example.test/path", hub.LastSyncUrl);
    }

    [Fact]
    public async Task RedirectAsync_RejectsNonHttpUrl()
    {
        var hub = new FakeHubClient();
        var client = new SignalRAttachedSessionClient(hub);

        await Assert.ThrowsAsync<ArgumentException>(
            () => client.RedirectAsync("javascript:alert(1)"));
        Assert.Null(hub.LastRedirectUrl);
    }

    [Fact]
    public async Task SyncUrlAsync_RejectsEmpty()
    {
        var client = new SignalRAttachedSessionClient(new FakeHubClient());
        await Assert.ThrowsAsync<ArgumentException>(() => client.SyncUrlAsync("  "));
    }

    [Fact]
    public async Task SessionEndedAsync_ForwardsReasonAndCodes()
    {
        var hub = new FakeHubClient();
        var client = new SignalRAttachedSessionClient(hub);
        var sessionId = Guid.Parse("86bccf30-7106-4031-b4d0-bed54917e031");

        await client.SessionEndedAsync(sessionId, "Faulted", "browser_crashed", "gone");

        Assert.NotNull(hub.LastSessionEnded);
        Assert.Equal(sessionId, hub.LastSessionEnded.SessionId);
        Assert.Equal("Faulted", hub.LastSessionEnded.Reason);
        Assert.Equal("browser_crashed", hub.LastSessionEnded.ErrorCode);
        Assert.Equal("gone", hub.LastSessionEnded.Message);
    }

    private sealed class FakeHubClient : ISessionHubClient
    {
        public string? LastSyncUrl { get; private set; }
        public string? LastRedirectUrl { get; private set; }
        public SessionEndedHubEvent? LastSessionEnded { get; private set; }

        public Task SyncUrl(SyncUrlHubEvent message)
        {
            LastSyncUrl = message.Url;
            return Task.CompletedTask;
        }

        public Task Redirect(RedirectHubEvent message)
        {
            LastRedirectUrl = message.Url;
            return Task.CompletedTask;
        }

        public Task EditableFocusChanged(EditableFocusChangedHubEvent message)
            => Task.CompletedTask;

        public Task SessionEnded(SessionEndedHubEvent message)
        {
            LastSessionEnded = message;
            return Task.CompletedTask;
        }
    }
}
