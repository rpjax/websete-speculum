using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Catalog;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Services;

public sealed class JournalCatalog : IJournalCatalog
{
    private readonly ConcurrentDictionary<(string Type, int Version), JournalEntryDescriptor> _byFactKey = new();
    private readonly ConcurrentDictionary<Type, JournalEntryDescriptor> _byClrType = new();
    private readonly ConcurrentDictionary<string, bool> _enabledByType = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public bool RejectUnregisteredTypes { get; set; } = true;

    public IReadOnlyList<JournalEntryDescriptor> Types
    {
        get
        {
            return _byFactKey.Values
                .OrderBy(d => d.Type, StringComparer.Ordinal)
                .ThenBy(d => d.SchemaVersion)
                .ToArray();
        }
    }

    public void Register(JournalEntryDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentException.ThrowIfNullOrWhiteSpace(descriptor.Type);
        ArgumentOutOfRangeException.ThrowIfLessThan(descriptor.SchemaVersion, 1);
        ArgumentNullException.ThrowIfNull(descriptor.ClrType);
        ArgumentNullException.ThrowIfNull(descriptor.PayloadJsonTypeInfo);

        if (descriptor.ClrType.IsAbstract || descriptor.ClrType.IsInterface || descriptor.ClrType.IsGenericTypeDefinition)
        {
            throw new InvalidOperationException(
                $"Journal fact CLR type '{descriptor.ClrType.FullName}' must be a concrete closed type.");
        }

        if (descriptor.PayloadJsonTypeInfo.Type != descriptor.ClrType)
        {
            throw new InvalidOperationException(
                $"Payload JsonTypeInfo type '{descriptor.PayloadJsonTypeInfo.Type}' does not match ClrType '{descriptor.ClrType}'.");
        }

        var factKey = (descriptor.Type, descriptor.SchemaVersion);

        lock (_gate)
        {
            if (!_byFactKey.TryAdd(factKey, descriptor))
            {
                throw new InvalidOperationException(
                    $"Journal fact '{descriptor.Type}' version {descriptor.SchemaVersion} is already registered.");
            }

            if (!_byClrType.TryAdd(descriptor.ClrType, descriptor))
            {
                _byFactKey.TryRemove(factKey, out _);
                throw new InvalidOperationException(
                    $"CLR type '{descriptor.ClrType.FullName}' is already registered in the Journal catalog.");
            }

            // First registration seeds enablement; later versions / SetEnabled must not be clobbered.
            _enabledByType.TryAdd(descriptor.Type, descriptor.EnabledByDefault);
        }
    }

    public void Register(Type clrType)
        => Register(JournalEntryDescriptorFactory.FromClrType(clrType));

    public void Register<T>()
        => Register(typeof(T));

    public void RegisterFromAssemblies(params Assembly[] assemblies)
    {
        ArgumentNullException.ThrowIfNull(assemblies);

        foreach (var assembly in assemblies)
        {
            if (assembly is null)
                continue;

            Type[] types;
            try
            {
                types = assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                types = ex.Types.Where(t => t is not null).Cast<Type>().ToArray();
            }

            foreach (var type in types)
            {
                if (type is null
                    || type.IsAbstract
                    || type.IsInterface
                    || type.IsGenericTypeDefinition)
                {
                    continue;
                }

                if (type.GetCustomAttribute<JournalFactAttribute>(inherit: false) is null)
                    continue;

                Register(type);
            }
        }
    }

    public bool TryGet(
        string type,
        int schemaVersion,
        [NotNullWhen(true)] out JournalEntryDescriptor? descriptor)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        ArgumentOutOfRangeException.ThrowIfLessThan(schemaVersion, 1);
        return _byFactKey.TryGetValue((type, schemaVersion), out descriptor);
    }

    public bool TryGet(Type clrType, [NotNullWhen(true)] out JournalEntryDescriptor? descriptor)
    {
        ArgumentNullException.ThrowIfNull(clrType);
        return _byClrType.TryGetValue(clrType, out descriptor);
    }

    public bool TryGet<T>([NotNullWhen(true)] out JournalEntryDescriptor? descriptor)
        => TryGet(typeof(T), out descriptor);

    public bool IsTypeEnabled(string type)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        return _enabledByType.TryGetValue(type, out var enabled) && enabled;
    }

    public void SetEnabled(string type, bool enabled)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);

        // Register always seeds enablement; absence means the fact type is unknown.
        if (!_enabledByType.ContainsKey(type))
        {
            throw new InvalidOperationException(
                $"Cannot set enablement for unknown Journal fact type '{type}'.");
        }

        _enabledByType[type] = enabled;
    }

    public bool IsEnabled(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return IsTypeEnabled(entry.Type);
    }
}
