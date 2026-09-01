using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Pre-session HTTP entry resolve only (StartSession path/query → absolute target URL).
/// In-session Resolve / ProjectToClient live in the sidecar — see motor-migration.md M1.
/// </summary>
public interface IUrlResolver
{
    /// <summary>
    /// Builds the target URL for the client path and query from the hub at session start.
    /// </summary>
    IResult<string> Resolve(string path, string query, string requestHost);
}
