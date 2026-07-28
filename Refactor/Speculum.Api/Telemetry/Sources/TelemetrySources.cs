using System.Net.Sockets;
using System.Text.Json;
using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry.Models;
using Speculum.Api.Telemetry.Ports;
using Speculum.Api.Telemetry.Probes;

namespace Speculum.Api.Telemetry.Sources;

public interface IHostTelemetrySource { HostTelemetry Collect(HostTelemetryConfiguration options); }
public interface IApiProcessTelemetrySource { ApiProcessTelemetry Collect(ApiProcessTelemetryConfiguration options); }
public interface ISessionsTelemetrySource
{
    Task<SessionsTelemetry> CollectAsync(SessionTelemetryConfiguration options, CancellationToken ct);
}
public interface ISidecarTelemetrySource
{
    Task<SidecarTelemetrySample?> CollectAsync(SidecarTelemetryConfiguration options, CancellationToken ct);
}
public interface IProfilesTelemetrySource
{
    Task<ProfilesTelemetry> CollectAsync(ProfileTelemetryConfiguration options, CancellationToken ct);
}
public interface IJournalTelemetrySource { JournalTelemetry Collect(JournalTelemetryConfiguration options); }
public interface IDockerTelemetrySource
{
    Task<DockerTelemetry?> CollectAsync(DockerTelemetryConfiguration options, CancellationToken ct);
}

public sealed class HostTelemetrySource(MachineResourceProbe probe) : IHostTelemetrySource
{
    public HostTelemetry Collect(HostTelemetryConfiguration options) => probe.Sample(options);
}

public sealed class ApiProcessTelemetrySource(ApiProcessResourceProbe probe) : IApiProcessTelemetrySource
{
    public ApiProcessTelemetry Collect(ApiProcessTelemetryConfiguration options) => probe.Sample(options);
}

public sealed class SessionsTelemetrySource(ISessionTelemetrySampleSource sessions) : ISessionsTelemetrySource
{
    public async Task<SessionsTelemetry> CollectAsync(
        SessionTelemetryConfiguration options,
        CancellationToken ct)
    {
        var snapshots = sessions.ListSnapshots();
        var items = options.IncludePerSession
            ? new List<SessionTelemetryItem>(snapshots.Count)
            : null;
        var fps = new List<double>(snapshots.Count);
        var statusBySessionId = new Dictionary<Guid, (double? Fps, string? UrlHost)>(snapshots.Count);

        if (snapshots.Count > 0)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(2));

            var statusTasks = snapshots.Select(async snapshot =>
            {
                try
                {
                    var status = await sessions.TryGetStatusAsync(snapshot.SessionId, timeout.Token)
                        .ConfigureAwait(false);
                    if (status is null)
                        return;

                    double? currentFps = status.Fps > 0 ? status.Fps : null;
                    string? urlHost = null;
                    if (options.IncludePerSession
                        && options.IncludeUrlHost
                        && Uri.TryCreate(status.Url, UriKind.Absolute, out var uri))
                    {
                        urlHost = uri.Host;
                    }

                    lock (statusBySessionId)
                    {
                        statusBySessionId[snapshot.SessionId] = (currentFps, urlHost);
                        if (currentFps is > 0)
                            fps.Add(currentFps.Value);
                    }
                }
                catch (OperationCanceledException) when (timeout.IsCancellationRequested)
                {
                    // Best-effort: timeout leaves this session absent from the snapshot.
                }
                catch
                {
                    // One faulty session must not erase fleet-wide session telemetry.
                }
            });

            try
            {
                await Task.WhenAll(statusTasks).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested)
            {
                // Best-effort: return the partial status set gathered before timeout.
            }
        }

        foreach (var snapshot in snapshots)
        {
            statusBySessionId.TryGetValue(snapshot.SessionId, out var statusInfo);
            items?.Add(new SessionTelemetryItem(
                snapshot.SessionId,
                snapshot.ProfileId,
                snapshot.JsBridgeEnabled,
                snapshot.ConnectionOpen,
                snapshot.UptimeMs,
                statusInfo.Fps,
                statusInfo.UrlHost));
        }

        var live = snapshots.Count(snapshot => snapshot.ConnectionOpen);
        var capacity = Math.Max(0, sessions.GetConfiguredCapacityMax());
        return new SessionsTelemetry(
            snapshots.Count,
            live,
            capacity,
            capacity > 0 ? Math.Round((double)live / capacity * 100, 1) : 0,
            fps.Count > 0 ? Math.Round(fps.Average(), 2) : null,
            fps.Count > 0 ? Math.Round(fps.Min(), 2) : null,
            fps.Count > 0 ? Math.Round(fps.Max(), 2) : null,
            options.IncludeSessionIds
                ? snapshots.Select(snapshot => snapshot.SessionId.ToString("D")).ToArray()
                : null,
            items);
    }
}

