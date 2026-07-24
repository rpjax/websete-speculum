namespace Speculum.Api.Sessions.Responses;

public sealed class StartSessionResponse
{
    public Guid SessionId { get; init; }
    public string Token { get; init; } = string.Empty;
}
