using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Live;

namespace Speculum.Api.Diagnostics.Probes;

public sealed class MotorSessionProbeAdapter : IDiagnosticsProbeProvider
{
    public string Name => "motor-session";

    private readonly IMotorSessionRegistry _registry;

    public MotorSessionProbeAdapter(IMotorSessionRegistry registry)
    {
        _registry = registry;
    }

    public Task<ProbeResult> ExecuteAsync(ProbeRequest request, CancellationToken ct = default)
    {
        var session = _registry.Get(request.ConnectionId);
        if (session is null)
        {
            return Task.FromResult(new ProbeResult
            {
                Ok = false,
                ErrorCode = "session_gone",
            });
        }

        return Task.FromResult(new ProbeResult
        {
            Ok = true,
            Data = session.GetDiagnosticsSnapshot(),
        });
    }
}

public sealed class SidecarDiagProbeProvider : IDiagnosticsProbeProvider
{
    public string Name => "sidecar-diag";

    private readonly IMotorSessionRegistry _registry;

    public SidecarDiagProbeProvider(IMotorSessionRegistry registry)
    {
        _registry = registry;
    }

    public async Task<ProbeResult> ExecuteAsync(ProbeRequest request, CancellationToken ct = default)
    {
        var session = _registry.Get(request.ConnectionId);
        if (session is null)
        {
            return new ProbeResult { Ok = false, ErrorCode = "session_gone" };
        }

        try
        {
            var data = await session.RequestDiagnosticsProbeAsync(
                request.Ops,
                request.EvaluateExpression,
                request.DomSelector,
                request.MaxProbeResponseBytes,
                ct);
            return new ProbeResult { Ok = true, Data = data };
        }
        catch (OperationCanceledException)
        {
            return new ProbeResult { Ok = false, ErrorCode = "probe_timeout" };
        }
        catch (InvalidOperationException ex) when (
            ex.Message.Contains("session_gone", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("response_too_large", StringComparison.OrdinalIgnoreCase))
        {
            var code = ex.Message.Contains("response_too_large", StringComparison.OrdinalIgnoreCase)
                ? "response_too_large"
                : "session_gone";
            return new ProbeResult { Ok = false, ErrorCode = code };
        }
        catch (Exception)
        {
            return new ProbeResult { Ok = false, ErrorCode = "session_gone" };
        }
    }
}

public sealed class HostResourceProbeProvider : IDiagnosticsProbeProvider
{
    public string Name => "host-resources";

    private readonly HostResourceProbe _host;
    private readonly IDiagnosticsRuntime _runtime;

    public HostResourceProbeProvider(HostResourceProbe host, IDiagnosticsRuntime runtime)
    {
        _host = host;
        _runtime = runtime;
    }

    public Task<ProbeResult> ExecuteAsync(ProbeRequest request, CancellationToken ct = default)
    {
        if (!_runtime.IsEnabled(DiagnosticsDomain.HostResources, DiagnosticsLevel.Metrics))
        {
            return Task.FromResult(new ProbeResult
            {
                Ok = false,
                ErrorCode = "probe_level_insufficient",
            });
        }

        var interval = _runtime.GetSnapshot().Options.Probe.HostSampleIntervalMs;
        return Task.FromResult(new ProbeResult
        {
            Ok = true,
            Data = _host.Sample(interval),
        });
    }
}
