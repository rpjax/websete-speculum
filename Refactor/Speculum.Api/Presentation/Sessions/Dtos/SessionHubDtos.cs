using Aidan.Core.Patterns;
using MessagePack;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;

namespace Speculum.Api.Presentation.Sessions.Dtos;

/// <summary>Wire DTO for hub <c>EnsureProfileAsync</c>. Null id requests a new profile.</summary>
[MessagePackObject]
public sealed class EnsureProfileHubRequest
{
    [Key("profileId")]
    public Guid? ProfileId { get; set; }

    [Key("correlationId")]
    public string? CorrelationId { get; set; }
}

/// <summary>Wire result for <c>EnsureProfileAsync</c>.</summary>
[MessagePackObject]
public sealed class EnsureProfileHubResponse
{
    [Key("profileId")]
    public Guid ProfileId { get; set; }

    [Key("created")]
    public bool Created { get; set; }
}

/// <summary>Wire DTO for hub <c>StartSessionAsync</c>.</summary>
[MessagePackObject]
public sealed class StartSessionHubRequest
{
    [Key("profileId")]
    public Guid ProfileId { get; set; }

    /// <summary>Client pathname (no query), e.g. <c>/search</c>.</summary>
    [Key("path")]
    public string Path { get; set; } = string.Empty;

    /// <summary>Query without leading <c>?</c>, or empty.</summary>
    [Key("query")]
    public string Query { get; set; } = string.Empty;

    [Key("viewportWidth")]
    public int ViewportWidth { get; set; }

    [Key("viewportHeight")]
    public int ViewportHeight { get; set; }

    [Key("device")]
    public DeviceProfile? Device { get; set; }

    [Key("clientEnvironment")]
    public ClientEnvironmentHubRequest? ClientEnvironment { get; set; }
}

[MessagePackObject]
public sealed class ClientEnvironmentHubRequest
{
    [Key("locale")]
    public string? Locale { get; set; }

    [Key("language")]
    public string? Language { get; set; }

    [Key("timeZoneId")]
    public string? TimeZoneId { get; set; }

    [Key("colorScheme")]
    public string? ColorScheme { get; set; }

    [Key("geolocation")]
    public GeolocationHubRequest? Geolocation { get; set; }
}

[MessagePackObject]
public sealed class GeolocationHubRequest
{
    [Key("latitude")]
    public double Latitude { get; set; }

    [Key("longitude")]
    public double Longitude { get; set; }

    [Key("accuracy")]
    public double Accuracy { get; set; }
}

/// <summary>Wire DTO for hub <c>SendInputAsync</c> (user mouse/key/wheel/touch).</summary>
[MessagePackObject]
public sealed class SendInputHubRequest
{
    [Key("sessionId")]
    public Guid SessionId { get; set; }

    [Key("token")]
    public string Token { get; set; } = string.Empty;

    /// <summary>Event type — e.g. <c>mousemove</c>, <c>keydown</c>.</summary>
    [Key("type")]
    public string Type { get; set; } = string.Empty;

    /// <summary>JSON payload of the input event (same shape as WT UserInput).</summary>
    [Key("payload")]
    public string Payload { get; set; } = string.Empty;
}

/// <summary>Wire DTO for hub <c>StopSessionAsync</c>.</summary>
[MessagePackObject]
public sealed class StopSessionHubRequest
{
    [Key("sessionId")]
    public Guid SessionId { get; set; }

    [Key("token")]
    public string Token { get; set; } = string.Empty;
}

/// <summary>Wire DTO for hub <c>NavigateAsync</c> (runtime path/query navigation).</summary>
[MessagePackObject]
public sealed class NavigateSessionHubRequest
{
    [Key("sessionId")]
    public Guid SessionId { get; set; }

    [Key("token")]
    public string Token { get; set; } = string.Empty;

    /// <summary>Client pathname (no query), e.g. <c>/search</c>.</summary>
    [Key("path")]
    public string Path { get; set; } = string.Empty;

    /// <summary>Query without leading <c>?</c>, or empty.</summary>
    [Key("query")]
    public string Query { get; set; } = string.Empty;
}

/// <summary>Wire DTO for hub <c>ResizeAsync</c> (canvas 1:1 viewport sync).</summary>
[MessagePackObject]
public sealed class ResizeSessionHubRequest
{
    [Key("sessionId")]
    public Guid SessionId { get; set; }

