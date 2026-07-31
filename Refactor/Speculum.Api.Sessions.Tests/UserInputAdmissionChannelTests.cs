using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class UserInputAdmissionChannelTests
{
    [Fact]
    public void Admit_PrefersDroppingHighFrequencyOverRelease()
    {
        var admission = UserInputAdmissionChannel.CreateQueueOnly(capacity: 2);
        try
        {
            admission.Admit(Move(1));
            admission.Admit(Move(2));
            admission.Admit(KeyUp("Shift"));

            var received = admission.SnapshotQueueForTests();
            Assert.Equal(2, received.Length);
            Assert.DoesNotContain(received, i => UserInputAdmitPolicy.IsHighFrequency(i) && MovePayload(i) == 1);
            Assert.Contains(received, i => i.Type == "keyup");
        }
        finally
        {
            admission.Complete();
        }
    }

    [Fact]
    public void Admit_DropsOldestWhenOnlyGestureEdgesQueued()
    {
        var admission = UserInputAdmissionChannel.CreateQueueOnly(capacity: 2);
        try
        {
            admission.Admit(MouseDown());
            admission.Admit(MouseUp());
            admission.Admit(KeyDown("a"));

            var received = admission.SnapshotQueueForTests();
            Assert.Equal(2, received.Length);
            Assert.Equal("mouseup", received[0].Type);
            Assert.Equal("keydown", received[1].Type);
        }
        finally
        {
            admission.Complete();
        }
    }

    private static UserInput Move(int n)
        => new()
        {
            Type = "mousemove",
            Payload = $"{{\"type\":\"mousemove\",\"x\":{n},\"y\":{n}}}",
        };

    private static int MovePayload(UserInput input)
    {
        var marker = "\"x\":";
        var start = input.Payload.IndexOf(marker, StringComparison.Ordinal);
        if (start < 0)
        {
            return -1;
        }

        start += marker.Length;
        var end = input.Payload.IndexOf(',', start);
        return int.Parse(input.Payload[start..end], System.Globalization.CultureInfo.InvariantCulture);
    }

    private static UserInput MouseDown()
        => new() { Type = "mousedown", Payload = "{\"type\":\"mousedown\",\"x\":1,\"y\":1,\"button\":0}" };

    private static UserInput MouseUp()
        => new() { Type = "mouseup", Payload = "{\"type\":\"mouseup\",\"x\":1,\"y\":1,\"button\":0}" };

    private static UserInput KeyDown(string key)
        => new() { Type = "keydown", Payload = $"{{\"type\":\"keydown\",\"key\":\"{key}\"}}" };

    private static UserInput KeyUp(string key)
        => new() { Type = "keyup", Payload = $"{{\"type\":\"keyup\",\"key\":\"{key}\"}}" };
}
