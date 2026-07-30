using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.HostResources.Models;
using Speculum.Api.HostResources.Services.Contracts;
using Speculum.Api.Telemetry.Probes;

namespace Speculum.Api.HostResources.Services;

public sealed class HostResourceProvisionService(
    MachineResourceProbe probe,
    IConfigurationService configuration,
    IBrowserClient browser,
    IHostResourceApplyStore applyStore) : IHostResourceProvisionService
{
    public async Task<IResult<HostResourceStatus>> GetStatusAsync(CancellationToken ct = default)
    {
        HostResourceHostSnapshot? host = null;
        string? hostError = null;
        try
        {
            var sample = SampleHost();
            if (IsHostUnavailable(sample))
            {
                hostError = "Host memory probe unavailable (need Linux host procfs, e.g. /host/proc).";
            }
            else
            {
                host = new HostResourceHostSnapshot(
                    sample.MemoryTotal,
                    sample.MemoryAvailable,
                    sample.CpuCount,
                    sample.Source);
            }
        }
        catch (Exception ex)
        {
            hostError = ex.Message;
        }

        HostResourceSidecarSnapshot? sidecar;
        var live = await browser.GetHostResourcesAsync(ct).ConfigureAwait(false);
        if (live.IsSuccess)
        {
            sidecar = new HostResourceSidecarSnapshot(
                live.Value.ShmSizeBytes,
                live.Value.Nofile,
                live.Value.Nproc,
                Error: null);
        }
        else
        {
            var err = live.Errors.FirstOrDefault()?.ToString()
                ?? "Sidecar host-resources status failed";
            sidecar = new HostResourceSidecarSnapshot(
                ShmSizeBytes: null,
                Nofile: null,
                Nproc: null,
                Error: err);
        }

        var last = await applyStore.GetLastAsync(ct).ConfigureAwait(false);
        return Result<HostResourceStatus>.Success(new HostResourceStatus(host, sidecar, last, hostError));
    }

    public Task<IResult<HostResourceProvisionPlan>> PreviewAsync(
        HostResourceProvisionParams parameters,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        ct.ThrowIfCancellationRequested();

        var paramError = HostResourceCalculator.ValidateParams(parameters);
        if (paramError is not null)
        {
            return Task.FromResult<IResult<HostResourceProvisionPlan>>(
                Result<HostResourceProvisionPlan>.Failure(paramError));
        }

        var sample = SampleHost();
        if (IsHostUnavailable(sample))
        {
            return Task.FromResult<IResult<HostResourceProvisionPlan>>(
                Result<HostResourceProvisionPlan>.Failure(
                    "Host memory probe unavailable (need Linux host procfs, e.g. /host/proc)."));
        }

        var againstHost = HostResourceCalculator.ValidateAgainstHost(parameters, sample.MemoryTotal);
        if (againstHost is not null)
        {
            return Task.FromResult<IResult<HostResourceProvisionPlan>>(
                Result<HostResourceProvisionPlan>.Failure(againstHost));
        }

        var plan = HostResourceCalculator.Compute(
            parameters,
            sample.MemoryTotal,
            sample.CpuCount,
            sample.Source);

        return Task.FromResult<IResult<HostResourceProvisionPlan>>(
            Result<HostResourceProvisionPlan>.Success(plan));
    }

    public async Task<IResult<HostResourceApplyResult>> ApplyAsync(
        HostResourceProvisionParams parameters,
        CancellationToken ct = default)
    {
        var preview = await PreviewAsync(parameters, ct).ConfigureAwait(false);
        if (!preview.IsSuccess)
            return Result<HostResourceApplyResult>.Failure(preview.Errors.ToArray());

        var plan = preview.Value;
        var applied = await browser.ApplyHostResourcesAsync(
            plan.ShmTargetBytes,
            plan.RaiseUlimits,
            plan.Nofile,
            plan.Nproc,
            ct).ConfigureAwait(false);

        if (!applied.IsSuccess)
            return Result<HostResourceApplyResult>.Failure(applied.Errors.ToArray());

        var outcome = applied.Value;
        var result = new HostResourceApplyResult(
            Plan: plan,
            ShmBeforeBytes: outcome.ShmBeforeBytes,
            ShmAppliedBytes: outcome.ShmAppliedBytes,
            UlimitsRaised: outcome.UlimitsRaised,
            NofileApplied: outcome.NofileApplied,
            NprocApplied: outcome.NprocApplied,
            Warnings: outcome.Warnings,
            AppliedAtUtc: DateTimeOffset.UtcNow);

        await applyStore.SaveAsync(result, ct).ConfigureAwait(false);
        return Result<HostResourceApplyResult>.Success(result);
    }

    private Telemetry.Models.HostTelemetry SampleHost()
    {
        var hostOptions = configuration.GetCurrent().Telemetry.Host;
        var options = new HostTelemetryConfiguration
        {
            IsEnabled = true,
            ProcPath = hostOptions.ProcPath,
            DiskPath = hostOptions.DiskPath,
            SampleIntervalMs = Math.Clamp(hostOptions.SampleIntervalMs, 100, 60_000),
            IncludeLoadAverage = false,
            IncludeSwap = false,
            IncludeDiskIo = false,
            IncludeNetwork = false,
        };
        return probe.Sample(options);
    }

    private static bool IsHostUnavailable(Telemetry.Models.HostTelemetry sample)
        => string.Equals(sample.Source, "unavailable", StringComparison.OrdinalIgnoreCase)
           || sample.MemoryTotal <= 0;
}