public sealed class SidecarTelemetrySource(ISidecarTelemetrySampleSource sidecar) : ISidecarTelemetrySource
{
    public async Task<SidecarTelemetrySample?> CollectAsync(
        SidecarTelemetryConfiguration options,
        CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(Math.Clamp(options.TimeoutMs, 100, 60_000));
        return await sidecar.CollectAsync(
            new SidecarTelemetryRequest(
                options.IncludeProcess,
                options.IncludeEventLoop,
                options.IncludeChrome,
                options.IncludeQueues,
                options.IncludeSessionsSummary,
                options.IncludeFaultedIds),
            timeout.Token).ConfigureAwait(false);
    }
}

public sealed class ProfilesTelemetrySource(IProfileTelemetrySampleSource profiles) : IProfilesTelemetrySource
{
    public async Task<ProfilesTelemetry> CollectAsync(
        ProfileTelemetryConfiguration options,
        CancellationToken ct)
    {
        var (total, storage) = await profiles.CollectAsync(options.IncludeStorageBytes, ct)
            .ConfigureAwait(false);
        return new ProfilesTelemetry(total, storage);
    }
}

public sealed class JournalTelemetrySource(
    JournalDrainMetrics metrics,
    IJournalHealth health) : IJournalTelemetrySource
{
    public JournalTelemetry Collect(JournalTelemetryConfiguration options)
        => new(
            metrics.QueueDepth,
            metrics.DroppedOnEnqueue + metrics.DroppedByPolicy + metrics.PersistAbandoned,
            health.State == JournalHealthState.Degraded,
            options.IncludePressure ? metrics.PersistFailures : null,
            options.IncludePressure ? metrics.GuaranteedAdmissionFailures : null,
            options.IncludePressure ? health.IsQueuePressureActive : null,
            options.IncludePressure ? health.IsPersistDegraded : null,
            options.IncludePressure ? health.IsDrainRunning : null,
            options.IncludePressure ? health.IsAdmissionOpen : null);
}

public sealed class DockerTelemetrySource(ILogger<DockerTelemetrySource> logger) : IDockerTelemetrySource
{
    private readonly object _failureGate = new();
    private readonly HashSet<string> _activeFailures = [];

    public async Task<DockerTelemetry?> CollectAsync(
        DockerTelemetryConfiguration options,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(options.Endpoint))
        {
            logger.LogDebug("Telemetry docker collection skipped: endpoint missing.");
            return null;
        }

        if (!Uri.TryCreate(options.Endpoint, UriKind.Absolute, out var endpoint))
        {
            LogFailure("endpoint_parse", options.Endpoint);
            return null;
        }

