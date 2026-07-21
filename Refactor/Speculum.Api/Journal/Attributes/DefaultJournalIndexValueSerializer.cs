using System.Globalization;

namespace Speculum.Api.Journal.Attributes;

/// <summary>
/// Default index value formatting used when no custom serializer is specified.
/// </summary>
public sealed class DefaultJournalIndexValueSerializer : IJournalIndexValueSerializer
{
    public static DefaultJournalIndexValueSerializer Instance { get; } = new();

    public string Serialize(object? value, string? format)
    {
        if (value is null)
            return "";

        return value switch
        {
            string s => s,
            Guid g => g.ToString(string.IsNullOrWhiteSpace(format) ? "D" : format),
            bool b => b ? "true" : "false",
            Enum e => string.Equals(format, "d", StringComparison.Ordinal)
                ? Convert.ToInt64(e, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture)
                : e.ToString(),
            IFormattable f => f.ToString(format, CultureInfo.InvariantCulture) ?? "",
            _ => value.ToString() ?? "",
        };
    }
}
