using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.ProfileStateRestored",
    schemaVersion: 1,
    Name = "Profile state restored",
    Description = "Persisted profile state was restored into the browser.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class ProfileStateRestored
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>Cookies present in the restore payload.</summary>
    public int CookieTotal { get; init; }

    /// <summary>Cookies dropped by sanitize (empty name, etc.).</summary>
    public int CookieSkipped { get; init; }

    /// <summary>Cookies kept after field normalization (SameSite/expires/secure).</summary>
    public int CookieNormalized { get; init; }

    /// <summary>Cookies accepted by CDP after sanitize.</summary>
    public int CookieApplied { get; init; }

    /// <summary>Sanitized cookies rejected individually by CDP after batch failure.</summary>
    public int CookieFailedIndividual { get; init; }
}
