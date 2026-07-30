using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.HostResources.Models;
using Speculum.Api.HostResources.Services;
using Speculum.Api.HostResources.Services.Contracts;
using Speculum.Api.Telemetry.Models;

namespace Speculum.Api.Sessions.Tests;

public sealed class HostResourceProvisionServiceTests
{
    private const long GiB = 1024L * 1024 * 1024;

    [Fact]
    public async Task ApplyStore_PersistsParamsAndShm_AndBrowserReceivesComputedBytes()
    {
        var store = new InMemoryApplyStore();
        var browser = new RecordingBrowserClient();

        var plan = HostResourceCalculator.Compute(
            new HostResourceProvisionParams { MaxRamBytes = 8 * GiB },
            hostMemoryTotalBytes: 32 * GiB,
            hostCpuCount: 8,
            hostSource: "machine");

        browser.ApplyOutcome = new HostResourcesApplyOutcome(
            ShmBeforeBytes: 2 * GiB,
            ShmAppliedBytes: plan.ShmTargetBytes,
            UlimitsRaised: true,
            NofileApplied: 1_048_576,
            NprocApplied: 65_535,
            Warnings: []);

        var applied = await browser.ApplyHostResourcesAsync(
            plan.ShmTargetBytes,
            raiseUlimits: true,
            nofile: 1_048_576,
            nproc: 65_535);
        Assert.True(applied.IsSuccess);
        Assert.Equal(plan.ShmTargetBytes, browser.LastShmSizeBytes);

        var result = new HostResourceApplyResult(
            Plan: plan,
            ShmBeforeBytes: applied.Value.ShmBeforeBytes,
            ShmAppliedBytes: applied.Value.ShmAppliedBytes,
            UlimitsRaised: applied.Value.UlimitsRaised,
            NofileApplied: applied.Value.NofileApplied,
            NprocApplied: applied.Value.NprocApplied,
            Warnings: applied.Value.Warnings,
            AppliedAtUtc: DateTimeOffset.UtcNow);

        await store.SaveAsync(result);

        var last = await store.GetLastAsync();
        Assert.NotNull(last);
        Assert.Equal(plan.ShmTargetBytes, last.ShmAppliedBytes);
        Assert.Equal(8 * GiB, last.Params.MaxRamBytes);
        Assert.Equal(6 * GiB, last.ShmTargetBytes);
    }

    private sealed class InMemoryApplyStore : IHostResourceApplyStore
    {
        private HostResourceLastApplySnapshot? _last;

        public Task<HostResourceLastApplySnapshot?> GetLastAsync(CancellationToken ct = default)
            => Task.FromResult(_last);

        public Task SaveAsync(HostResourceApplyResult result, CancellationToken ct = default)
        {
            _last = new HostResourceLastApplySnapshot(
                result.Plan.Params,
                result.Plan.BudgetBytes,
                result.Plan.ReserveBytes,
                result.Plan.ShmTargetBytes,
                result.ShmAppliedBytes,
                result.Plan.HostMemoryTotalBytes,
                result.Plan.HostCpuCount,
                result.Plan.HostSource,
                result.UlimitsRaised,
                result.Warnings,
                result.AppliedAtUtc);
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingBrowserClient : IBrowserClient
    {
        public HostResourcesApplyOutcome ApplyOutcome { get; set; } =
            new(0, 0, false, null, null, []);

        public long? LastShmSizeBytes { get; private set; }

        public bool TryGetConnection(
            Guid sessionId,
            [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] out ISessionConnection? connection)
        {
            connection = null;
            return false;
        }

        public Task<IResult> UpdateBrowserConfigsAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<SidecarTelemetrySample>> CollectTelemetryAsync(
            SidecarTelemetryRequest request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<SidecarTelemetrySample>>(
                Result<SidecarTelemetrySample>.Failure("not supported"));

        public Task<IResult<HostResourcesApplyOutcome>> ApplyHostResourcesAsync(
            long shmSizeBytes,
            bool raiseUlimits,
            long nofile,
            long nproc,
            CancellationToken ct = default)
        {
            LastShmSizeBytes = shmSizeBytes;
            return Task.FromResult<IResult<HostResourcesApplyOutcome>>(
                Result<HostResourcesApplyOutcome>.Success(ApplyOutcome));
        }

        public Task<IResult<HostResourcesLiveStatus>> GetHostResourcesAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<HostResourcesLiveStatus>>(
                Result<HostResourcesLiveStatus>.Success(
                    new HostResourcesLiveStatus(2 * GiB, null, null)));

        public Task<IResult<ISessionConnection>> StartConnectionAsync(
            Guid sessionId,
            CancellationToken ct = default)
            => Task.FromResult<IResult<ISessionConnection>>(
                Result<ISessionConnection>.Failure("not supported"));
    }
}
