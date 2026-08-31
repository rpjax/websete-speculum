using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Net.Http;
using Aidan.Core.Patterns;
using Grpc.Core;
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
/// gRPC <see cref="IBrowserClient"/>: permanent host control stream + one gRPC channel per
/// session (M8 / I8). Host-level unary RPCs use <see cref="_hostClient"/>; each session owns
/// its own <see cref="GrpcChannel"/> and <see cref="BrowserSessionService.BrowserSessionServiceClient"/>.
/// </summary>
public sealed class GrpcBrowserClient : IBrowserClient, IDisposable
{
    private readonly ConcurrentDictionary<Guid, GrpcSessionConnection> _connections = new();
    private readonly GrpcChannel _hostChannel;
    private readonly BrowserSessionService.BrowserSessionServiceClient _hostClient;
    private readonly string _grpcAddress;
    private readonly int _maxGrpcMessageBytes;
    private readonly IConfigurationService _configuration;
    private readonly IJournalCatalog _journalCatalog;
    private readonly SidecarOptions _options;
    private readonly ILogger<GrpcSessionConnection> _connectionLogger;
    private readonly CancellationTokenSource _hostLifetime = new();
    private readonly object _hostControlGate = new();
    private AsyncDuplexStreamingCall<HostControlToSidecar, HostControlFromSidecar>? _hostControl;
    private long _hostPingSeq;
    private long _lastHostAckSeq;
    private int _hostControlGeneration;
    private bool _disposed;

    public GrpcBrowserClient(
        IOptions<SidecarOptions> options,
        IConfigurationService configuration,
        IJournalCatalog journalCatalog,
        ILogger<GrpcSessionConnection> connectionLogger)
    {
        _options = options.Value;
        _grpcAddress = _options.GrpcAddress;
        _maxGrpcMessageBytes = _options.MaxGrpcMessageBytes;
        _hostChannel = CreateChannel(_grpcAddress);
        _hostClient = new BrowserSessionService.BrowserSessionServiceClient(_hostChannel);
        _configuration = configuration;
        _journalCatalog = journalCatalog;
        _connectionLogger = connectionLogger;
        _ = PumpHostControlAsync(_hostLifetime.Token);
    }

    /// <summary>True while the permanent host control duplex is open.</summary>
    internal bool IsHostControlOpen
    {
        get
        {
            lock (_hostControlGate)
            {
                return _hostControl is not null;
            }
        }
    }

    /// <summary>Increments each time the host control stream (re)opens.</summary>
    internal int HostControlGeneration => Volatile.Read(ref _hostControlGeneration);

