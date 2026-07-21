using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Catalog;

/// <summary>
/// Builds <see cref="JournalEntryDescriptor"/> from <see cref="JournalFactAttribute"/> /
/// <see cref="JournalIndexAttribute"/> using reflection once at registration time.
/// </summary>
public static class JournalEntryDescriptorFactory
{
    private static readonly JsonSerializerOptions SharedOptions = CreateOptions();

    public static JournalEntryDescriptor FromClrType(Type clrType)
    {
        ArgumentNullException.ThrowIfNull(clrType);

        if (clrType.IsAbstract || clrType.IsInterface || clrType.IsGenericTypeDefinition)
        {
            throw new InvalidOperationException(
                $"Journal fact type '{clrType.FullName}' must be a concrete closed type.");
        }

        var fact = clrType.GetCustomAttribute<JournalFactAttribute>(inherit: false)
            ?? throw new InvalidOperationException(
                $"Type '{clrType.FullName}' is missing [{nameof(JournalFactAttribute)}].");

        // NullabilityInfoContext is not thread-safe — one instance per build.
        var nullability = new NullabilityInfoContext();
        var accessors = BuildIndexAccessors(clrType, nullability);
        var required = accessors.Where(a => a.Required).Select(a => a.KeyType).ToArray();
        var optional = accessors.Where(a => !a.Required).Select(a => a.KeyType).ToArray();

        if (accessors.GroupBy(a => a.KeyType, StringComparer.Ordinal).Any(g => g.Count() > 1))
        {
            throw new InvalidOperationException(
                $"Type '{clrType.FullName}' declares duplicate Journal index key types.");
        }

        return new JournalEntryDescriptor
        {
            Type = fact.Type,
            SchemaVersion = fact.SchemaVersion,
            Name = fact.Name,
            Description = fact.Description,
            Owner = fact.Owner,
            PublishPolicy = fact.PublishPolicy,
            EnabledByDefault = fact.EnabledByDefault,
            ClrType = clrType,
            PayloadJsonTypeInfo = SharedOptions.GetTypeInfo(clrType),
            RequiredIndexKeyTypes = required,
            OptionalIndexKeyTypes = optional,
            IndexAccessors = accessors,
        };
    }

    public static JournalEntryDescriptor FromClrType<T>()
        => FromClrType(typeof(T));

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
        };
        options.MakeReadOnly();
        return options;
    }

    private static IReadOnlyList<JournalIndexAccessor> BuildIndexAccessors(
        Type clrType,
        NullabilityInfoContext nullability)
    {
        var list = new List<JournalIndexAccessor>();

        foreach (var property in clrType.GetProperties(BindingFlags.Instance | BindingFlags.Public))
        {
            var attr = property.GetCustomAttribute<JournalIndexAttribute>(inherit: false);
            if (attr is null || !property.CanRead || property.GetIndexParameters().Length > 0)
                continue;

            var required = ResolveRequired(attr, property.PropertyType, () => nullability.Create(property));
            list.Add(CreateAccessor(attr, required, instance => property.GetValue(instance)));
        }

        var ctor = clrType.GetConstructors()
            .OrderByDescending(c => c.GetParameters().Length)
            .FirstOrDefault();

        if (ctor is null)
            return list;

        foreach (var parameter in ctor.GetParameters())
        {
            var attr = parameter.GetCustomAttribute<JournalIndexAttribute>(inherit: false);
            if (attr is null)
                continue;

            if (list.Any(a => string.Equals(a.KeyType, attr.Type, StringComparison.Ordinal)))
                continue;

            var property = clrType.GetProperty(
                parameter.Name!,
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.IgnoreCase);

            if (property is null || !property.CanRead)
            {
                throw new InvalidOperationException(
                    $"Constructor parameter '{parameter.Name}' on '{clrType.FullName}' " +
                    $"has [{nameof(JournalIndexAttribute)}] but no matching readable property.");
            }

            var required = ResolveRequired(attr, property.PropertyType, () => nullability.Create(parameter));
            list.Add(CreateAccessor(attr, required, instance => property.GetValue(instance)));
        }

        return list;
    }

    private static bool ResolveRequired(
        JournalIndexAttribute attr,
        Type memberType,
        Func<NullabilityInfo> nullability)
    {
        if (attr.Required is { } explicitRequired)
            return explicitRequired;

        if (Nullable.GetUnderlyingType(memberType) is not null)
            return false;

        if (!memberType.IsValueType)
        {
            var info = nullability();
            if (info.ReadState == NullabilityState.Nullable
                || info.WriteState == NullabilityState.Nullable)
            {
                return false;
            }
        }

        return true;
    }

    private static JournalIndexAccessor CreateAccessor(
        JournalIndexAttribute attr,
        bool required,
        Func<object, object?> readRaw)
    {
        var serializer = JournalIndexSerializerCache.Get(attr.Serializer);
        var format = attr.Format;

        return new JournalIndexAccessor
        {
            KeyType = attr.Type,
            Required = required,
            Read = instance =>
            {
                var raw = readRaw(instance);
                if (raw is null)
                    return null;

                if (raw is Guid guid && guid == Guid.Empty)
                    return null;

                var text = serializer.Serialize(raw, format);
                return string.IsNullOrWhiteSpace(text) ? null : text;
            },
        };
    }
}