        if (!string.Equals(endpoint.Scheme, "unix", StringComparison.OrdinalIgnoreCase))
        {
            LogFailure("endpoint_parse", endpoint.Scheme);
            return null;
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(Math.Clamp(options.TimeoutMs, 100, 60_000));
            using var handler = new SocketsHttpHandler
            {
                ConnectCallback = async (_, token) =>
                {
                    var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                    try
                    {
                        await socket.ConnectAsync(new UnixDomainSocketEndPoint(endpoint.LocalPath), token)
                            .ConfigureAwait(false);
                        return new NetworkStream(socket, ownsSocket: true);
                    }
                    catch (Exception ex)
                    {
                        socket.Dispose();
                        LogFailure("socket_connect", endpoint.LocalPath, ex);
                        throw;
                    }
                },
            };
            using var client = new HttpClient(handler) { BaseAddress = new Uri("http://docker") };
            var runtime = options.IncludeRuntime
                ? await TryReadRuntimeAsync(client, endpoint, timeout.Token).ConfigureAwait(false)
                : null;
            var containers = options.IncludeContainers
                ? await TryReadContainersAsync(client, endpoint, timeout.Token).ConfigureAwait(false)
                : null;
            if (runtime is not null)
            {
                ClearFailure("socket_connect", endpoint.LocalPath);
                ClearFailure("docker_info", endpoint.LocalPath);
            }
            if (containers is not null)
            {
                ClearFailure("socket_connect", endpoint.LocalPath);
                ClearFailure("docker_containers", endpoint.LocalPath);
            }
            return runtime is null && containers is null
                ? null
                : new DockerTelemetry(runtime, containers);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            LogFailure("timeout", $"{options.Endpoint}@{options.TimeoutMs}ms");
            return null;
        }
        catch (Exception ex)
        {
            LogFailure("docker_collect", options.Endpoint, ex);
            return null;
        }
    }

    private async Task<DockerRuntimeTelemetry?> TryReadRuntimeAsync(
        HttpClient client,
        Uri endpoint,
        CancellationToken ct)
    {
        try
        {
            return await ReadRuntimeAsync(client, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogFailure("docker_info", endpoint.LocalPath, ex);
            return null;
        }
    }

    private async Task<IReadOnlyList<DockerContainerTelemetry>?> TryReadContainersAsync(
        HttpClient client,
        Uri endpoint,
        CancellationToken ct)
    {
        try
        {
            return await ReadContainersAsync(client, logger, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogFailure("docker_containers", endpoint.LocalPath, ex);
            return null;
        }
    }

    private static async Task<DockerRuntimeTelemetry> ReadRuntimeAsync(
        HttpClient client,
        CancellationToken ct)
    {
        using var response = await client.GetAsync("/info", ct).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false));
        var root = json.RootElement;
        return new DockerRuntimeTelemetry(
            GetString(root, "ServerVersion"),
            GetString(root, "OperatingSystem"),
            GetString(root, "Architecture"),
            GetInt(root, "Containers"),
            GetInt(root, "ContainersRunning"),
            GetInt(root, "ContainersStopped"));
    }

    private static async Task<IReadOnlyList<DockerContainerTelemetry>> ReadContainersAsync(
        HttpClient client,
        ILogger logger,
        CancellationToken ct)
    {
        using var response = await client.GetAsync("/containers/json?all=1", ct).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false));
        var output = new List<DockerContainerTelemetry>();
        foreach (var item in json.RootElement.EnumerateArray())
        {
            var id = GetString(item, "Id") ?? string.Empty;
            var name = item.TryGetProperty("Names", out var names)
                ? names.EnumerateArray().Select(value => value.GetString()?.TrimStart('/'))
                    .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? id[..Math.Min(12, id.Length)]
                : id[..Math.Min(12, id.Length)];
            var stats = string.Equals(GetString(item, "State"), "running", StringComparison.OrdinalIgnoreCase)
                ? await ReadStatsAsync(client, id, logger, ct).ConfigureAwait(false)
                : default;
            output.Add(new DockerContainerTelemetry(
                id, name, GetString(item, "Image") ?? string.Empty, GetString(item, "State") ?? "unknown",
                stats.Cpu, stats.Memory, stats.MemoryLimit, stats.NetworkRx, stats.NetworkTx));
        }
        return output;
    }

    private static async Task<(double? Cpu, long? Memory, long? MemoryLimit, long? NetworkRx, long? NetworkTx)>
        ReadStatsAsync(HttpClient client, string id, ILogger logger, CancellationToken ct)
    {
        try
        {
            using var response = await client.GetAsync($"/containers/{id}/stats?stream=false", ct)
                .ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false));
            var root = json.RootElement;
            long? memory = null, limit = null, rx = 0, tx = 0;
            double? cpu = null;
            if (root.TryGetProperty("cpu_stats", out var cpuStats)
                && root.TryGetProperty("precpu_stats", out var previousCpuStats))
            {
                var currentTotal = ReadNestedLong(cpuStats, "cpu_usage", "total_usage");
                var previousTotal = ReadNestedLong(previousCpuStats, "cpu_usage", "total_usage");
                var currentSystem = GetLongNullable(cpuStats, "system_cpu_usage") ?? 0;
                var previousSystem = GetLongNullable(previousCpuStats, "system_cpu_usage") ?? 0;
                var cpuCount = GetLongNullable(cpuStats, "online_cpus") ?? 1;
                var cpuDelta = currentTotal - previousTotal;
                var systemDelta = currentSystem - previousSystem;
                if (cpuDelta > 0 && systemDelta > 0)
                    cpu = Math.Round((double)cpuDelta / systemDelta * cpuCount * 100, 2);
            }
            if (root.TryGetProperty("memory_stats", out var mem))
            {
                memory = GetLongNullable(mem, "usage");
                limit = GetLongNullable(mem, "limit");
            }
            if (root.TryGetProperty("networks", out var networks))
            {
                foreach (var network in networks.EnumerateObject())
                {
                    rx += GetLongNullable(network.Value, "rx_bytes") ?? 0;
                    tx += GetLongNullable(network.Value, "tx_bytes") ?? 0;
                }
            }
            return (cpu, memory, limit, rx, tx);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "Telemetry docker container stats failed at {Phase} for {ContainerId}.",
                "docker_container_stats",
                id);
            return default;
        }
    }

    private void LogFailure(string phase, string target, Exception? ex = null)
    {
        var key = $"{phase}|{target}";
        var firstOccurrence = false;
        lock (_failureGate)
        {
            firstOccurrence = _activeFailures.Add(key);
        }

        if (firstOccurrence)
        {
            if (ex is null)
            {
                logger.LogWarning(
                    "Telemetry docker collection failed at {Phase} for {Target}.",
                    phase,
                    target);
            }
            else
            {
                logger.LogWarning(
                    ex,
                    "Telemetry docker collection failed at {Phase} for {Target}.",
                    phase,
                    target);
            }
            return;
        }

        logger.LogDebug(
            "Telemetry docker collection still failing at {Phase} for {Target}.",
            phase,
            target);
    }

    private void ClearFailure(string phase, string target)
    {
        lock (_failureGate)
        {
            _activeFailures.Remove($"{phase}|{target}");
        }
    }

    private static string? GetString(JsonElement value, string name)
        => value.TryGetProperty(name, out var field) ? field.GetString() : null;
    private static int GetInt(JsonElement value, string name)
        => value.TryGetProperty(name, out var field) && field.TryGetInt32(out var result) ? result : 0;
    private static long? GetLongNullable(JsonElement value, string name)
        => value.TryGetProperty(name, out var field) && field.TryGetInt64(out var result) ? result : null;
    private static long ReadNestedLong(JsonElement value, string parent, string name)
        => value.TryGetProperty(parent, out var nested) ? GetLongNullable(nested, name) ?? 0 : 0;
}
