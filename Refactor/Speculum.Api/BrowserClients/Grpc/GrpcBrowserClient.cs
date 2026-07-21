using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aidan.Core.Patterns;
using Grpc.Net.Client;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sidecar;
using Speculum.Api.Sidecar.V1;

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
    private bool _disposed;

    public GrpcBrowserClient(IOptions<SidecarOptions> options)
    {
        var address = options.Value.GrpcAddress;
        _channel = GrpcChannel.ForAddress(address);
        _client = new BrowserSessionService.BrowserSessionServiceClient(_channel);
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
