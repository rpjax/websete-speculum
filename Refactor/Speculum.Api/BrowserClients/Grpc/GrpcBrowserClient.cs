using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Grpc.Net.Client;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sidecar;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sidecar.V1;
using Speculum.Api.Telemetry.Models;
using TelemetryRequest = Speculum.Api.Telemetry.Models.SidecarTelemetryRequest;
using ProtoTelemetryRequest = Speculum.Api.Sidecar.V1.SidecarTelemetryRequest;

namespace Speculum.Api.BrowserClients.Grpc;

/// <summary>
/// gRPC <see cref="IBrowserClient"/>: dials sidecar, Create, opens Watch*/Control/PushInput,
/// registers <see cref="GrpcSessionConnection"/>.
/// </summary>
public sealed class GrpcBrowserClient : IBrowserClient, IDisposable
{
    private readonly ConcurrentDictionary<Guid, GrpcSessionConnection> _connections = new();
    private readonly GrpcChannel _channel;
    private readonly BrowserSessionService.BrowserSessionServiceClient _client;
    private readonly IConfigurationService _configuration;
    private readonly IJournalCatalog _journalCatalog;
    private readonly SidecarOptions _options;
    private readonly ILogger<GrpcSessionConnection> _connectionLogger;
    private bool _disposed;

    public GrpcBrowserClient(
        IOptions<SidecarOptions> options,
        IConfigurationService configuration,
        IJournalCatalog journalCatalog,
        ILogger<GrpcSessionConnection> connectionLogger)
    {
        _options = options.Value;
        var address = _options.GrpcAddress;
        _channel = GrpcChannel.ForAddress(address);
        _client = new BrowserSessionService.BrowserSessionServiceClient(_channel);
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

    public async Task<IResult<SidecarTelemetrySample>> CollectTelemetryAsync(
        TelemetryRequest request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        try
        {
            var response = await _client.CollectTelemetryAsync(
                new ProtoTelemetryRequest
                {
                    IncludeProcess = request.IncludeProcess,
                    IncludeEventLoop = request.IncludeEventLoop,
                    IncludeChrome = request.IncludeChrome,
                    IncludeQueues = request.IncludeQueues,
                    IncludeSessionsSummary = request.IncludeSessionsSummary,
                    IncludeFaultedIds = request.IncludeFaultedIds,
                },
                cancellationToken: ct);

            return Result<SidecarTelemetrySample>.Success(new SidecarTelemetrySample(
                response.Process is not null
                    ? new Speculum.Api.Telemetry.Models.SidecarProcessTelemetry(
                        response.Process.CpuUsage, response.Process.MemoryRss,
                        response.Process.MemoryHeapUsed, response.Process.MemoryHeapTotal,
                        response.Process.Pid, response.Process.UptimeSec)
                    : null,
                response.EventLoop is not null
                    ? new Speculum.Api.Telemetry.Models.SidecarEventLoopTelemetry(
                        response.EventLoop.DelayMsP50, response.EventLoop.DelayMsP99,
                        response.EventLoop.Utilization)
                    : null,
                response.Chrome is not null
                    ? new Speculum.Api.Telemetry.Models.SidecarChromeTelemetry(
                        response.Chrome.BrowserCount, response.Chrome.PageCount,
                        response.Chrome.HasTotalJsHeapUsed ? response.Chrome.TotalJsHeapUsed : null)
                    : null,
                response.Queues is not null
                    ? new Speculum.Api.Telemetry.Models.SidecarQueueTelemetry(
                        response.Queues.VideoDepth, response.Queues.AudioDepth,
                        response.Queues.ConsoleDepth,
                        response.Queues.HasInputDepth ? response.Queues.InputDepth : null,
                        response.Queues.HasDroppedTotal ? response.Queues.DroppedTotal : null)
                    : null,
                response.Sessions is not null
                    ? new Speculum.Api.Telemetry.Models.SidecarSessionsSummary(
                        response.Sessions.Registered, response.Sessions.Open,
                        response.Sessions.Faulted,
                        request.IncludeFaultedIds
                            ? response.Sessions.FaultedSessionIds.ToArray()
                            : null)
                    : null));
        }
        catch (Exception ex)
        {
            return Result<SidecarTelemetrySample>.Failure(ex.Message);
        }
    }

    public async Task<IResult<ISessionConnection>> StartConnectionAsync(
        Guid sessionId,
        CancellationToken ct = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (_connections.ContainsKey(sessionId))
        {
            return Result<ISessionConnection>.Failure("Connection already exists for session");
        }

        try
        {
            var created = await _client.CreateAsync(
                new CreateRequest { SessionId = sessionId.ToString("D") },
                cancellationToken: ct);

            if (!Guid.TryParse(created.SessionId, out var remoteId) || remoteId != sessionId)
            {
                return Result<ISessionConnection>.Failure("Sidecar returned unexpected session id");
            }

            var connection = new GrpcSessionConnection(
                sessionId,
                _client,
                _configuration,
                _journalCatalog,
                _options,
                _connectionLogger,
                id => _connections.TryRemove(id, out _));

            if (!_connections.TryAdd(sessionId, connection))
            {
                await connection.CloseAsync(ct);
                return Result<ISessionConnection>.Failure("Connection already exists for session");
            }

            await connection.StartStreamsAsync(ct);
            return Result<ISessionConnection>.Success(connection);
        }
        catch (Exception ex)
        {
            return Result<ISessionConnection>.Failure(ex.Message);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var kv in _connections)
        {
            _ = kv.Value.CloseAsync();
        }

        _connections.Clear();
        _channel.Dispose();
    }
}
