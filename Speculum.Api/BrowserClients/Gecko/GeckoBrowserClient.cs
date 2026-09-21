using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sidecar;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry.Models;

namespace Speculum.Api.BrowserClients.Gecko;

/// <summary>IBrowserClient no orquestrador Gecko. Sem gRPC.</summary>
public sealed class GeckoBrowserClient : IBrowserClient, IDisposable
{
    public const string HttpClientName = "gecko-orchestrator";

    private readonly ConcurrentDictionary<Guid, GeckoSessionConnection> _connections = new();
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfigurationService _configuration;
    private readonly IJournalCatalog _journalCatalog;
    private readonly SidecarOptions _options;
    private readonly ILogger<GeckoSessionConnection> _connectionLogger;
    private bool _disposed;

    public GeckoBrowserClient(
        IHttpClientFactory httpFactory,
        IOptions<SidecarOptions> options,
        IConfigurationService configuration,
        IJournalCatalog journalCatalog,
        ILogger<GeckoSessionConnection> connectionLogger)
    {
        _httpFactory = httpFactory;
        _options = options.Value;
        _configuration = configuration;
        _journalCatalog = journalCatalog;
        _connectionLogger = connectionLogger;
    }

    public bool TryGetConnection(
        Guid sessionId,
        [NotNullWhen(true)] out ISessionConnection? connection)
    {
        if (_connections.TryGetValue(sessionId, out var conn) && conn.IsOpen)
        {
            connection = conn;
            return true;
        }

        connection = null;
        return false;
    }

    public Task<IResult> UpdateBrowserConfigsAsync(CancellationToken ct = default)
        => Task.FromResult<IResult>(Result.Success());

    public Task<IResult<SidecarTelemetrySample>> CollectTelemetryAsync(
        SidecarTelemetryRequest request,
        CancellationToken ct = default)
        => Task.FromResult<IResult<SidecarTelemetrySample>>(
            Result<SidecarTelemetrySample>.Failure("gecko_telemetry_unsupported|collect|Gecko has no Chromium sidecar sample"));

    public Task<IResult<HostResourcesApplyOutcome>> ApplyHostResourcesAsync(
        long shmSizeBytes,
        bool raiseUlimits,
        long nofile,
        long nproc,
        CancellationToken ct = default)
        => Task.FromResult<IResult<HostResourcesApplyOutcome>>(
            Result<HostResourcesApplyOutcome>.Failure("gecko_host_resources_unsupported|apply|Gecko has no shm/ulimit sidecar RPC"));

    public Task<IResult<HostResourcesLiveStatus>> GetHostResourcesAsync(CancellationToken ct = default)
        => Task.FromResult<IResult<HostResourcesLiveStatus>>(
            Result<HostResourcesLiveStatus>.Failure("gecko_host_resources_unsupported|status|Gecko has no shm/ulimit sidecar RPC"));

    public Task<IResult<ISessionConnection>> StartConnectionAsync(
        Guid sessionId,
        CancellationToken ct = default)
    {
        if (_disposed)
        {
            return Task.FromResult<IResult<ISessionConnection>>(Result<ISessionConnection>.Failure("Browser client disposed"));
        }

        var connection = new GeckoSessionConnection(
            sessionId,
            _httpFactory,
            _options,
            _configuration,
            _journalCatalog,
            _connectionLogger,
            id => _connections.TryRemove(id, out _));

        if (!_connections.TryAdd(sessionId, connection))
        {
            connection.Dispose();
            return Task.FromResult<IResult<ISessionConnection>>(
                Result<ISessionConnection>.Failure("Connection already exists for session"));
        }

        return Task.FromResult<IResult<ISessionConnection>>(Result<ISessionConnection>.Success(connection));
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        foreach (var connection in _connections.Values)
        {
            connection.Dispose();
        }

        _connections.Clear();
    }
}
