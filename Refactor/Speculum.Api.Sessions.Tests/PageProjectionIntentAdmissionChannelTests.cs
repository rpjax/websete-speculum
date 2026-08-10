using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class PageProjectionIntentAdmissionChannelTests
{
    [Fact]
    public void Admit_PrefersEvictingDroppableMove()
    {
        var admission = PageProjectionIntentAdmissionChannel.CreateQueueOnly(capacity: 2);
        try
        {
            admission.Admit(Dom("mousemove"), out _);
            admission.Admit(Dom("mousedown"), out var firstDrop);
            Assert.Null(firstDrop);

            admission.Admit(Dom("mouseup"), out var dropped);
            Assert.NotNull(dropped);
            Assert.Equal("mousemove", dropped!.Type);
        }
        finally
        {
            admission.Complete();
        }
    }

    [Fact]
    public void Admit_DropsIncomingMoveWhenQueueIsOnlyProtected()
    {
        var admission = PageProjectionIntentAdmissionChannel.CreateQueueOnly(capacity: 1);
        try
        {
            admission.Admit(Dom("scrollViewport"), out _);
            admission.Admit(Dom("mousemove"), out var dropped);
            Assert.NotNull(dropped);
            Assert.Equal("mousemove", dropped!.Type);
        }
        finally
        {
            admission.Complete();
        }
    }

    [Fact]
    public void Admit_NeverDropsProtectedIntentsUnderPressure()
    {
        var admission = PageProjectionIntentAdmissionChannel.CreateQueueOnly(capacity: 1);
        try
        {
            admission.Admit(Dom("keydown"), out _);
            admission.Admit(Dom("scrollElement", anchor: "a1"), out var dropped);
            // Soft over-capacity — keydown must remain; scroll may coalesce later.
            Assert.Null(dropped);
        }
        finally
        {
            admission.Complete();
        }
    }

    [Fact]
    public void Admit_CollapsesScrollPerScroller()
    {
        var admission = PageProjectionIntentAdmissionChannel.CreateQueueOnly(capacity: 2);
        try
        {
            admission.Admit(Dom("scrollViewport"), out _);
            admission.Admit(Dom("mousedown"), out _);
            admission.Admit(Dom("scrollViewport"), out var dropped);
            Assert.NotNull(dropped);
            Assert.Equal("scrollViewport", dropped!.Type);
        }
        finally
        {
            admission.Complete();
        }
    }

    private static PageProjectionIntent Dom(string type, string? anchor = null)
        => new()
        {
            Generation = 1,
            Type = type,
            Anchor = anchor,
            Payload = "{}",
            TraceId = "t-" + type,
        };
}
