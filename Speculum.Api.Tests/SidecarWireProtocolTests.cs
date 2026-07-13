using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Tests;

public sealed class SidecarWireProtocolTests
{
    [Fact]
    public void EncodeScreencastFrame_matches_wire_layout()
    {
        var jpeg = new byte[] { 0xFF, 0xD8, 0xFF, 0xD9 };
        var frame = SidecarWireProtocol.EncodeScreencastFrame(jpeg);

        Assert.Equal(SidecarWireProtocol.MsgScreencast, frame[0]);
        Assert.Equal(jpeg, frame[1..]);
    }

    [Fact]
    public void EncodeUrlUpdate_matches_wire_layout()
    {
        var frame = SidecarWireProtocol.EncodeUrlUpdate("https://example.com/path");

        Assert.Equal(SidecarWireProtocol.MsgUrl, frame[0]);
        Assert.Equal(24u, BitConverter.ToUInt32(frame, 1));
        Assert.Equal("https://example.com/path", System.Text.Encoding.UTF8.GetString(frame[5..]));
    }

    [Fact]
    public void EncodeConsoleMessage_matches_wire_layout()
    {
        var frame = SidecarWireProtocol.EncodeConsoleMessage(2, "boom");

        Assert.Equal(SidecarWireProtocol.MsgConsole, frame[0]);
        Assert.Equal(2, frame[1]);
        Assert.Equal(4, frame[2]); // len 4 LE
        Assert.Equal("boom", System.Text.Encoding.UTF8.GetString(frame[6..]));
    }

    [Fact]
    public void EncodeEvalResult_matches_wire_layout()
    {
        var frame = SidecarWireProtocol.EncodeEvalResult(7, true, "{\"ok\":true}");

        Assert.Equal(SidecarWireProtocol.MsgEvalResult, frame[0]);
        Assert.Equal(7u, BitConverter.ToUInt32(frame, 1));
        Assert.Equal(1, frame[5]);
        Assert.Contains("\"ok\"", System.Text.Encoding.UTF8.GetString(frame[10..]));
    }

    [Fact]
    public void EncodeRedirectFrame_matches_url_layout()
    {
        var frame = SidecarWireProtocol.EncodeRedirectFrame("https://leave.example/");

        Assert.Equal(SidecarWireProtocol.MsgRedirect, frame[0]);
        Assert.Equal("https://leave.example/", System.Text.Encoding.UTF8.GetString(frame[5..]));
    }

    [Fact]
    public void EncodeStatusFrame_matches_wire_layout()
    {
        const string json = """{"tabCount":1,"url":"https://a","resizing":false,"width":1,"height":2}""";
        var frame = SidecarWireProtocol.EncodeStatusFrame(json);

        Assert.Equal(SidecarWireProtocol.MsgStatus, frame[0]);
        Assert.Equal(json, System.Text.Encoding.UTF8.GetString(frame[5..]));
    }
}
