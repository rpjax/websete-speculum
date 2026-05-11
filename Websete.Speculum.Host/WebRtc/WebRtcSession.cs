using System.Text;
using System.Text.Json;
using SIPSorcery.Net;
using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.WebRtc;

/// <summary>
/// Represents the WebRTC side of one browser session.
///
/// Video pipeline:
///   Xvfb display → FFmpeg x11grab → H.264 Annex B pipe
///   → <see cref="FfmpegCapture"/> NAL unit parser
///   → Access Unit accumulator (one AU per RTP timestamp)
///   → <see cref="RTCPeerConnection.SendVideo"/> → client browser
///
/// Control pipeline:
///   Client → "input" DataChannel → <see cref="DispatchInputAsync"/>
///   → Playwright page actions
///
/// Signaling is handled externally by <c>VirtualizationHub</c> (SignalR).
/// </summary>
public sealed class WebRtcSession : IAsyncDisposable
{
    private readonly RTCPeerConnection       _pc;
    private readonly BrowserSession          _browser;
    private readonly ILogger                 _logger;
    private readonly CancellationTokenSource _cts = new();

    private FfmpegCapture?  _ffmpeg;
    private RTCDataChannel? _inputChannel;
    private RTCDataChannel? _rpcChannel;

    // Guard against StartFfmpeg being called twice (e.g. transient "disconnected"
    // followed by "connected" on the same peer connection).
    private int _ffmpegStarted = 0;

    // ── Access Unit accumulator ───────────────────────────────────────────────
    //
    // H.264 Annex B groups NAL units into Access Units (AUs), where each AU
    // corresponds to exactly one video frame and must share a single RTP timestamp.
    //
    // With aud=1 in FFmpeg's x264-params, every frame begins with an Access Unit
    // Delimiter NAL (type 9). We use that boundary to flush the previous AU as one
    // SendVideo call, advancing the RTP timestamp by exactly FrameDuration once per
    // frame regardless of how many NAL units the frame contains (AUD, SPS, PPS, SEI,
    // slice...).
    //
    // Thread-safety: FfmpegCapture.RunAsync calls OnNalUnit sequentially from a
    // single async continuation — no concurrent access to _auBuffer.
    private readonly List<byte[]> _auBuffer = [];

    // H.264 RTP clock is 90 kHz; duration per frame = clock / fps.
    private const uint VideoClockRate = 90_000;
    private const int  TargetFps      = 60;
    private static readonly uint FrameDuration = VideoClockRate / TargetFps; // 1 500

    /// <summary>
    /// Raised on every outbound signaling message (answer, ICE candidate).
    /// The hub subscribes to this and forwards to the SignalR client.
    /// </summary>
    public event Func<string, Task>? OnSignalMessage;

    public WebRtcSession(BrowserSession browser, ILogger logger)
    {
        _browser = browser;
        _logger  = logger;

        _pc = new RTCPeerConnection(new RTCConfiguration
        {
            iceServers = [new RTCIceServer { urls = "stun:stun.l.google.com:19302" }]
        });

        // ── SendOnly H.264 video track ────────────────────────────────────────
        // The client receives video; it never sends any back.
        var videoTrack = new MediaStreamTrack(
            SDPMediaTypesEnum.video,
            false,
            new List<SDPAudioVideoMediaFormat>
            {
                new SDPAudioVideoMediaFormat(SDPWellKnownMediaFormatsEnum.H264)
            },
            MediaStreamStatusEnum.SendOnly);

        _pc.addTrack(videoTrack);

        // ── Events ────────────────────────────────────────────────────────────
        _pc.ondatachannel           += OnDataChannel;
        _pc.onconnectionstatechange += OnConnectionStateChanged;

        _pc.onicecandidate += candidate =>
        {
            if (candidate is null) return;
            var json = JsonSerializer.Serialize(new
            {
                type      = "candidate",
                candidate = new
                {
                    candidate     = candidate.candidate,
                    sdpMid        = candidate.sdpMid,
                    sdpMLineIndex = (int?)candidate.sdpMLineIndex
                }
            });
            _ = OnSignalMessage?.Invoke(json) ?? Task.CompletedTask;
        };
    }

    // ── Connection state ──────────────────────────────────────────────────────

    private void OnConnectionStateChanged(RTCPeerConnectionState state)
    {
        _logger.LogInformation("[{Id}] WebRTC → {State}", _browser.SessionId, state);

        switch (state)
        {
            case RTCPeerConnectionState.connected:
                // Peer is ready — start pumping video.
                StartFfmpeg();
                break;

            // "disconnected" is transient and may recover; don't tear down on it.
            case RTCPeerConnectionState.failed:
            case RTCPeerConnectionState.closed:
                _cts.Cancel();
                break;
        }
    }

    private void StartFfmpeg()
    {
        // Guard: only start one FFmpeg process per session.
        // "connected" can fire more than once on ICE restarts.
        if (Interlocked.CompareExchange(ref _ffmpegStarted, 1, 0) != 0) return;

        try
        {
            _ffmpeg = FfmpegCapture.Start(
                _browser.DisplayNumber,
                _browser.Width,
                _browser.Height,
                fps: TargetFps);

            _ = _ffmpeg.RunAsync(OnNalUnit, _cts.Token);

            _logger.LogInformation(
                "[{Id}] FFmpeg capture started — display :{Display} at {W}x{H}@{Fps}fps",
                _browser.SessionId, _browser.DisplayNumber,
                _browser.Width, _browser.Height, TargetFps);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[{Id}] Failed to start FFmpeg", _browser.SessionId);
            // Reset flag so a future reconnect can retry.
            Interlocked.Exchange(ref _ffmpegStarted, 0);
        }
    }

