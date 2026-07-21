using Microsoft.Extensions.Options;

namespace Speculum.Api.Database;

/// <summary>
/// Field-level validation for <see cref="DatabaseOptions"/> (ValidateOnStart).
/// </summary>
public sealed class DatabaseOptionsValidator : IValidateOptions<DatabaseOptions>
{
    public ValidateOptionsResult Validate(string? name, DatabaseOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var failures = new List<string>();

        if (string.IsNullOrWhiteSpace(options.Path))
            failures.Add($"{nameof(options.Path)} is required.");

        if (options.SqliteBusyTimeoutMs < 0)
            failures.Add($"{nameof(options.SqliteBusyTimeoutMs)} must be >= 0.");

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
