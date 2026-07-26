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

    private sealed class FakeHubClient : ISessionHubClient
    {
        public string? LastSyncUrl { get; private set; }
        public string? LastRedirectUrl { get; private set; }

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
    }
}
