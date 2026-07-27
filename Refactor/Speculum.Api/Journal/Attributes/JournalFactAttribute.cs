using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Attributes;

/// <summary>
/// Declares a CLR type as a toggleable Journal fact (off until config Apply).
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, Inherited = false, AllowMultiple = false)]
public sealed class JournalFactAttribute : Attribute
{
    public JournalFactAttribute(string type, int schemaVersion)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        ArgumentOutOfRangeException.ThrowIfLessThan(schemaVersion, 1);
        Type = type;
        SchemaVersion = schemaVersion;
    }

    public string Type { get; }
    public int SchemaVersion { get; }
    public string? Name { get; set; }
    public string? Description { get; set; }
    public string? Owner { get; set; }
    public PublishPolicy PublishPolicy { get; set; } = PublishPolicy.BestEffort;
}

/// <summary>
/// Canonical lifecycle / narrative fact: always enabled in the catalog; not toggleable.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, Inherited = false, AllowMultiple = false)]
public sealed class CanonicalFactAttribute : Attribute
{
    public CanonicalFactAttribute(string type, int schemaVersion)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        ArgumentOutOfRangeException.ThrowIfLessThan(schemaVersion, 1);
        Type = type;
        SchemaVersion = schemaVersion;
    }

    public string Type { get; }
    public int SchemaVersion { get; }
    public string? Name { get; set; }
    public string? Description { get; set; }
    public string? Owner { get; set; }
    public PublishPolicy PublishPolicy { get; set; } = PublishPolicy.Guaranteed;
}
