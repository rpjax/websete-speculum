using System.Collections.Concurrent;

namespace Speculum.Api.Journal.Attributes;

internal static class JournalIndexSerializerCache
{
    private static readonly ConcurrentDictionary<Type, IJournalIndexValueSerializer> Cache = new();

    public static IJournalIndexValueSerializer Get(Type? serializerType)
    {
        if (serializerType is null)
            return DefaultJournalIndexValueSerializer.Instance;

        if (!typeof(IJournalIndexValueSerializer).IsAssignableFrom(serializerType))
        {
            throw new InvalidOperationException(
                $"Type '{serializerType.FullName}' does not implement {nameof(IJournalIndexValueSerializer)}.");
        }

        return Cache.GetOrAdd(serializerType, static type =>
        {
            try
            {
                return (IJournalIndexValueSerializer)Activator.CreateInstance(type)!;
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    $"Failed to create {nameof(IJournalIndexValueSerializer)} '{type.FullName}'.",
                    ex);
            }
        });
    }
}
