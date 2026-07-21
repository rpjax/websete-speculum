using Microsoft.Extensions.Options;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Field-level validation for <see cref="JournalDrainOptions"/> (ValidateOnStart).
/// </summary>
public sealed class JournalDrainOptionsValidator : IValidateOptions<JournalDrainOptions>
{
    public ValidateOptionsResult Validate(string? name, JournalDrainOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var failures = new List<string>();

        if (options.MaxBatchSize < 1)
            failures.Add($"{nameof(options.MaxBatchSize)} must be >= 1.");

        if (options.SoftQueueDepth < 0)
            failures.Add($"{nameof(options.SoftQueueDepth)} must be >= 0 (0 disables soft shedding).");

        if (options.HardQueueDepth < 0)
            failures.Add($"{nameof(options.HardQueueDepth)} must be >= 0 (0 disables hard pressure).");

        if (options.MaxQueueDepth < 0)
            failures.Add($"{nameof(options.MaxQueueDepth)} must be >= 0 (0 disables the absolute ceiling).");

        if (options.HardQueueDepth > 0
            && options.SoftQueueDepth > 0
            && options.HardQueueDepth < options.SoftQueueDepth)
        {
            failures.Add(
                $"{nameof(options.HardQueueDepth)} must be >= {nameof(options.SoftQueueDepth)} when both are enabled.");
        }

        if (options.MaxQueueDepth > 0
            && options.HardQueueDepth > 0
            && options.MaxQueueDepth < options.HardQueueDepth)
        {
            failures.Add(
                $"{nameof(options.MaxQueueDepth)} must be >= {nameof(options.HardQueueDepth)} when both are enabled.");
        }

        if (options.MaxQueueDepth > 0
            && options.SoftQueueDepth > 0
            && options.MaxQueueDepth < options.SoftQueueDepth)
        {
            failures.Add(
                $"{nameof(options.MaxQueueDepth)} must be >= {nameof(options.SoftQueueDepth)} when both are enabled.");
        }

        if (options.MaxPersistAttempts < 1)
            failures.Add($"{nameof(options.MaxPersistAttempts)} must be >= 1.");

        if (options.MaxCrashesInPeriod < 1)
            failures.Add($"{nameof(options.MaxCrashesInPeriod)} must be >= 1.");

        if (options.CrashPeriod <= TimeSpan.Zero)
            failures.Add($"{nameof(options.CrashPeriod)} must be > 0.");

        if (options.CrashRestartBackoff < TimeSpan.Zero)
            failures.Add($"{nameof(options.CrashRestartBackoff)} must be >= 0.");

        if (options.RecoverAfterSuccessfulBatches < 1)
            failures.Add($"{nameof(options.RecoverAfterSuccessfulBatches)} must be >= 1.");

        if (options.DegradedBestEffortKeep < 0)
            failures.Add($"{nameof(options.DegradedBestEffortKeep)} must be >= 0.");

        if (options.ShutdownFlushTimeout <= TimeSpan.Zero)
            failures.Add($"{nameof(options.ShutdownFlushTimeout)} must be > 0.");

        if (options.RetryBackoff < TimeSpan.Zero)
            failures.Add($"{nameof(options.RetryBackoff)} must be >= 0.");

        if (options.MaxPayloadBytes < 1)
            failures.Add($"{nameof(options.MaxPayloadBytes)} must be >= 1.");

        if (options.DefaultReadLimit < 1)
            failures.Add($"{nameof(options.DefaultReadLimit)} must be >= 1.");

        if (options.MaxReadLimit < 1)
            failures.Add($"{nameof(options.MaxReadLimit)} must be >= 1.");

        if (options.DefaultReadLimit > options.MaxReadLimit)
            failures.Add($"{nameof(options.DefaultReadLimit)} must be <= {nameof(options.MaxReadLimit)}.");

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
