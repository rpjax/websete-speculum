using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Application port for unary commands against a live session.
/// </summary>
/// <remarks>
/// <para>
/// Distinct from <see cref="ISessionService"/> (lifecycle start/stop) and
/// <see cref="Pipes.Services.Contracts.ISessionPipeService"/> (streams / input pumps).
/// Commands are session-scoped: they affect the shared sidecar connection, not a single pipe.
/// </para>
/// <para>
/// Mutating commands (navigate/resize/refresh/diag) serialize per session on an async
/// command gate. Status polls do not hold that gate across the sidecar RTT and do not
/// share the pipe lifecycle mutex.
/// </para>
/// <para>
/// Presentation calls this port; it must not inject <c>IBrowserClient</c> /
/// <c>ISessionConnection</c> directly. Host registers this service (with
/// <see cref="IUrlResolver"/>) alongside <see cref="ISessionService"/>.
/// </para>
/// </remarks>
public interface ISessionCommandService
{
    /// <summary>
    /// One-shot status snapshot. Not a stream — callers poll as needed.
    /// </summary>
    Task<IResult<SessionStatus>> GetStatusAsync(
        Guid sessionId,
        CancellationToken ct = default);

    /// <summary>
    /// Runtime navigation: resolves client path/query then commands the live browser.
    /// </summary>
    Task<IResult> NavigateAsync(
        NavigateSession request,
        CancellationToken ct = default);

    /// <summary>Reloads the current page.</summary>
    Task<IResult> RefreshAsync(
        Guid sessionId,
        CancellationToken ct = default);

    /// <summary>
    /// Correlated viewport resize. Returns confirmed geometry or a named failure.
    /// </summary>
    Task<IResult<ResizeResult>> ResizeAsync(
        ResizeSession request,
        CancellationToken ct = default);

    /// <summary>
    /// Sidecar diagnostics probe. Capability gating belongs above this port.
    /// </summary>
    Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        ProbeSession request,
        CancellationToken ct = default);
}
