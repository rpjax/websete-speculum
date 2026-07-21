namespace Speculum.Api.Journal.Attributes;

/// <summary>
/// Formats a payload member value as a Journal index key string.
/// Implementations must be stateless with a public parameterless constructor.
/// </summary>
public interface IJournalIndexValueSerializer
{
    string Serialize(object? value, string? format);
}
