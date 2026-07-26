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

/// <summary>Wire result for a successful start.</summary>
[MessagePackObject]
public sealed class StartSessionHubResponse
{
    [Key("sessionId")]
    public Guid SessionId { get; set; }

    [Key("token")]
    public string Token { get; set; } = string.Empty;
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

    public static string FormatErrors(IResult result)
        => string.Join("; ", result.Errors.Select(static e => e.Message));
}
