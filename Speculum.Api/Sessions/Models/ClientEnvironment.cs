namespace Speculum.Api.Sessions.Models;

public sealed class ClientEnvironment
{
    public required string Locale { get; init; }
    public required string Language { get; init; }
    public required string TimeZoneId { get; init; }
    public required string ColorScheme { get; init; }
    /// <summary>Optional BCP-47 tags for Accept-Language (mimic soft).</summary>
    public IReadOnlyList<string> Languages { get; init; } = Array.Empty<string>();
    public Geolocation? Geolocation { get; init; }
}
