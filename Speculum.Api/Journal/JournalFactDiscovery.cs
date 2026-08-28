using System.Reflection;

namespace Speculum.Api.Journal;

/// <summary>
/// Assemblies queued for <c>[JournalFact]</c> discovery before the host is built.
/// Filled by <see cref="JournalServiceCollectionExtensions.DiscoverJournalFacts"/>.
/// </summary>
public sealed class JournalFactDiscovery
{
    private readonly List<Assembly> _assemblies = new();

    public IReadOnlyList<Assembly> Assemblies
    {
        get
        {
            lock (_assemblies)
                return _assemblies.ToArray();
        }
    }

    public void Add(Assembly assembly)
    {
        ArgumentNullException.ThrowIfNull(assembly);

        lock (_assemblies)
        {
            if (!_assemblies.Contains(assembly))
                _assemblies.Add(assembly);
        }
    }
}
