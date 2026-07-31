using System.Net;
using System.Text;
using Aidan.Core.Patterns;
using Speculum.Api.Scripts.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Optional HTTP fetch helper. Session Start does not fetch remotes (sidecar loads
/// <c>src</c>); kept for tests and any future admin preview path.
/// </summary>
public sealed class RemoteScriptFetcher : IRemoteScriptFetcher
{
    public const string HttpClientName = nameof(RemoteScriptFetcher);

    private readonly IHttpClientFactory _httpClientFactory;

    public RemoteScriptFetcher(IHttpClientFactory httpClientFactory)
    {
        _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
    }

    public async Task<IResult<string>> FetchAsync(Uri remoteUrl, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(remoteUrl);

        var hostCheck = await ValidatePublicHttpUrlAsync(remoteUrl, ct).ConfigureAwait(false);
        if (hostCheck.IsFailure)
            return hostCheck;

        using var client = _httpClientFactory.CreateClient(HttpClientName);
        using var response = await client.GetAsync(
            remoteUrl,
            HttpCompletionOption.ResponseHeadersRead,
            ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            return Result<string>.Failure(
                $"Remote script fetch failed with status {(int)response.StatusCode}");
        }

        if (response.Content.Headers.ContentLength is { } declared
            && declared > ScriptService.MaxScriptBytes)
        {
            return Result<string>.Failure(
                $"Remote script exceeds {ScriptService.MaxScriptBytes} bytes");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        using var limited = new MemoryStream(capacity: Math.Min(ScriptService.MaxScriptBytes, 64 * 1024));
        var buffer = new byte[16 * 1024];
        var total = 0;
        while (true)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false);
            if (read == 0)
                break;

            total += read;
            if (total > ScriptService.MaxScriptBytes)
            {
                return Result<string>.Failure(
                    $"Remote script exceeds {ScriptService.MaxScriptBytes} bytes");
            }

            await limited.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
        }

        return Result<string>.Success(Encoding.UTF8.GetString(limited.ToArray()));
    }

    internal static async Task<IResult<string>> ValidatePublicHttpUrlAsync(
        Uri remoteUrl,
        CancellationToken ct = default)
    {
        var check = await PublicHttpUrlPolicy.ValidateAsync(remoteUrl, ct).ConfigureAwait(false);
        return check.IsFailure
            ? Result<string>.Failure(check.Errors.FirstOrDefault() ?? "Remote script url host is not allowed")
            : Result<string>.Success(string.Empty);
    }

    internal static bool IsPublicIp(IPAddress address)
        => PublicHttpUrlPolicy.IsPublicIp(address);
}
