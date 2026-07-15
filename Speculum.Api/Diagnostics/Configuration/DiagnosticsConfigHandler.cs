using Speculum.Api.Config.Application;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Emitters;

namespace Speculum.Api.Diagnostics.Configuration;

public sealed class DiagnosticsConfigHandler : IConfigChangeHandler
{
    private readonly Lazy<ISpeculumConfigStore> _store;
    private readonly IDiagnosticsRuntime _runtime;
    private readonly IDiagnosticsSelfEmitter _self;

    public DiagnosticsConfigHandler(
        Lazy<ISpeculumConfigStore> store,
        IDiagnosticsRuntime runtime,
        IDiagnosticsSelfEmitter self)
    {
        _store = store;
        _runtime = runtime;
        _self = self;
    }

    public Task HandleAsync(ConfigChangeContext context, CancellationToken ct = default)
    {
        if (context.Phase != ConfigChangePhase.PostReload)
            return Task.CompletedTask;

        // Boot uses Hosting as the init section key; also hot-apply Diagnostics PUTs.
        if (context.SectionKey is not (ConfigSectionKeys.Diagnostics or ConfigSectionKeys.Hosting))
            return Task.CompletedTask;

        var options = _store.Value.Current.Diagnostics;
        _runtime.ApplyOptions(options);
        _self.ConfigApplied(options.Enabled, options.Profile);

        return Task.CompletedTask;
    }
}
