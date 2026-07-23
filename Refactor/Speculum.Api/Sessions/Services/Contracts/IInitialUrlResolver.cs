using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Resolves the first navigation URL for a new live session.
/// Implemented by Motor (URL mapping / allowlist); not supplied by the start request.
/// </summary>
public interface IInitialUrlResolver
{
    /// <summary>
    /// Builds the Motor-mapped initial URL for <paramref name="sessionId"/>.
    /// </summary>
    IResult<string> Resolve(Guid sessionId, Guid profileId);
}
