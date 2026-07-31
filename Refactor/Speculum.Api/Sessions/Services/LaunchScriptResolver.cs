using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Scripts.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Builds the session script snapshot at Start: stored → literal content from SQLite;
/// remote → URL only (no HTTP fetch — sidecar injects src).
/// </summary>
public sealed class LaunchScriptResolver : ILaunchScriptResolver
{
    private readonly IServiceScopeFactory? _scopeFactory;

    public LaunchScriptResolver(IServiceScopeFactory? scopeFactory = null)
    {
        _scopeFactory = scopeFactory;
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

            switch (injection.Source.SourceType)
            {
                case ScriptSourceType.Stored:
                {
                    var content = await ResolveStoredAsync(injection.Source, ct).ConfigureAwait(false);
                    if (content.IsFailure)
                    {
                        return Result<IReadOnlyList<ScriptInjection>>.Failure(
                            $"Failed to resolve Scripting.Injections[{i}]: {content.Errors.FirstOrDefault() ?? "unknown error"}");
                    }

                    scripts.Add(new ScriptInjection
                    {
                        Position = MapPosition(injection.Position),
                        Type = MapType(injection.ExecutionType),
                        File = BuildStoredVirtualFile(injection.Source, i),
                        Content = content.Value,
                        RemoteUrl = null,
                        TargetRules = injection.TargetRules.ToArray(),
                    });
                    break;
                }
                case ScriptSourceType.Remote:
                {
                    if (injection.Source.RemoteUrl is null)
                    {
                        return Result<IReadOnlyList<ScriptInjection>>.Failure(
                            $"Failed to resolve Scripting.Injections[{i}]: Remote script url is required");
                    }

                    var remote = injection.Source.RemoteUrl.ToString();
                    scripts.Add(new ScriptInjection
                    {
                        Position = MapPosition(injection.Position),
                        Type = MapType(injection.ExecutionType),
                        File = remote,
                        Content = "",
                        RemoteUrl = remote,
                        TargetRules = injection.TargetRules.ToArray(),
                    });
                    break;
                }
                default:
                    return Result<IReadOnlyList<ScriptInjection>>.Failure(
                        $"Failed to resolve Scripting.Injections[{i}]: unsupported source type");
            }
        }

        return Result<IReadOnlyList<ScriptInjection>>.Success(scripts);
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

    private static string BuildStoredVirtualFile(ScriptSourceConfiguration source, int index)
    {
        return source.StoredScriptId is { } scriptId
            ? $"/__speculum/scripts/stored/{scriptId:D}.js"
            : $"/__speculum/scripts/{index + 1}.js";
    }

    private static string MapPosition(ScriptInjectionPosition position)
        => position switch
        {
            ScriptInjectionPosition.HeadStart => "HeaderTop",
            ScriptInjectionPosition.HeadEnd => "HeaderBottom",
            ScriptInjectionPosition.BodyStart => "BodyTop",
            ScriptInjectionPosition.BodyEnd => "BodyBottom",
            _ => throw new ArgumentOutOfRangeException(nameof(position), position, "Invalid script injection position"),
        };

    private static string MapType(ScriptExecutionType executionType)
        => executionType switch
        {
            ScriptExecutionType.Module => "Module",
            ScriptExecutionType.Classic => "Classic",
            _ => throw new ArgumentOutOfRangeException(nameof(executionType), executionType, "Invalid script execution type"),
        };
}
