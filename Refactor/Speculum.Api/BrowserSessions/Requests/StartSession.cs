using Speculum.Api.BrowserSessions.Models;

namespace Speculum.Api.BrowserSessions.Requests;

public sealed class StartSession
{
    public Guid ProfileId { get; set; }
    public SessionConfig? Configuration { get; set; }
}

public sealed class StopSession
{
    public Guid SessionId { get; set; }
    public string Token { get; set; } = string.Empty;
}
