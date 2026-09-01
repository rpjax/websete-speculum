using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services.Contracts;

public interface IRemoteScriptFetcher
{
    Task<IResult<string>> FetchAsync(Uri remoteUrl, CancellationToken ct = default);
}
