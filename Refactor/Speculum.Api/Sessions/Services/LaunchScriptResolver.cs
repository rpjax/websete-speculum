using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Scripts.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class LaunchScriptResolver : ILaunchScriptResolver
{
    private readonly IServiceScopeFactory? _scopeFactory;
    private readonly IRemoteScriptFetcher? _remoteScripts;

    public LaunchScriptResolver(
        IServiceScopeFactory? scopeFactory = null,
        IRemoteScriptFetcher? remoteScripts = null)
    {
        _scopeFactory = scopeFactory;
        _remoteScripts = remoteScripts;
    }

    public async Task<IResult<IReadOnlyList<ScriptInjection>>> ResolveAsync(
        ScriptingConfiguration configuration,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        if (configuration.Injections.Count == 0)
        {
            return Result<IReadOnlyList<ScriptInjection>>.Success(
                Array.Empty<ScriptInjection>());
        }

        var scripts = new List<ScriptInjection>(configuration.Injections.Count);
        for (var i = 0; i < configuration.Injections.Count; i++)
        {
            var injection = configuration.Injections[i];
            var content = await ResolveContentAsync(injection.Source, ct).ConfigureAwait(false);
            if (content.IsFailure)
            {
                return Result<IReadOnlyList<ScriptInjection>>.Failure(
                    $"Failed to resolve Scripting.Injections[{i}]: {content.Errors.FirstOrDefault() ?? "unknown error"}");
            }

            if (!Enum.IsDefined(injection.Position) || !Enum.IsDefined(injection.ExecutionType))
            {
                return Result<IReadOnlyList<ScriptInjection>>.Failure(
                    $"Failed to resolve Scripting.Injections[{i}]: invalid position or execution type");
            }

            if (injection.TargetRules.Count == 0)
            {
                return Result<IReadOnlyList<ScriptInjection>>.Failure(
                    $"Failed to resolve Scripting.Injections[{i}]: TargetRules must contain at least one rule");
            }

            scripts.Add(new ScriptInjection
            {
                Position = MapPosition(injection.Position),
                Type = MapType(injection.ExecutionType),
                File = BuildVirtualFile(injection.Source, i),
                Content = content.Value,
                TargetRules = injection.TargetRules.ToArray(),
            });
        }

        return Result<IReadOnlyList<ScriptInjection>>.Success(scripts);
    }

    private async Task<IResult<string>> ResolveContentAsync(
        ScriptSourceConfiguration source,
        CancellationToken ct)
    {
        return source.SourceType switch
        {
            ScriptSourceType.Stored => await ResolveStoredAsync(source, ct).ConfigureAwait(false),
            ScriptSourceType.Remote => await ResolveRemoteAsync(source, ct).ConfigureAwait(false),
            _ => Result<string>.Failure($"Unsupported script source type '{source.SourceType}'"),
        };
    }

    private async Task<IResult<string>> ResolveStoredAsync(
        ScriptSourceConfiguration source,
        CancellationToken ct)
    {
        if (source.StoredScriptId is not { } scriptId || scriptId == Guid.Empty)
        {
            return Result<string>.Failure("Stored script id is required");
        }

        if (_scopeFactory is null)
        {
            return Result<string>.Failure("Stored script resolution is unavailable");
        }

        using var scope = _scopeFactory.CreateScope();
        var repository = scope.ServiceProvider.GetService<IScriptRepository>();
        if (repository is null)
        {
            return Result<string>.Failure("Script repository is unavailable");
        }

        var record = await repository.LoadAsync(scriptId, ct).ConfigureAwait(false);
        return record is null
            ? Result<string>.Failure($"Stored script '{scriptId:D}' was not found")
            : Result<string>.Success(record.Content);
    }

    private async Task<IResult<string>> ResolveRemoteAsync(
        ScriptSourceConfiguration source,
        CancellationToken ct)
    {
        if (source.RemoteUrl is null)
        {
            return Result<string>.Failure("Remote script url is required");
        }

        if (_remoteScripts is null)
        {
            return Result<string>.Failure("Remote script resolution is unavailable");
        }

        return await _remoteScripts.FetchAsync(source.RemoteUrl, ct).ConfigureAwait(false);
    }

    private static string BuildVirtualFile(ScriptSourceConfiguration source, int index)
    {
        return source.SourceType switch
        {
            ScriptSourceType.Stored when source.StoredScriptId is { } scriptId
                => $"/__speculum/scripts/stored/{scriptId:D}.js",
            ScriptSourceType.Remote when source.RemoteUrl is { } remoteUrl
                => $"/__speculum/scripts/remote/{index + 1}-{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(remoteUrl.ToString()))).ToLowerInvariant()}.js",
            _ => $"/__speculum/scripts/{index + 1}.js",
        };
    }

    private static string MapPosition(ScriptInjectionPosition position)
    {
        if (!Enum.IsDefined(position))
        {
            throw new ArgumentOutOfRangeException(nameof(position), position, "Invalid script injection position");
        }

        return position switch
        {
            ScriptInjectionPosition.HeadStart => "HeaderTop",
            ScriptInjectionPosition.HeadEnd => "HeaderBottom",
            ScriptInjectionPosition.BodyStart => "BodyTop",
            ScriptInjectionPosition.BodyEnd => "BodyBottom",
            _ => throw new ArgumentOutOfRangeException(nameof(position), position, "Invalid script injection position"),
        };
    }

    private static string MapType(ScriptExecutionType executionType)
    {
        if (!Enum.IsDefined(executionType))
        {
            throw new ArgumentOutOfRangeException(nameof(executionType), executionType, "Invalid script execution type");
        }

        return executionType switch
        {
            ScriptExecutionType.Module => "Module",
            ScriptExecutionType.Classic => "Classic",
            _ => throw new ArgumentOutOfRangeException(nameof(executionType), executionType, "Invalid script execution type"),
        };
    }
}
