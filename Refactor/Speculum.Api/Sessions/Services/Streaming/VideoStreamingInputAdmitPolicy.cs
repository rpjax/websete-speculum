using System.Text.Json;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Admission policy for inbound video-streaming input: high-frequency samples are droppable;
/// gesture edges (releases) are preserved when the queue is under pressure.
/// </summary>
internal static class VideoStreamingInputAdmitPolicy
{
    public static bool IsHighFrequency(VideoStreamingInput input)
    {
        if (string.Equals(input.Type, "mousemove", StringComparison.Ordinal))
        {
            return true;
        }

        if (!string.Equals(input.Type, "touch", StringComparison.Ordinal))
        {
            return false;
        }

        return string.Equals(TryTouchPhase(input), "move", StringComparison.Ordinal);
    }

    public static bool IsReleaseEdge(VideoStreamingInput input)
    {
        if (string.Equals(input.Type, "mouseup", StringComparison.Ordinal)
            || string.Equals(input.Type, "keyup", StringComparison.Ordinal))
        {
            return true;
        }

        if (!string.Equals(input.Type, "touch", StringComparison.Ordinal))
        {
            return false;
        }

        var phase = TryTouchPhase(input);
        return string.Equals(phase, "end", StringComparison.Ordinal)
            || string.Equals(phase, "cancel", StringComparison.Ordinal);
    }

    public static string? TryTouchPhase(VideoStreamingInput input)
    {
        if (!string.Equals(input.Type, "touch", StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(input.Payload))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(input.Payload);
            if (doc.RootElement.TryGetProperty("phase", out var phase)
                && phase.ValueKind == JsonValueKind.String)
            {
                return phase.GetString();
            }
        }
        catch (JsonException)
        {
            // Optional metadata for admission policy.
        }

        return null;
    }
}
