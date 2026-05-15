using Microsoft.AspNetCore.Mvc;
using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Virtualization.Controllers;

[ApiController]
public sealed class VirtualizationController : ControllerBase
{
    private readonly SidecarService _sidecar;

    public VirtualizationController(SidecarService sidecar)
        => _sidecar = sidecar;

    /// <summary>Returns basic health information and active session count.</summary>
    [HttpGet("/status")]
    public IActionResult Status() =>
        Ok(new { status = "ok", activeSessions = _sidecar.ActiveSessions });
}
