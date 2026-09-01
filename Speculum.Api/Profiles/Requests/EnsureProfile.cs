namespace Speculum.Api.Profiles.Requests;

/// <summary>
/// Client asks to resolve a persisted profile for the next <c>StartSession</c>.
/// Null/empty <see cref="ProfileId"/> means first contact; unknown ids never bind
/// to the caller's value (a server-generated id is issued instead).
/// </summary>
public sealed class EnsureProfile
{
    /// <summary>Profile id the client persisted from a previous generation; null on first contact.</summary>
    public Guid? ProfileId { get; set; }

    /// <summary>Optional client correlation id projected onto profile journal facts.</summary>
    public string? CorrelationId { get; set; }
}
