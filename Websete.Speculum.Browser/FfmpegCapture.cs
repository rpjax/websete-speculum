using System.Diagnostics;
using System.Runtime.CompilerServices;

namespace Websete.Speculum.Browser;

/// <summary>
/// Wraps an FFmpeg process that captures a specific Xvfb display via x11grab
/// and streams H.264 Annex B NAL units to the caller through a pipe.
///
/// The caller feeds those NAL units directly into SIPSorcery's
/// <c>RTCPeerConnection.SendVideo()</c>, which handles RTP packetisation and
/// SRTP encryption. This replaces the old Playwright screenshot polling approach:
/// instead of one CDP round-trip per frame, we get a proper GPU-composed video
/// stream at native browser frame rate.
/// </summary>
public sealed class FfmpegCapture : IAsyncDisposable
{
    private readonly Process _ffmpeg;

    private FfmpegCapture(Process ffmpeg) => _ffmpeg = ffmpeg;

    /// <summary>
    /// Spawns FFmpeg capturing display <c>:{display}</c> at the given resolution and FPS.
    /// The process writes raw H.264 Annex B to its stdout pipe.
    /// </summary>
    public static FfmpegCapture Start(int display, int width, int height, int fps = 60)
    {
        var psi = new ProcessStartInfo
        {
            FileName  = "ffmpeg",
            Arguments =
                // Input: X11 screen grab from the virtual display.
                $"-f x11grab -framerate {fps} -video_size {width}x{height} -i :{display} " +
                // Codec: H.264 baseline/level 3.1 — widest WebRTC client compatibility.
                // ultrafast + zerolatency: minimise encode latency (not compression ratio).
                // bframes=0 : no B-frames — eliminates DTS/PTS reordering, lowest decode latency.
                // keyint=fps : one IDR keyframe per second so late-joining clients sync quickly.
                // scenecut=0 : disable scene-cut keyframes — keeps frame timing predictable.
                // aud=1      : emit Access Unit Delimiter NAL units — used by the RTP sender
                //              to detect exact frame boundaries without inspecting slice headers.
                $"-c:v libx264 -preset ultrafast -tune zerolatency " +
                $"-profile:v baseline -level:v 3.1 " +
                $"-x264-params keyint={fps}:min-keyint={fps}:scenecut=0:bframes=0:aud=1 " +
                // Output: raw Annex B H.264 to stdout.
                $"-f h264 -",
            UseShellExecute        = false,
            RedirectStandardOutput = true,
            RedirectStandardError  = true,
        };

        var process = Process.Start(psi)
            ?? throw new InvalidOperationException(
                $"Failed to start FFmpeg for Xvfb display :{display}");

        // CRITICAL: drain stderr asynchronously.
        // FFmpeg writes progress stats to stderr continuously. If we don't consume
        // that pipe the OS buffer (~64 KB) fills up, FFmpeg blocks on its next write,
        // and our stdout ReadAsync deadlocks — starving the video pipeline.
        _ = process.StandardError.BaseStream.CopyToAsync(Stream.Null);

        return new FfmpegCapture(process);
    }

    /// <summary>
    /// Reads H.264 Annex B NAL units from the FFmpeg pipe and invokes
    /// <paramref name="onNalUnit"/> for each one until <paramref name="ct"/> is cancelled
    /// or the pipe closes. Each yielded <c>byte[]</c> is one raw NAL payload —
    /// the Annex B start code is stripped.
    /// </summary>
    public async Task RunAsync(Action<byte[]> onNalUnit, CancellationToken ct)
    {
        var stream = _ffmpeg.StandardOutput.BaseStream;

        await foreach (var nal in ReadNalUnitsAsync(stream, ct))
            onNalUnit(nal);
    }

    // ── Annex B stream parser ─────────────────────────────────────────────────
    //
    // H.264 Annex B format delineates NAL units with start codes:
    //   3-byte: 00 00 01
    //   4-byte: 00 00 00 01
    //
    // Strategy:
    //   • Maintain a rolling 8 MB byte buffer fed by ReadAsync.
    //   • Scan for start codes to find NAL unit boundaries.
    //   • Yield each NAL unit payload (start code excluded) as a byte[].
    //   • Compact the buffer once more than half has been emitted.

    private static async IAsyncEnumerable<byte[]> ReadNalUnitsAsync(
        Stream                                    stream,
        [EnumeratorCancellation] CancellationToken ct)
    {
        const int BufCap = 8 * 1024 * 1024; // 8 MB rolling buffer
        var buf      = new byte[BufCap];
        int filled   = 0;
        int nalStart = -1; // byte offset of current NAL unit's payload in buf (-1 = not yet seen)

        while (!ct.IsCancellationRequested)
        {
            // Buffer completely full: the current NAL exceeds 8 MB — pathological.
            // Discard everything and resync. With aud=1 in the FFmpeg args the
            // encoder emits an AUD at the start of every frame, so recovery is fast.
            if (filled == BufCap)
            {
                filled   = 0;
                nalStart = -1;
                continue; // ReadAsync next with a fresh, empty buffer
            }

            int preFill = filled; // snapshot before extending
            int n = await stream.ReadAsync(buf.AsMemory(filled, BufCap - filled), ct);
            if (n == 0) yield break; // FFmpeg pipe closed (EOF or process killed)

            filled += n;

            // Determine where to start scanning:
            //   • nalStart >= 0 → an open NAL starts here; scan from its beginning
            //     so we can find where it ends inside the newly appended data.
            //   • nalStart < 0  → no open NAL; scan from 3 bytes before the new data
            //     to catch start codes that were split across two ReadAsync calls.
            int scanFrom = nalStart >= 0
                ? nalStart
                : Math.Max(0, preFill - 3);

            while (true)
            {
                int sc = FindStartCode(buf, scanFrom, filled);
                if (sc < 0) break; // no complete NAL unit boundary yet

                // Determine start-code length (3-byte 00 00 01 vs 4-byte 00 00 00 01).
                int scLen = (sc + 3 < filled && buf[sc + 2] == 0) ? 4 : 3;

                if (nalStart >= 0 && sc > nalStart)
                    yield return buf[nalStart..sc]; // NAL payload — start code excluded

                nalStart = sc + scLen; // payload of the *next* NAL begins here
                scanFrom = nalStart;
            }

            // Compact: once the emitted prefix exceeds half the buffer, shift the
            // remaining live data to the front so we never run out of room.
            if (nalStart > BufCap / 2 && nalStart > 0)
            {
                int keep = filled - nalStart;
                if (keep > 0) Buffer.BlockCopy(buf, nalStart, buf, 0, keep);
                filled   = Math.Max(keep, 0);
                nalStart = 0;
                // scanFrom is a local variable scoped to the inner while — no fixup needed.
            }
        }
    }

    private static int FindStartCode(byte[] buf, int from, int filled)
    {
        int end = filled - 3;
        for (int i = Math.Max(0, from); i < end; i++)
        {
            if (buf[i] != 0 || buf[i + 1] != 0) continue;
            if (buf[i + 2] == 1) return i;                                         // 00 00 01
            if (i < filled - 4 && buf[i + 2] == 0 && buf[i + 3] == 1) return i;  // 00 00 00 01
        }
        return -1;
    }

    // ── Disposal ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (!_ffmpeg.HasExited) _ffmpeg.Kill();
            await _ffmpeg.WaitForExitAsync();
        }
        catch { /* already dead */ }
        finally
        {
            _ffmpeg.Dispose();
        }
    }
}
