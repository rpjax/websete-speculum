using Speculum.Api.Config.Runtime;
using Speculum.Api.Edge;

namespace Speculum.Api.Config.Application;

public sealed class EdgeSyncConfigHandler : IConfigChangeHandler
{
    private readonly IEdgeSynchronizer _edgeSynchronizer;

    public EdgeSyncConfigHandler(IEdgeSynchronizer edgeSynchronizer)
    {
        _edgeSynchronizer = edgeSynchronizer;
    }

    public Task HandleAsync(ConfigChangeContext context, CancellationToken ct = default)
    {
        if (context.Phase != ConfigChangePhase.PostReload
            || context.SectionKey != ConfigSectionKeys.Hosting)
        {
            return Task.CompletedTask;
        }

        return _edgeSynchronizer.SynchronizeAsync(ct);
    }
}