    [Key("token")]
    public string Token { get; set; } = string.Empty;

    [Key("width")]
    public int Width { get; set; }

    [Key("height")]
    public int Height { get; set; }

    [Key("requestId")]
    public string? RequestId { get; set; }

    [Key("device")]
    public DeviceProfile? Device { get; set; }
}

/// <summary>Wire result for <c>ResizeAsync</c>.</summary>
[MessagePackObject]
public sealed class ResizeSessionHubResponse
{
    [Key("applied")]
    public bool Applied { get; set; }

    [Key("width")]
    public int Width { get; set; }

    [Key("height")]
    public int Height { get; set; }

    [Key("chromeWidth")]
    public int? ChromeWidth { get; set; }

    [Key("chromeHeight")]
    public int? ChromeHeight { get; set; }

    [Key("displayWidth")]
    public int? DisplayWidth { get; set; }

    [Key("displayHeight")]
    public int? DisplayHeight { get; set; }

    [Key("resizeId")]
    public string? ResizeId { get; set; }

    [Key("errorCode")]
    public string? ErrorCode { get; set; }

    [Key("phase")]
    public string? Phase { get; set; }

    [Key("message")]
    public string? Message { get; set; }
}

/// <summary>Wire result for a successful start.</summary>
[MessagePackObject]
public sealed class StartSessionHubResponse
{
    [Key("sessionId")]
    public Guid SessionId { get; set; }

    [Key("token")]
    public string Token { get; set; } = string.Empty;

    /// <summary><see cref="Configurations.Models.Sessions.ViewportPolicy.Minimum"/> width.</summary>
    [Key("viewportMinWidth")]
    public int ViewportMinWidth { get; set; }

    [Key("viewportMinHeight")]
    public int ViewportMinHeight { get; set; }

    /// <summary>Policy maximum — same capacity the sidecar allocates for Xvfb.</summary>
    [Key("viewportMaxWidth")]
    public int ViewportMaxWidth { get; set; }

    [Key("viewportMaxHeight")]
    public int ViewportMaxHeight { get; set; }
}

/// <summary>Server→client: sync the SPA address bar to the virtual browser URL.</summary>
[MessagePackObject]
public sealed class SyncUrlHubEvent
{
    [Key("url")]
    public string Url { get; set; } = string.Empty;
}

/// <summary>Server→client: navigate the real browser (e.g. allowlist block).</summary>
[MessagePackObject]
public sealed class RedirectHubEvent
{
    [Key("url")]
    public string Url { get; set; } = string.Empty;
}

/// <summary>Server→client: live session ended; client must clear local live state.</summary>
[MessagePackObject]
public sealed class SessionEndedHubEvent
{
    [Key("sessionId")]
    public Guid SessionId { get; set; }

    /// <summary><see cref="StopReason"/> stable string (e.g. <c>Faulted</c>).</summary>
    [Key("reason")]
    public string Reason { get; set; } = string.Empty;

    [Key("errorCode")]
    public string? ErrorCode { get; set; }

    [Key("message")]
    public string? Message { get; set; }
}

internal static class SessionHubRequestMapper
{
    public static StopSession ToStopSession(StopSessionHubRequest request) => new()
    {
        SessionId = request.SessionId,
        Token = request.Token ?? string.Empty,
    };

    public static NavigateSession ToNavigateSession(NavigateSessionHubRequest request) => new()
    {
        SessionId = request.SessionId,
        Path = request.Path ?? string.Empty,
        Query = request.Query ?? string.Empty,
    };

    public static ResizeSession ToResizeSession(ResizeSessionHubRequest request) => new()
    {
        Width = request.Width,
        Height = request.Height,
        RequestId = request.RequestId ?? string.Empty,
        Device = request.Device,
    };

    public static ResizeSessionHubResponse ToResizeResponse(ResizeResult result) => new()
    {
        Applied = result.Applied,
        Width = result.Width,
        Height = result.Height,
        ChromeWidth = result.ChromeWidth,
        ChromeHeight = result.ChromeHeight,
        DisplayWidth = result.DisplayWidth,
        DisplayHeight = result.DisplayHeight,
        ResizeId = result.ResizeId,
        ErrorCode = result.ErrorCode,
        Phase = result.Phase,
        Message = result.Message,
    };

    public static string FormatErrors(IResult result)
        => string.Join("; ", result.Errors.Select(static e => e.Message));
}
