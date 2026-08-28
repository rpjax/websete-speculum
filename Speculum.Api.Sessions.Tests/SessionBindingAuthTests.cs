using Speculum.Api.Presentation.Sessions;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionBindingAuthTests
{
    [Fact]
    public void SelectToken_PrefersReservedQueryParameter()
    {
        Assert.Equal("q", SessionBindingAuth.SelectToken("q", "h"));
    }

    [Fact]
    public void SelectToken_FallsBackToHeaderWhenQueryIsAbsent()
    {
        Assert.Equal("h", SessionBindingAuth.SelectToken(null, "h"));
        Assert.Equal("h", SessionBindingAuth.SelectToken("", "h"));
        Assert.Equal("h", SessionBindingAuth.SelectToken("   ", "h"));
    }

    [Fact]
    public void SelectToken_TrimsAndRejectsBlank()
    {
        Assert.Equal("q", SessionBindingAuth.SelectToken("  q  ", null));
        Assert.Null(SessionBindingAuth.SelectToken(null, null));
        Assert.Null(SessionBindingAuth.SelectToken("", "  "));
    }

    [Fact]
    public void StripReservedFromQuery_RemovesOnlyReservedParameters()
    {
        var query = "?token=upstream&speculum-session-token=abc&v=2&speculum-cache-bust=99";

        Assert.Equal("?token=upstream&v=2", SessionBindingAuth.StripReservedFromQuery(query));
    }

    /// <summary>
    /// Regression: a mirrored site's own <c>token=</c> is part of the URL the producer
    /// materialized the body under. Dropping it produced <c>asset_missing</c> 404s.
    /// </summary>
    [Fact]
    public void StripReservedFromQuery_KeepsSiteOwnTokenInTheAssetKey()
    {
        Assert.Equal(
            "?token=cdn-signature",
            SessionBindingAuth.StripReservedFromQuery("?token=cdn-signature&speculum-session-token=abc"));
    }

    [Fact]
    public void StripReservedFromQuery_PreservesOrderAndEncodingVerbatim()
    {
        Assert.Equal(
            "?b=%2Fx%20y&a=1&b=2",
            SessionBindingAuth.StripReservedFromQuery("?b=%2Fx%20y&speculum-session-token=t&a=1&b=2"));
    }

    [Fact]
    public void StripReservedFromQuery_IsCaseInsensitiveOnTheReservedName()
    {
        Assert.Equal(
            "",
            SessionBindingAuth.StripReservedFromQuery("?SPECULUM-SESSION-TOKEN=abc"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("?")]
    [InlineData("?speculum-session-token=abc")]
    public void StripReservedFromQuery_ReturnsEmptyWhenNothingRemains(string query)
    {
        Assert.Equal("", SessionBindingAuth.StripReservedFromQuery(query));
    }

    [Fact]
    public void StripReservedFromQuery_AcceptsQueryWithoutLeadingQuestionMark()
    {
        Assert.Equal("?v=1", SessionBindingAuth.StripReservedFromQuery("v=1&speculum-session-token=t"));
    }

    /// <summary>
    /// The reserved names are a cross-language contract with the web client
    /// (<c>SessionAuthQueryParam</c> / <c>SessionCacheBustQueryParam</c>).
    /// </summary>
    [Fact]
    public void ReservedNames_MatchTheClientContract()
    {
        Assert.Equal("speculum-session-token", SessionBindingAuth.QueryParameterName);
        Assert.Equal("speculum-cache-bust", SessionBindingAuth.CacheBustQueryParameterName);
        Assert.Equal("X-Speculum-Session-Token", SessionBindingAuth.HeaderName);
    }
}
