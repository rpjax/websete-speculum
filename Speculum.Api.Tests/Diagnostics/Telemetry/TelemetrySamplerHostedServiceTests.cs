using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Telemetry;
using static Speculum.Api.Tests.Telemetry.TelemetryTestSupport;

namespace Speculum.Api.Tests.Telemetry;

public sealed class TelemetrySamplerHostedServiceTests
{
    [Fact]
    public async Task Sampler_emits_when_enabled()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var emitter = new CountingEmitter();
        var sampler = new TelemetrySamplerHostedService(
            emitter, runtime, NullLogger<TelemetrySamplerHostedService>.Instance);

        await sampler.StartAsync(CancellationToken.None);
        var emitted = await Task.WhenAny(emitter.First, Task.Delay(TimeSpan.FromSeconds(5)));
        await sampler.StopAsync(CancellationToken.None);

        Assert.Same(emitter.First, emitted);
        Assert.True(emitter.Count >= 1);
    }

    [Fact]
    public async Task Sampler_idle_when_telemetry_disabled()
    {
        var runtime = Runtime(new DiagnosticsOptions
        {
            Enabled = true,
            Telemetry = new DiagnosticsTelemetryOptions { Enabled = false },
        });
        var emitter = new CountingEmitter();
        var sampler = new TelemetrySamplerHostedService(
            emitter, runtime, NullLogger<TelemetrySamplerHostedService>.Instance);

        await sampler.StartAsync(CancellationToken.None);
        await Task.Delay(TimeSpan.FromMilliseconds(300));
        await sampler.StopAsync(CancellationToken.None);

        Assert.Equal(0, emitter.Count);
    }

    private sealed class CountingEmitter : ITelemetryEmitter
    {
        private readonly TaskCompletionSource _first =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _count;

        public int Count => Volatile.Read(ref _count);
        public Task First => _first.Task;

        public Task EmitSampleAsync(CancellationToken ct = default)
        {
            Interlocked.Increment(ref _count);
            _first.TrySetResult();
            return Task.CompletedTask;
        }
    }
}
