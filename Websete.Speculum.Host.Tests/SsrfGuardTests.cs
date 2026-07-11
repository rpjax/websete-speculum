using System.Net;
using System.Net.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Scripts;
using Websete.Speculum.Host.Config.Store;
using Websete.Speculum.Host.Scripts;

namespace Websete.Speculum.Host.Tests;

public sealed class SsrfGuardTests
{
    [Theory]
    [InlineData("http://127.0.0.1/script.js")]
    [InlineData("http://10.0.0.1/script.js")]
    [InlineData("http://192.168.1.1/script.js")]
    [InlineData("http://169.254.169.254/latest/meta-data")]
    [InlineData("http://localhost/script.js")]
    [InlineData("http://[::ffff:127.0.0.1]/script.js")]
    public void IsAllowedUrl_blocks_private_and_localhost(string url)
    {
        Assert.False(SsrfGuard.IsAllowedUrl(new Uri(url)));
    }

    [Fact]
    public void IsAllowedUrl_allows_public_https()
    {
        Assert.True(SsrfGuard.IsAllowedUrl(new Uri("https://cdn.example.com/lib.js")));
    }

    [Fact]
    public async Task ValidateResolvedHostAsync_blocks_loopback_resolution()
    {
        var dns = new FakeDnsResolver(IPAddress.Loopback);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            SsrfGuard.ValidateResolvedHostAsync("evil.example.com", dns));
    }

    [Fact]
    public void IsAllowedIp_blocks_ipv4_mapped_loopback()
    {
        var mapped = IPAddress.Parse("::ffff:127.0.0.1");
        Assert.False(SsrfGuard.IsAllowedIp(mapped));
    }

    [Fact]
    public async Task ValidateResolvedHostAsync_allows_public_resolution()
    {
        var dns = new FakeDnsResolver(IPAddress.Parse("93.184.216.34"));
        await SsrfGuard.ValidateResolvedHostAsync("example.com", dns);
    }

    [Fact]
    public async Task ScriptResolver_rejects_redirect_without_following()
    {
        var handler = new RedirectStubHandler();
        var factory = new NamedHttpClientFactory(handler);
        var store   = new InMemoryScriptStore();
        var resolver = new ScriptResolver(factory, store, NullLogger<ScriptResolver>.Instance);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            resolver.ResolveAsync(
                [new ScriptInjectionEntry { Position = "HeaderBottom", Type = "Classic", Url = "https://cdn.example.com/a.js" }]));

        Assert.Contains("Redirects are not allowed", ex.Message);
    }

    private sealed class FakeDnsResolver : IDnsResolver
    {
        private readonly IPAddress _address;

        public FakeDnsResolver(IPAddress address) => _address = address;

        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken ct = default)
            => Task.FromResult(new[] { _address });
    }

    private sealed class RedirectStubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.Found);
            response.Headers.Location = new Uri("http://127.0.0.1/secret.js");
            return Task.FromResult(response);
        }
    }

    private sealed class NamedHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpClient _client;

        public NamedHttpClientFactory(HttpMessageHandler handler)
            => _client = new HttpClient(handler) { BaseAddress = new Uri("https://cdn.example.com/") };

        public HttpClient CreateClient(string name) => _client;
    }

    private sealed class InMemoryScriptStore : IInjectedScriptStore
    {
        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<InjectedScriptEntity?> TryGetAsync(string id, CancellationToken ct = default)
            => Task.FromResult<InjectedScriptEntity?>(null);
        public Task<InjectedScriptMetadata> SaveAsync(string name, string content, CancellationToken ct = default)
            => Task.FromResult(new InjectedScriptMetadata
            {
                Id = "id",
                Name = name,
                Sha256 = "",
                Size = content.Length,
                UploadedAt = DateTimeOffset.UtcNow,
            });
        public Task<IReadOnlyList<InjectedScriptMetadata>> ListAsync(CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<InjectedScriptMetadata>>([]);
        public Task<bool> DeleteAsync(string id, CancellationToken ct = default) => Task.FromResult(false);
        public Task<bool> ExistsAsync(string id, CancellationToken ct = default) => Task.FromResult(false);
    }
}
