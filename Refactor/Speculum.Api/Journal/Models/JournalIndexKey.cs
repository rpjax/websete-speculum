namespace Speculum.Api.Journal.Models;

/// <summary>
/// One secondary index entry projecting an entity involved in a Journal fact.
/// </summary>
public readonly struct JournalIndexKey : IEquatable<JournalIndexKey>
{
    public JournalIndexKey(string type, string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        Type = type;
        Value = value;
    }

    public string Type { get; }
    public string Value { get; }

    public bool Equals(JournalIndexKey other)
        => string.Equals(Type, other.Type, StringComparison.Ordinal)
           && string.Equals(Value, other.Value, StringComparison.Ordinal);

    public override bool Equals(object? obj)
        => obj is JournalIndexKey other && Equals(other);

    public override int GetHashCode()
        => HashCode.Combine(
            StringComparer.Ordinal.GetHashCode(Type),
            StringComparer.Ordinal.GetHashCode(Value));

    public static bool operator ==(JournalIndexKey left, JournalIndexKey right)
        => left.Equals(right);

    public static bool operator !=(JournalIndexKey left, JournalIndexKey right)
        => !left.Equals(right);

    public override string ToString() => $"{Type}={Value}";
}