    // ── Video ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Called for each raw NAL unit emitted by FfmpegCapture (start code stripped).
    /// Accumulates NALs into an Access Unit and flushes on each AUD boundary.
    /// </summary>
    private void OnNalUnit(byte[] nalUnit)
    {
        if (nalUnit.Length == 0) return;

        // NAL unit type is in the 5 low-order bits of the first byte (H.264 spec §7.4.1).
        int nalType = nalUnit[0] & 0x1F;

        // AUD (type 9) is emitted by FFmpeg (aud=1) at the START of each new frame.
        // Flush the previously accumulated Access Unit before starting the new one.
        if (nalType == 9 && _auBuffer.Count > 0)
            FlushAccessUnit();

        _auBuffer.Add(nalUnit);
    }

    /// <summary>
    /// Assembles the buffered NAL units into a single Annex B byte stream and
    /// sends it as one RTP frame. The RTP timestamp advances by exactly
    /// <see cref="FrameDuration"/> — once per frame, not once per NAL unit.
    /// </summary>
    private void FlushAccessUnit()
    {
        if (_auBuffer.Count == 0) return;

        // Concatenate: 4-byte start code (00 00 00 01) + payload per NAL.
        // SIPSorcery's H.264 packetiser parses the Annex B stream and splits
        // large NALs into FU-A fragments as required by RFC 6184.
        int totalSize = _auBuffer.Sum(n => 4 + n.Length);
        var buffer    = new byte[totalSize];
        int offset    = 0;

        foreach (var nal in _auBuffer)
        {
            buffer[offset++] = 0; buffer[offset++] = 0;
            buffer[offset++] = 0; buffer[offset++] = 1; // 00 00 00 01
            nal.CopyTo(buffer, offset);
            offset += nal.Length;
        }

        _auBuffer.Clear();

        try   { _pc.SendVideo(FrameDuration, buffer); }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[{Id}] Video send error", _browser.SessionId);
        }
    }

    // ── Signaling ─────────────────────────────────────────────────────────────

    public async Task<string> HandleOfferAsync(string offerSdp)
    {
        _pc.setRemoteDescription(new RTCSessionDescriptionInit
        {
            type = RTCSdpType.offer,
            sdp  = offerSdp
        });

        var answer = _pc.createAnswer(null);
        await _pc.setLocalDescription(answer);

        return JsonSerializer.Serialize(new { type = "answer", sdp = answer.sdp });
    }

    public void AddIceCandidate(string candidate, string? sdpMid, ushort? sdpMLineIndex)
    {
        _pc.addIceCandidate(new RTCIceCandidateInit
        {
            candidate     = candidate,
            sdpMid        = sdpMid,
            sdpMLineIndex = sdpMLineIndex ?? 0
        });
    }

    // ── DataChannels ──────────────────────────────────────────────────────────
    // Video no longer uses a DataChannel — it flows over the media track.
    // DataChannels are kept for low-latency control messages (input, RPC).

    private void OnDataChannel(RTCDataChannel channel)
    {
        _logger.LogInformation("[{Id}] DataChannel opened: '{Label}'",
            _browser.SessionId, channel.label);

        switch (channel.label)
        {
            case "input":
                _inputChannel = channel;
                _inputChannel.onmessage += (_, _, data) =>
                    _ = DispatchInputAsync(Encoding.UTF8.GetString(data));
                break;

            case "rpc":
                _rpcChannel = channel;
                _rpcChannel.onmessage += (_, _, data) =>
                    _logger.LogDebug("[{Id}][rpc] {Payload}",
                        _browser.SessionId, Encoding.UTF8.GetString(data));
                break;
        }
    }

    // ── Input ─────────────────────────────────────────────────────────────────

    private async Task DispatchInputAsync(string json)
    {
        try
        {
            using var doc  = JsonDocument.Parse(json);
            var        root = doc.RootElement;

            switch (root.GetProperty("type").GetString())
            {
                case "navigate":
                    await _browser.NavigateAsync(root.GetProperty("url").GetString()!);
                    break;
                case "click":
                    await _browser.ClickAsync(
                        root.GetProperty("x").GetSingle(),
                        root.GetProperty("y").GetSingle());
                    break;
                case "mousemove":
                    await _browser.MoveAsync(
                        root.GetProperty("x").GetSingle(),
                        root.GetProperty("y").GetSingle());
                    break;
                case "wheel":
                    await _browser.WheelAsync(
                        root.GetProperty("deltaX").GetSingle(),
                        root.GetProperty("deltaY").GetSingle());
                    break;
                case "keypress":
                    await _browser.KeyPressAsync(root.GetProperty("key").GetString()!);
                    break;
                case "type":
                    await _browser.TypeAsync(root.GetProperty("text").GetString()!);
                    break;
            }
        }
        catch { /* malformed input — ignore */ }
    }

    // ── Disposal ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        if (_ffmpeg is not null) await _ffmpeg.DisposeAsync();
        _auBuffer.Clear();
        _pc.close();
        _pc.Dispose();
    }
}
