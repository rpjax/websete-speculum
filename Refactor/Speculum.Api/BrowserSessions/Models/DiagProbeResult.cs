using System.Text.Json;

namespace Speculum.Api.BrowserSessions.Models;

/// <summary>
/// Sidecar <c>diagResult</c> payload. Failures carry stable <see cref="ErrorCode"/> when present.
/// </summary>
public sealed class DiagProbeResult
{
    public required bool Ok { get; init; }

    /// <summary>Probe evidence sections when <see cref="Ok"/> is true.</summary>
    public JsonElement? Data { get; init; }

    public string? ErrorCode { get; init; }

    public string? Message { get; init; }
}
