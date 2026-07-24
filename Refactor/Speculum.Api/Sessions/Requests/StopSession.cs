namespace Speculum.Api.Sessions.Requests;

public sealed class StopSession
{
    public Guid SessionId { get; set; }
    public string Token { get; set; } = string.Empty;
}
