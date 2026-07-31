using MessagePack;

namespace Speculum.Api.Sessions.Models;

/// <summary>Named navigate attempt outcome for hub / app callers.</summary>
public enum NavigateOutcome
{
    Applied = 0,
    /// <summary>URL resolve / allowlist / scheme failed before sidecar navigate.</summary>
    ResolveFailed = 1,
    /// <summary>Sidecar navigate command failed.</summary>
    NavigateFailed = 2,
}

/// <summary>Structured result for <c>NavigateAsync</c> (blocked main-frame redirects use Redirect hub events).</summary>
[MessagePackObject]
public sealed class NavigateResult
{
    [Key("applied")]
    public bool Applied { get; set; }

    [Key("outcome")]
    public NavigateOutcome Outcome { get; set; }

    [Key("url")]
    public string? Url { get; set; }

    [Key("errorCode")]
    public string? ErrorCode { get; set; }

    [Key("phase")]
    public string? Phase { get; set; }

    [Key("message")]
    public string? Message { get; set; }
}
