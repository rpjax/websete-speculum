using System.Diagnostics;

namespace Websete.Speculum.Browser;

/// <summary>
/// Manages a single Xvfb virtual framebuffer process.
///
/// Each browser session gets its own display number so that FFmpeg can capture
/// exactly that session's pixels without mixing content from other sessions.
/// Disposing this instance kills the Xvfb process and frees the display slot.
/// </summary>
public sealed class XvfbDisplay : IAsyncDisposable
{
    public int Number { get; }

    private readonly Process _xvfb;

    private XvfbDisplay(int number, Process xvfb)
    {
        Number = number;
        _xvfb  = xvfb;
    }

    /// <summary>
    /// Starts Xvfb on <c>:{number}</c> and waits until its lock file appears,
    /// which is the conventional readiness signal for X11 servers.
    /// </summary>
    public static async Task<XvfbDisplay> StartAsync(
        int               number,
        int               width,
        int               height,
        CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo
        {
            FileName  = "Xvfb",
            // +extension GLX: required for hardware-accelerated compositing paths in Firefox.
            // -ac: disable access control so the browser process can connect without an .Xauthority cookie.
            Arguments = $":{number} -screen 0 {width}x{height}x24 -ac +extension GLX +render",
            UseShellExecute        = false,
            RedirectStandardOutput = true,
            RedirectStandardError  = true,
        };

        var process = Process.Start(psi)
            ?? throw new InvalidOperationException($"Failed to start Xvfb :{number}");

        // Drain stdout/stderr so pipe buffers never fill and block the Xvfb process.
        _ = process.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
        _ = process.StandardError.BaseStream.CopyToAsync(Stream.Null);

        // Poll for the X11 lock file — its existence signals the server is ready.
        var lockFile = $"/tmp/.X{number}-lock";

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));

        while (!File.Exists(lockFile))
        {
            if (process.HasExited)
                throw new InvalidOperationException(
                    $"Xvfb :{number} exited prematurely (code {process.ExitCode}).");

            await Task.Delay(50, timeout.Token);
        }

        return new XvfbDisplay(number, process);
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (!_xvfb.HasExited)
            {
                _xvfb.Kill();
                await _xvfb.WaitForExitAsync();
            }
        }
        catch { /* already dead */ }
        finally
        {
            _xvfb.Dispose();
        }
    }
}
