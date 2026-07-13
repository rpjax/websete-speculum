namespace Speculum.Api.Edge;

public interface IEdgeSynchronizer
{
    Task SynchronizeAsync(CancellationToken ct = default);
}
