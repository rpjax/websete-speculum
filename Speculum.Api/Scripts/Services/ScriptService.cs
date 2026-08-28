using System.Security.Cryptography;
using System.Text;
using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Scripts.Requests;
using Speculum.Api.Scripts.Responses;
using Speculum.Api.Scripts.Services.Contracts;
using Speculum.Api.Scripts.Storage;

namespace Speculum.Api.Scripts.Services;

public sealed class ScriptService : IScriptService
{
    internal const int MaxScriptBytes = 512 * 1024;
    public const int MaxUploadBytes = MaxScriptBytes;
    internal const int MaxScriptNameLength = 200;

    private readonly IScriptRepository _scripts;
    private readonly IConfigurationService? _configuration;
    private readonly TimeProvider _time;

    public ScriptService(
        IScriptRepository scripts,
        IConfigurationService? configuration = null,
        TimeProvider? time = null)
    {
        _scripts = scripts ?? throw new ArgumentNullException(nameof(scripts));
        _configuration = configuration;
        _time = time ?? TimeProvider.System;
    }

    public async Task<IResult<ScriptListItem>> CreateStoredScriptAsync(
        CreateStoredScript request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var name = request.Name.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return Result<ScriptListItem>.Failure("Script name is required");
        if (name.Length > MaxScriptNameLength)
            return Result<ScriptListItem>.Failure($"Script name must be <= {MaxScriptNameLength} characters");
        if (!name.EndsWith(".js", StringComparison.OrdinalIgnoreCase))
            return Result<ScriptListItem>.Failure("Script name must end with .js");

        var content = request.Content ?? string.Empty;
        if (string.IsNullOrWhiteSpace(content))
            return Result<ScriptListItem>.Failure("Script content is required");

        var size = Encoding.UTF8.GetByteCount(content);
        if (size > MaxScriptBytes)
            return Result<ScriptListItem>.Failure($"Script content exceeds {MaxScriptBytes} bytes");

        var now = _time.GetUtcNow();
        var record = new ScriptRecord
        {
            Id = Guid.NewGuid(),
            Name = name,
            Content = content,
            Sha256 = ComputeSha256(content),
            SizeBytes = size,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
        };

        await _scripts.SaveAsync(record, ct).ConfigureAwait(false);

        return Result<ScriptListItem>.Success(new ScriptListItem
        {
            Id = record.Id,
            Name = record.Name,
            Sha256 = record.Sha256,
            Size = record.SizeBytes,
            UploadedAt = record.CreatedAtUtc,
            UpdatedAt = record.UpdatedAtUtc,
        });
    }

    public async Task<IResult<ScriptPage>> ListScriptsAsync(
        ListScripts request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var skip = Math.Max(0, request.Skip);
        var take = request.Take <= 0
            ? ListScripts.DefaultTake
            : Math.Min(request.Take, ListScripts.MaxTake);

        var (items, total) = await _scripts.ListAsync(
            request.Query ?? string.Empty,
            skip,
            take,
            ct).ConfigureAwait(false);

        return Result<ScriptPage>.Success(new ScriptPage
        {
            Items = items,
            Total = total,
        });
    }

    public async Task<IResult> DeleteScriptAsync(
        DeleteScript request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.ScriptId == Guid.Empty)
            return Result.Failure("Script id is required");

        var scripting = _configuration?.GetCurrent().Scripting;
        if (scripting is not null
            && scripting.Injections.Any(injection =>
                injection.Source.SourceType == ScriptSourceType.Stored
                && injection.Source.StoredScriptId == request.ScriptId))
        {
            return Result.Failure("Script is referenced by Scripting.Injections");
        }

        var deleted = await _scripts.DeleteAsync(request.ScriptId, ct).ConfigureAwait(false);
        return deleted ? Result.Success() : Result.Failure("Script not found");
    }

    private static string ComputeSha256(string content)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
