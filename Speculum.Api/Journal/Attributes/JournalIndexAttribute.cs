namespace Speculum.Api.Journal.Attributes;

/// <summary>
/// Marks a property or record constructor parameter as a Journal index key projection.
/// </summary>
[AttributeUsage(
    AttributeTargets.Property | AttributeTargets.Parameter,
    Inherited = false,
    AllowMultiple = false)]
public sealed class JournalIndexAttribute : Attribute
{
    public JournalIndexAttribute(string type)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        Type = type;
    }

    /// <summary>Index key type stored on <c>JournalIndexKey.Type</c>.</summary>
    public string Type { get; }

    /// <summary>
    /// Optional format hint for built-in serializers (for example Guid <c>D</c>).
    /// </summary>
    public string? Format { get; set; }

    /// <summary>
    /// Optional <see cref="IJournalIndexValueSerializer"/> implementation
    /// (public parameterless constructor).
    /// </summary>
    public Type? Serializer { get; set; }

    /// <summary>
    /// When null, requiredness is inferred from the member CLR nullability
    /// (nullable value types and annotated nullable references are optional).
    /// </summary>
    public bool? Required { get; set; }
}
