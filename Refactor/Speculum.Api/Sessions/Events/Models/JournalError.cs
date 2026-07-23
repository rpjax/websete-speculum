using Aidan.Core.Errors;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>Compact error projection for Journal fact payloads.</summary>
public sealed class JournalError
{
    public required string Code { get; init; }
    public required string Message { get; init; }

    public static JournalError[] From(Error[] errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (errors.Length == 0)
        {
            return Array.Empty<JournalError>();
        }

        var mapped = new JournalError[errors.Length];
        for (var i = 0; i < errors.Length; i++)
        {
            var error = errors[i];
            mapped[i] = new JournalError
            {
                Code = error.Code ?? string.Empty,
                Message = error.Message ?? string.Empty,
            };
        }

        return mapped;
    }
}
