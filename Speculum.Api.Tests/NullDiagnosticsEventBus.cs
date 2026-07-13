using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Tests;

internal sealed class NullDiagnosticsEventBus : IDiagnosticsEventBus
{
    public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true) { }
}
