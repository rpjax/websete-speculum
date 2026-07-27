using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>
/// The live-session feature loop exited with an unexpected fault.
/// </summary>
[CanonicalFact(
    "Sessions.FeatureLoopFaulted",
    schemaVersion: 1,
    Name = "Feature loop faulted",
    Description = "The attached-client feature loop terminated with an unexpected exception.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class FeatureLoopFaulted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required JournalError[] Errors { get; init; }
}
