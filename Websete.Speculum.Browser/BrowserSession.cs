using Microsoft.Playwright;

namespace Websete.Speculum.Browser;

/// <summary>
/// Represents one isolated browser session.
///
/// Each session owns a dedicated Xvfb virtual display, a dedicated Firefox
/// browser process (so its rendering is visually isolated), a browser context,
/// and a single page. FFmpeg captures the Xvfb display externally — this class
/// has no screenshot responsibility.
/// </summary>
public sealed class BrowserSession : IAsyncDisposable
{
    private readonly IPage           _page;
    private readonly IBrowserContext _context;
    private readonly IBrowser        _browser;
    private readonly XvfbDisplay     _display;

    public string SessionId     { get; }
    public int    DisplayNumber => _display.Number;
    public int    Width         { get; }
    public int    Height        { get; }
    public string CurrentUrl    => _page.Url;

    internal BrowserSession(
        string          sessionId,
        XvfbDisplay     display,
        IBrowser        browser,
        IBrowserContext context,
        IPage           page,
        int             width,
        int             height)
    {
        SessionId = sessionId;
        _display  = display;
        _browser  = browser;
        _context  = context;
        _page     = page;
        Width     = width;
        Height    = height;
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    public Task NavigateAsync(string url) =>
        _page.GotoAsync(url, new PageGotoOptions { Timeout = 30_000 });

    // ── Input ─────────────────────────────────────────────────────────────────

    public Task ClickAsync(float x, float y)   => _page.Mouse.ClickAsync(x, y);
    public Task MoveAsync(float x, float y)    => _page.Mouse.MoveAsync(x, y);
    public Task WheelAsync(float dx, float dy) => _page.Mouse.WheelAsync(dx, dy);
    public Task KeyPressAsync(string key)      => _page.Keyboard.PressAsync(key);
    public Task TypeAsync(string text)         => _page.Keyboard.TypeAsync(text);

    // ── Disposal ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        await _context.CloseAsync();
        await _browser.CloseAsync();
        await _display.DisposeAsync();
    }
}
