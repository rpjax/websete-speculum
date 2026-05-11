using Microsoft.AspNetCore.Mvc;
using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Controllers;

[ApiController]
public class VirtualizationController : ControllerBase
{
    private BrowserService _browserService { get; }

    public VirtualizationController(BrowserService browserService)
    {
        _browserService = browserService;
    }

    // ── Endpoints ─────────────────────────────────────────────────────────────

    [HttpGet("/status")]
    public IActionResult Status() =>
        Ok(new { status = "ok", activeSessions = _browserService.ActiveSessions });

    [HttpGet("/virtualization")]
    public async Task<ActionResult> GetVirtualizationPage()
    {
        var html = await System.IO.File.ReadAllTextAsync("wwwroot/virtualization.html");
        return Content(html, "text/html");
    }
}
