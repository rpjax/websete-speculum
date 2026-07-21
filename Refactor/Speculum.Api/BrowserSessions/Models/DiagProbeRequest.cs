namespace Speculum.Api.BrowserSessions.Models;

/// <summary>
/// Sidecar <c>diagProbe</c> request. Capability gating and probe budgets live above this port.
/// </summary>
public sealed class DiagProbeRequest
{
    public required IReadOnlyList<string> Ops { get; init; }

    /// <summary>Required when <c>evaluate</c> is in <see cref="Ops"/>.</summary>
    public string? EvaluateExpression { get; init; }

    /// <summary>Required when <c>dom</c> is in <see cref="Ops"/>.</summary>
    public string? DomSelector { get; init; }

    /// <summary>Optional cap on serialized probe response bytes (sidecar default 512 KiB).</summary>
    public int? MaxProbeResponseBytes { get; init; }
}
