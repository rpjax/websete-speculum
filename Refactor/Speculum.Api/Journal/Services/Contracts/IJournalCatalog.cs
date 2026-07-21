using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Catalog;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Services.Contracts;

/// <summary>
/// Application-facing registry of known Journal fact schemas and their enablement.
/// </summary>
/// <remarks>
/// <para>
/// Descriptors live in process memory only. Enablement toggles may be driven by the
/// Configurations module at boot/runtime via <see cref="SetEnabled"/>; the catalog itself
/// is not a SQLite table and is not the Diagnostics capability catalog.
/// </para>
/// <para>
/// <see cref="IJournalWriter"/> resolves descriptors by CLR type on
/// <c>Append&lt;T&gt;</c> and consults <see cref="IsTypeEnabled"/> before enqueue.
/// All schema versions of a fact <c>Type</c> share one enablement toggle.
/// First registration seeds enablement from <c>EnabledByDefault</c>; later versions do not clobber it.
/// </para>
/// </remarks>
public interface IJournalCatalog
{
    /// <summary>
    /// When true, Append of an unregistered CLR type throws.
    /// </summary>
    bool RejectUnregisteredTypes { get; set; }

    /// <summary>
    /// All registered descriptors (stable order by Type, SchemaVersion).
    /// </summary>
    IReadOnlyList<JournalEntryDescriptor> Types { get; }

    /// <summary>
    /// Registers a fully built descriptor. Duplicate fact Type+version or CLR type throws.
    /// </summary>
    void Register(JournalEntryDescriptor descriptor);

    /// <summary>
    /// Builds a descriptor from <see cref="JournalFactAttribute"/> on <paramref name="clrType"/> and registers it.
    /// </summary>
    void Register(Type clrType);

    /// <summary>
    /// Builds and registers from attributes on <typeparamref name="T"/>.
    /// </summary>
    void Register<T>();

    /// <summary>
    /// Scans assemblies for types annotated with <see cref="JournalFactAttribute"/> and registers them.
    /// </summary>
    void RegisterFromAssemblies(params Assembly[] assemblies);

    bool TryGet(string type, int schemaVersion, [NotNullWhen(true)] out JournalEntryDescriptor? descriptor);

    bool TryGet(Type clrType, [NotNullWhen(true)] out JournalEntryDescriptor? descriptor);

    bool TryGet<T>([NotNullWhen(true)] out JournalEntryDescriptor? descriptor);

    /// <summary>
    /// Enablement gate for a fact type key (all schema versions share the toggle).
    /// </summary>
    bool IsTypeEnabled(string type);

    void SetEnabled(string type, bool enabled);

    /// <summary>
    /// Returns whether <paramref name="entry"/>'s type is enabled.
    /// </summary>
    bool IsEnabled(JournalEntry entry);
}
