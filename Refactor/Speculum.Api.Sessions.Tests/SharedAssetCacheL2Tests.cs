using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror.PageProjection;

namespace Speculum.Api.Sessions.Tests;

public sealed class SharedAssetCacheL2Tests
{
    private static SharedAssetCacheL2 Cache(long maxBytes = 1024, bool enabled = true)
        => new(SessionsTestHarness.Configuration(
            sessions: new SessionsConfiguration
            {
                PageProjection = new PageProjectionOptions
                {
                    AssetCacheL2MaxBytes = maxBytes,
                    AssetCacheL2Enabled = enabled,
                },
            }));

    [Fact]
    public void TryAcquire_Miss_ReturnsNull()
    {
        var cache = Cache();
        Assert.Null(cache.TryAcquire("missing"));
    }

    [Fact]
    public void Put_ThenTryAcquire_ReturnsSameBytes()
    {
        var cache = Cache();
        using var written = cache.Put("k1", [1, 2, 3], "text/css");
        using var read = cache.TryAcquire("k1");

        Assert.NotNull(read);
        Assert.Same(written.Body, read!.Body);
        Assert.Equal("text/css", read.ContentType);
    }

    [Fact]
    public void Put_DuplicateKey_CoalescesToOneStoredCopy()
    {
        var cache = Cache();
        using var first = cache.Put("k1", [1, 2, 3], "text/css");
        using var second = cache.Put("k1", [9, 9, 9], "text/css");

        Assert.Same(first.Body, second.Body);
        Assert.Equal(1, cache.Count);
    }

    [Fact]
    public void Eviction_RespectsByteCap_LruOrder()
    {
        var cache = Cache(maxBytes: 10);
        cache.Put("a", new byte[4], "application/octet-stream").Dispose();
        cache.Put("b", new byte[4], "application/octet-stream").Dispose();
        // Touch "a" so "b" becomes the least-recently-used entry.
        using (cache.TryAcquire("a")) { }
        cache.Put("c", new byte[4], "application/octet-stream").Dispose();

        Assert.Null(cache.TryAcquire("b"));
        Assert.NotNull(cache.TryAcquire("a"));
        Assert.NotNull(cache.TryAcquire("c"));
    }

    [Fact]
    public void Eviction_WhileReferenced_DoesNotInvalidateHeldHandle()
    {
        var cache = Cache(maxBytes: 4);
        var held = cache.Put("a", new byte[4], "application/octet-stream"); // refcount stays 1 — never disposed
        cache.Put("b", new byte[4], "application/octet-stream").Dispose(); // forces eviction of "a"

        Assert.Null(cache.TryAcquire("a")); // evicted key must miss on new lookups
        Assert.Equal(new byte[4], held.Body); // the already-held handle's view stays correct (PP-ASSET-6)
        held.Dispose();
    }

    [Fact]
    public void Enabled_ReflectsConfigKillSwitch()
    {
        Assert.True(Cache(enabled: true).Enabled);
        Assert.False(Cache(enabled: false).Enabled);
    }

    [Theory]
    [InlineData(200, true)]
    [InlineData(206, true)]
    [InlineData(301, true)]
    [InlineData(404, false)]
    [InlineData(500, false)]
    public void IsShareable_GatesOnCacheableStatus(int status, bool expected)
    {
        var descriptor = new SharedAssetShareabilityDescriptor
        {
            StatusCode = status,
            Kind = SharedAssetRequestKind.Subresource,
        };
        Assert.Equal(expected, SharedAssetCacheL2.IsShareable(descriptor));
    }

    [Fact]
    public void IsShareable_RejectsCredentialedRequests()
    {
        Assert.False(SharedAssetCacheL2.IsShareable(new SharedAssetShareabilityDescriptor
        {
            StatusCode = 200,
            Kind = SharedAssetRequestKind.Subresource,
            RequestHadCookie = true,
        }));
        Assert.False(SharedAssetCacheL2.IsShareable(new SharedAssetShareabilityDescriptor
        {
            StatusCode = 200,
            Kind = SharedAssetRequestKind.Subresource,
            RequestHadAuthorization = true,
        }));
    }

    [Theory]
    [InlineData("private")]
    [InlineData("no-store")]
    [InlineData("no-cache")]
    public void IsShareable_RejectsUnshareableCacheControl(string directive)
    {
        Assert.False(SharedAssetCacheL2.IsShareable(new SharedAssetShareabilityDescriptor
        {
            StatusCode = 200,
            Kind = SharedAssetRequestKind.Subresource,
            CacheControlDirectives = [directive],
        }));
    }

    [Theory]
    [InlineData("Cookie")]
    [InlineData("Authorization")]
    [InlineData("*")]
    public void IsShareable_RejectsVaryOnCredentials(string vary)
    {
        Assert.False(SharedAssetCacheL2.IsShareable(new SharedAssetShareabilityDescriptor
        {
            StatusCode = 200,
            Kind = SharedAssetRequestKind.Subresource,
            VaryValues = [vary],
        }));
    }

    [Theory]
    [InlineData(SharedAssetRequestKind.NavigationDocument)]
    [InlineData(SharedAssetRequestKind.XhrOrFetch)]
    public void IsShareable_RejectsNonSubresourceKinds(SharedAssetRequestKind kind)
    {
        Assert.False(SharedAssetCacheL2.IsShareable(new SharedAssetShareabilityDescriptor
        {
            StatusCode = 200,
            Kind = kind,
        }));
    }

    [Fact]
    public void BuildKey_DiffersOnQueryAndVaryAndCredentialMode()
    {
        var a = SharedAssetCacheL2.BuildKey("https", "cdn.test", 443, "/img.png", "?sig=1", [], "none");
        var b = SharedAssetCacheL2.BuildKey("https", "cdn.test", 443, "/img.png", "?sig=2", [], "none");
        var c = SharedAssetCacheL2.BuildKey("https", "cdn.test", 443, "/img.png", "?sig=1", ["Accept-Encoding"], "none");
        var d = SharedAssetCacheL2.BuildKey("https", "cdn.test", 443, "/img.png", "?sig=1", [], "include");

        Assert.NotEqual(a, b);
        Assert.NotEqual(a, c);
        Assert.NotEqual(a, d);
    }
}
