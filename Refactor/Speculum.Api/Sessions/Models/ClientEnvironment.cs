namespace Speculum.Api.Sessions.Models;

public sealed class ClientEnvironment
{
    public required string Locale { get; init; }
    public required string Language { get; init; }
    public required string TimeZoneId { get; init; }
    public required string ColorScheme { get; init; }
    public Geolocation? Geolocation { get; init; }
}
