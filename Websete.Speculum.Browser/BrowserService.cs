using System.Collections.Concurrent;
using Microsoft.Playwright;

namespace Websete.Speculum.Browser;

/// <summary>
/// Manages the lifecycle of browser sessions.
///
/// Architecture change from the old single-browser model:
///   - <see cref="InitializeAsync"/> only starts the Playwright process manager.
///   - <see cref="CreateSessionAsync"/> starts a dedicated Xvfb display AND a dedicated
///     Firefox process per session, so each session's pixels are isolated and can be
///     independently captured by FFmpeg.
/// </summary>
public sealed class BrowserService : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, BrowserSession> _sessions = new();

    private IPlaywright? _playwright;
    private string?      _executablePath;

    // Monotonically incremented per session. Starting at 100 avoids clashing
    // with :0 (host desktop), :1, and common test/CI displays.
    private int _nextDisplay = 99;

    public int ActiveSessions => _sessions.Count;

    // ── Initialization ────────────────────────────────────────────────────────

    public async Task InitializeAsync(string camoufoxPath)
    {
        _playwright     = await Playwright.CreateAsync();
        _executablePath = ResolveExecutable(camoufoxPath);
    }

    private static string ResolveExecutable(string path)
    {
        if (File.Exists(path)) return path;

        if (Directory.Exists(path))
        {
            string[] candidates = ["camoufox", "camoufox.exe", "firefox", "firefox.exe"];
            foreach (var name in candidates)
            {
                var full = Path.Combine(path, name);
                if (File.Exists(full)) return full;
            }
            throw new FileNotFoundException(
                $"No Camoufox executable found in '{path}'. " +
                $"Expected one of: {string.Join(", ", candidates)}");
        }

        throw new FileNotFoundException($"Camoufox path does not exist: '{path}'");
    }

    // ── Session lifecycle ─────────────────────────────────────────────────────

    public async Task<BrowserSession> CreateSessionAsync(
        string sessionId,
        int    width  = 1280,
        int    height = 720)
    {
        if (_playwright is null || _executablePath is null)
            throw new InvalidOperationException(
                "BrowserService not initialized. Call InitializeAsync first.");

        var displayNum = Interlocked.Increment(ref _nextDisplay);

        // 1. Start the virtual display for this session.
        var display = await XvfbDisplay.StartAsync(displayNum, width, height);

        // 2. Launch a dedicated Firefox instance bound to that display.
        //    Headless = false: the browser must render to the X11 display so
        //    that Xvfb (and therefore FFmpeg) sees the actual pixels.
        //
        //    Guard: if anything after StartAsync fails, dispose the display so
        //    we don't leak Xvfb processes and display numbers.
        IBrowser? browser = null;
        try
        {
            browser = await _playwright.Firefox.LaunchAsync(new BrowserTypeLaunchOptions
            {
                Headless       = false,
                ExecutablePath = _executablePath,
                // Bind this browser process to the session's virtual display.
                Env = new Dictionary<string, string>
                {
                    ["DISPLAY"] = $":{displayNum}",
                },
                // Memory caps — standard Firefox prefs, do not affect fingerprint.
                FirefoxUserPrefs = new Dictionary<string, object>
                {
                    ["browser.cache.memory.capacity"]            = 32_768, // 32 MB HTTP cache
                    ["browser.sessionhistory.max_total_viewers"] = 1,      // bfcache: 1 page max
                    ["browser.sessionhistory.max_entries"]       = 10,
                    ["browser.tabs.max_tabs_undo"]               = 0,
                    ["network.http.speculative-parallel-limit"]  = 0,
                    ["network.prefetch-next"]                    = false,
                }
            });

            // 3. Create the browser context and page.
            var context = await browser.NewContextAsync(new BrowserNewContextOptions
            {
                ViewportSize = new ViewportSize { Width = width, Height = height },
                Locale       = "en-US",
                TimezoneId   = "America/New_York",
                ColorScheme  = ColorScheme.Light,
            });

            await context.AddInitScriptAsync(StealthScript.Js);

            var page    = await context.NewPageAsync();
            var session = new BrowserSession(sessionId, display, browser, context, page, width, height);
            _sessions[sessionId] = session;
            return session;
        }
        catch
        {
            // Clean up in reverse order to avoid leaking resources.
            if (browser is not null)
            {
                try { await browser.CloseAsync(); } catch { /* best-effort */ }
            }
            await display.DisposeAsync();
            throw;
        }
    }

    public BrowserSession? GetSession(string sessionId)
    {
        _sessions.TryGetValue(sessionId, out var s);
        return s;
    }

    public async Task TerminateSessionAsync(string sessionId)
    {
        if (_sessions.TryRemove(sessionId, out var session))
            await session.DisposeAsync();
    }

    // ── Disposal ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        foreach (var s in _sessions.Values)
            await s.DisposeAsync();

        _playwright?.Dispose();
    }
}
