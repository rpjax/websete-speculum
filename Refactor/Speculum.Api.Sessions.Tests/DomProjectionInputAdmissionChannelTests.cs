using Speculum.Api.Sessions.Mirror.DomProjection;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class DomProjectionInputAdmissionChannelTests
{
    [Fact]
    public void Admit_ReportsEvictedOldest()
    {
        var admission = DomProjectionInputAdmissionChannel.CreateQueueOnly(capacity: 1);
        try
        {
            admission.Admit(Dom("mousedown"), out var firstDrop);
            Assert.Null(firstDrop);

            admission.Admit(Dom("mouseup"), out var dropped);
            Assert.NotNull(dropped);
            Assert.Equal("mousedown", dropped!.Type);
        }
        finally
        {
            admission.Complete();
        }
    }

    private static DomProjectionInput Dom(string type)
        => new()
        {
            Generation = 1,
            Type = type,
            Payload = "{}",
            TraceId = "t-" + type,
        };
}
