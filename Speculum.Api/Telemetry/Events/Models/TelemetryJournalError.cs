using Aidan.Core.Errors;

namespace Speculum.Api.Telemetry.Events.Models;

/// <summary>Compact error projection for Telemetry Journal fact payloads.</summary>
public sealed class TelemetryJournalError
{
    public required string Code { get; init; }
    public required string Message { get; init; }

    public static TelemetryJournalError[] From(Error[] errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (errors.Length == 0)
            return Array.Empty<TelemetryJournalError>();

        var mapped = new TelemetryJournalError[errors.Length];
        for (var i = 0; i < errors.Length; i++)
        {
            var error = errors[i];
            mapped[i] = new TelemetryJournalError
            {
                Code = error.Code ?? string.Empty,
                Message = error.Message ?? string.Empty,
            };
        }
        return mapped;
    }

    public static TelemetryJournalError[] From(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        var root = exception is AggregateException aggregate
            ? aggregate.GetBaseException()
            : exception;
        return
        [
            new TelemetryJournalError
            {
                Code = root.GetType().Name,
                Message = root.Message ?? string.Empty,
            },
        ];
    }
}