    /// <summary>Last <c>ack_seq</c> received on the host control stream.</summary>
    internal long LastHostAckSeq => Volatile.Read(ref _lastHostAckSeq);

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
            var response = await _hostClient.CollectTelemetryAsync(
                new ProtoTelemetryRequest
                {
                    IncludeProcess = request.IncludeProcess,
                    IncludeEventLoop = request.IncludeEventLoop,
                    IncludeChrome = request.IncludeChrome,
                    IncludeQueues = request.IncludeQueues,
                    IncludeSessionsSummary = request.IncludeSessionsSummary,
                    IncludeFaultedIds = request.IncludeFaultedIds,
                    IncludeAllocationsSummary = request.IncludeAllocationsSummary,
                    IncludeAllocationSessions = request.IncludeAllocationSessions,
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
                        response.Queues.HasDroppedTotal ? response.Queues.DroppedTotal : null,
                        response.Queues.HasInputChainDepth ? response.Queues.InputChainDepth : null)
                    : null,
                response.Sessions is not null
                    ? new Speculum.Api.Telemetry.Models.SidecarSessionsSummary(
                        response.Sessions.Registered, response.Sessions.Open,
                        response.Sessions.Faulted,
                        request.IncludeFaultedIds
                            ? response.Sessions.FaultedSessionIds.ToArray()
                            : null)
                    : null,
                response.Allocations is not null
                    ? new Speculum.Api.Telemetry.Models.SidecarAllocationsTelemetry(
                        response.Allocations.Summary is not null
                            ? new Speculum.Api.Telemetry.Models.SidecarAllocationsSummary(
                                response.Allocations.Summary.AllocatedSessions,
                                response.Allocations.Summary.OpenSessions,
                                response.Allocations.Summary.FaultedSessions,
                                response.Allocations.Summary.DisplayCount,
                                response.Allocations.Summary.AllocatedDisplayPixels,
                                response.Allocations.Summary.OsInputSessions,
                                response.Allocations.Summary.PatchrightInputSessions,
                                response.Allocations.Summary.TouchPrimarySessions,
                                response.Allocations.Summary.UserDataDirsPresent)
                            : null,
                        request.IncludeAllocationSessions
                            ? response.Allocations.Sessions.Select(s =>
                                new Speculum.Api.Telemetry.Models.SidecarAllocationSession(
                                    s.SessionId, s.Open, s.Faulted, s.DisplayAllocated,
                                    s.DisplayWidth, s.DisplayHeight, s.LogicalWidth, s.LogicalHeight,
                                    s.ChromeWidth, s.ChromeHeight, s.InputBackend, s.TouchPrimary,
                                    s.UserDataDirPresent)).ToArray()
                            : null)
                    : null));
        }
        catch (Exception ex)
        {
            return Result<SidecarTelemetrySample>.Failure(ex.Message);
        }
    }

    public async Task<IResult<HostResourcesApplyOutcome>> ApplyHostResourcesAsync(
        long shmSizeBytes,
        bool raiseUlimits,
        long nofile,
        long nproc,
        CancellationToken ct = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (shmSizeBytes <= 0)
            return Result<HostResourcesApplyOutcome>.Failure("shmSizeBytes must be greater than 0");

        try
        {
            var response = await _hostClient.ApplyHostResourcesAsync(
                new ApplyHostResourcesRequest
                {
                    ShmSizeBytes = shmSizeBytes,
                    RaiseUlimits = raiseUlimits,
                    Nofile = nofile,
                    Nproc = nproc,
                },
                cancellationToken: ct);

            return Result<HostResourcesApplyOutcome>.Success(new HostResourcesApplyOutcome(
                response.ShmBeforeBytes,
                response.ShmAppliedBytes,
                response.UlimitsRaised,
                response.HasNofileApplied ? response.NofileApplied : null,
                response.HasNprocApplied ? response.NprocApplied : null,
                response.Warnings.ToArray()));
        }
        catch (Exception ex)
        {
            return Result<HostResourcesApplyOutcome>.Failure(ex.Message);
        }
    }

    public async Task<IResult<HostResourcesLiveStatus>> GetHostResourcesAsync(CancellationToken ct = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        try
        {
            var response = await _hostClient.GetHostResourcesAsync(new Empty(), cancellationToken: ct);
            return Result<HostResourcesLiveStatus>.Success(new HostResourcesLiveStatus(
                response.ShmSizeBytes,
                response.HasNofile ? response.Nofile : null,
                response.HasNproc ? response.Nproc : null));
        }
        catch (Exception ex)
        {
            return Result<HostResourcesLiveStatus>.Failure(ex.Message);
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

        var hostGenerationAtStart = HostControlGeneration;

        GrpcChannel? sessionChannel = null;
        try
        {
            sessionChannel = CreateChannel(_grpcAddress);
            var sessionClient = new BrowserSessionService.BrowserSessionServiceClient(sessionChannel);

            var created = await sessionClient.CreateAsync(
                new CreateRequest { SessionId = sessionId.ToString("D") },
                cancellationToken: ct);

            if (!Guid.TryParse(created.SessionId, out var remoteId) || remoteId != sessionId)
            {
                sessionChannel.Dispose();
                return Result<ISessionConnection>.Failure("Sidecar returned unexpected session id");
            }

            var connection = new GrpcSessionConnection(
                sessionId,
                sessionClient,
                sessionChannel,
                _configuration,
                _journalCatalog,
                _options,
                _connectionLogger,
                id => _connections.TryRemove(id, out _));

            sessionChannel = null;

            if (!_connections.TryAdd(sessionId, connection))
            {
                await connection.CloseAsync(ct);
                return Result<ISessionConnection>.Failure("Connection already exists for session");
            }

            await connection.StartStreamsAsync(ct);

            if (HostControlGeneration != hostGenerationAtStart)
            {
                _connectionLogger.LogWarning(
                    "Host control stream reconnected while opening session {SessionId}",
                    sessionId);
            }

            return Result<ISessionConnection>.Success(connection);
        }
        catch (Exception ex)
        {
            sessionChannel?.Dispose();
            return Result<ISessionConnection>.Failure(ex.Message);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _hostLifetime.Cancel();

        lock (_hostControlGate)
        {
            try { _hostControl?.RequestStream.CompleteAsync().GetAwaiter().GetResult(); } catch { /* */ }
            try { _hostControl?.Dispose(); } catch { /* */ }
            _hostControl = null;
        }

        foreach (var kv in _connections)
        {
            _ = kv.Value.CloseAsync();
        }

        _connections.Clear();
        _hostLifetime.Dispose();
        _hostChannel.Dispose();
    }

    private GrpcChannel CreateChannel(string address) =>
        GrpcChannel.ForAddress(address, new GrpcChannelOptions
        {
            MaxReceiveMessageSize = _maxGrpcMessageBytes,
            MaxSendMessageSize = _maxGrpcMessageBytes,
            HttpHandler = new SocketsHttpHandler
            {
                EnableMultipleHttp2Connections = true,
            },
        });

    private async Task PumpHostControlAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && !_disposed)
        {
            AsyncDuplexStreamingCall<HostControlToSidecar, HostControlFromSidecar>? call;
            try
            {
                call = _hostClient.HostControl(cancellationToken: ct);
                lock (_hostControlGate)
                {
                    _hostControl?.Dispose();
                    _hostControl = call;
                    Interlocked.Increment(ref _hostControlGeneration);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (Exception ex)
            {
                _connectionLogger.LogWarning(ex, "Sidecar HostControl open failed");
                try
                {
                    await Task.Delay(_options.LinkRetryBackoff, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }

                continue;
            }

            try
            {
                var ping = Interlocked.Increment(ref _hostPingSeq);
                await call.RequestStream.WriteAsync(new HostControlToSidecar { PingSeq = (ulong)ping }, ct)
                    .ConfigureAwait(false);

                await foreach (var msg in call.ResponseStream.ReadAllAsync(ct).ConfigureAwait(false))
                {
                    Volatile.Write(ref _lastHostAckSeq, (long)msg.AckSeq);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
            {
                return;
            }
            catch (Exception ex)
            {
                _connectionLogger.LogWarning(ex, "Sidecar HostControl stream ended; reopening");
            }
            finally
            {
                lock (_hostControlGate)
                {
                    if (ReferenceEquals(_hostControl, call))
                    {
                        _hostControl = null;
                    }
                }

                try { call.Dispose(); } catch { /* */ }
            }

            if (ct.IsCancellationRequested || _disposed)
            {
                return;
            }

            try
            {
                await Task.Delay(_options.LinkRetryBackoff, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
