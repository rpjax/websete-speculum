using Microsoft.Extensions.Options;
using Speculum.Api.BrowserSessions.Services;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionSlotRegistryTests
{
    [Fact]
    public void TryAquire_RespectsMaxConcurrentSessions()
    {
        var registry = new SessionSlotRegistry(
            Options.Create(SessionsTestHarness.ResourceManagement(maxConcurrentSessions: 2)));

        Assert.True(registry.TryAquire(Guid.NewGuid()));
        Assert.True(registry.TryAquire(Guid.NewGuid()));
        Assert.False(registry.TryAquire(Guid.NewGuid()));
        Assert.Equal(0, registry.GetAvailableSlots());
    }

    [Fact]
    public void Release_FreesSlot()
    {
        var registry = new SessionSlotRegistry(
            Options.Create(SessionsTestHarness.ResourceManagement(maxConcurrentSessions: 1)));

        var sessionId = Guid.NewGuid();
        Assert.True(registry.TryAquire(sessionId));
        Assert.False(registry.TryAquire(Guid.NewGuid()));

        registry.Release(sessionId);
        Assert.Equal(1, registry.GetAvailableSlots());
        Assert.True(registry.TryAquire(Guid.NewGuid()));
    }

    [Fact]
    public void TryAquire_SameSession_IsIdempotent()
    {
        var registry = new SessionSlotRegistry(
            Options.Create(SessionsTestHarness.ResourceManagement(maxConcurrentSessions: 1)));

        var sessionId = Guid.NewGuid();
        Assert.True(registry.TryAquire(sessionId));
        Assert.True(registry.IsAquired(sessionId));
        Assert.True(registry.TryAquire(sessionId));
    }
}
