using Aidan.Core.Patterns;
using MessagePack;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;

namespace Speculum.Api.Presentation.Sessions.Dtos;

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

/// <summary>Wire result for a successful start.</summary>
[MessagePackObject]
public sealed class StartSessionHubResponse
{
    [Key("sessionId")]
    public Guid SessionId { get; set; }

    [Key("token")]
    public string Token { get; set; } = string.Empty;
}

internal static class SessionHubRequestMapper
{
    public static StartSession ToStartSession(StartSessionHubRequest request) => new()
    {
        ProfileId = request.ProfileId,
        Path = request.Path ?? string.Empty,
        Query = request.Query ?? string.Empty,
        Configuration = new SessionConfig
        {
            Resolution = new ScreenResolution
            {
                Width = request.ViewportWidth,
                Height = request.ViewportHeight,
            },
            Device = request.Device,
        },
    };

    public static StopSession ToStopSession(StopSessionHubRequest request) => new()
    {
        SessionId = request.SessionId,
        Token = request.Token ?? string.Empty,
    };

    public static string FormatErrors(IResult result)
        => string.Join("; ", result.Errors.Select(static e => e.Message));
}
