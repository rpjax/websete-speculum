using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using MessagePack;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Presentation;
using Speculum.Api.Presentation.Sessions.Dtos;
using Speculum.Api.Sessions.Models;

namespace Speculum.SessionsTest.Tests;

/// <summary>
/// Act client for Refactor SessionHub + token-gated sessions harness input/evaluate/resize.
/// </summary>
public sealed class SessionsActClient : IAsyncDisposable
{
    private readonly SessionsTestHost _host;
    private readonly HttpClient _http = new();
    private HubConnection? _connection;
    private Guid _sessionId;
    private string _token = string.Empty;
    private readonly ConcurrentQueue<JournalFactWire> _journal = new();
    private readonly TaskCompletionSource _journalSubscribed = new(
        TaskCreationOptions.RunContinuationsAsynchronously);
    private CancellationTokenSource? _journalCts;
    private Task? _journalPump;

    public SessionsActClient(SessionsTestHost host) => _host = host;

    public Guid SessionId => _sessionId;
    public string Token => _token;
    public string? ConnectionId => _connection?.ConnectionId;

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        _connection = new HubConnectionBuilder()
            .WithUrl($"{_host.ApiBase}/vhub", o =>
            {
                o.Transports = HttpTransportType.WebSockets;
            })
            .AddMessagePackProtocol(options =>
            {
                options.SerializerOptions = SessionHubMessagePack.Options;
            })
            .WithAutomaticReconnect()
            .Build();

        await _connection.StartAsync(ct);

        _journalCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _journalPump = PumpJournalAsync(_journalCts.Token);

        // Wait until StreamJournal GetAsyncEnumerator has started the hub method
        // (Subscribe runs before any yield — no replay of earlier facts).
        using var readyCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        readyCts.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            await _journalSubscribed.Task.WaitAsync(readyCts.Token);
        }
        catch (OperationCanceledException)
        {
            throw new TimeoutException("Journal StreamJournalAsync did not subscribe in time");
        }
    }

    private async Task PumpJournalAsync(CancellationToken ct)
    {
        try
        {
            var stream = _connection!.StreamAsync<JournalFactWire>("StreamJournalAsync", ct);
            await using var enumerator = stream.GetAsyncEnumerator(ct);
            // Enumerator construction sends the stream invoke; hub Subscribe is in flight.
            _journalSubscribed.TrySetResult();

            while (await enumerator.MoveNextAsync())
            {
                _journal.Enqueue(enumerator.Current);
            }
        }
        catch (OperationCanceledException)
        {
            _journalSubscribed.TrySetResult();
        }
        catch (Exception ex)
        {
            _journalSubscribed.TrySetException(ex);
        }
    }

    public Task<StartSessionHubResponse> StartFixturePageAsync(
        string path,
        int width = 1280,
        int height = 720,
        DeviceProfile? device = null,
        CancellationToken ct = default)
        => StartSessionAsync(path, query: "", width, height, device, ct);

    /// <summary>
    /// Start a live session at arbitrary path/query (use <c>_w7s_nso</c> for external hosts).
    /// </summary>
    public async Task<StartSessionHubResponse> StartSessionAsync(
        string path,
        string query = "",
        int width = 1280,
        int height = 720,
        DeviceProfile? device = null,
        CancellationToken ct = default)
    {
        EnsureConnected();
        var hub = _connection!;

        var ensured = await hub.InvokeAsync<EnsureProfileHubResponse>(
            "EnsureProfileAsync",
            new EnsureProfileHubRequest { ProfileId = null },
            ct);

        var started = await hub.InvokeAsync<StartSessionHubResponse>(
            "StartSessionAsync",
            new StartSessionHubRequest
            {
                ProfileId = ensured.ProfileId,
                Path = path,
                Query = query,
                ViewportWidth = width,
                ViewportHeight = height,
                Device = device,
            },
            ct);

        _sessionId = started.SessionId;
        _token = started.Token;

        // Effect wait: page usable (navigation done). Prefer evaluate over journal race.
        await WaitEvaluateContainsAsync(
            "document.readyState",
            "complete",
            TimeSpan.FromSeconds(45),
            ct);
        return started;
    }

    public async Task SendClickAsync(double x, double y, CancellationToken ct = default)
    {
        await SendInputAsync(
            "mousedown",
            $"{{\"type\":\"mousedown\",\"x\":{x},\"y\":{y},\"button\":0}}",
            ct);
        await SendInputAsync(
            "mouseup",
            $"{{\"type\":\"mouseup\",\"x\":{x},\"y\":{y},\"button\":0}}",
            ct);
    }

    public Task SendKeyAsync(string key, CancellationToken ct = default)
        => SendInputAsync(
            "keydown",
            $"{{\"type\":\"keydown\",\"key\":{JsonSerializer.Serialize(key)}}}",
            ct);

    public Task SendWheelAsync(double x, double y, double deltaY, CancellationToken ct = default)
        => SendInputAsync(
            "wheel",
            $"{{\"type\":\"wheel\",\"x\":{x},\"y\":{y},\"deltaX\":0,\"deltaY\":{deltaY}}}",
            ct);

    public Task SendTextAsync(string text, CancellationToken ct = default)
        => SendInputAsync(
            "text",
            $"{{\"type\":\"text\",\"text\":{JsonSerializer.Serialize(text)},\"source\":\"assert\"}}",
            ct);

    public async Task SendTouchTapAsync(double x, double y, int id = 1, CancellationToken ct = default)
    {
        await SendTouchAsync("start", [new TouchPointWire(id, x, y)], [id], ct);
        await SendTouchAsync("end", [], [id], ct);
    }

    public Task SendTouchAsync(
        string phase,
        TouchPointWire[] points,
        int[] changedIds,
        CancellationToken ct = default)
    {
        var pointsJson = string.Join(",", points.Select(p =>
            $"{{\"id\":{p.Id},\"x\":{p.X},\"y\":{p.Y},\"radiusX\":1,\"radiusY\":1,\"force\":0.5}}"));
        var idsJson = string.Join(",", changedIds);
        var payload =
            $"{{\"type\":\"touch\",\"phase\":{JsonSerializer.Serialize(phase)},\"points\":[{pointsJson}],\"changedIds\":[{idsJson}]}}";
        return SendInputAsync("touch", payload, ct);
    }

    public async Task SendInputAsync(string type, string payload, CancellationToken ct = default)
    {
        EnsureSession();
        using var response = await _http.PostAsJsonAsync(
            $"{_host.ApiBase}/api/sessions/{_sessionId}/input",
            new { token = _token, type, payload },
            ct);
        response.EnsureSuccessStatusCode();
    }

    public async Task<string> EvaluateAsync(string expression, CancellationToken ct = default)
    {
        EnsureSession();
        using var response = await _http.PostAsJsonAsync(
            $"{_host.ApiBase}/api/sessions/{_sessionId}/evaluate",
            new { token = _token, expression },
            ct);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var root = doc.RootElement;
        if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False)
        {
            throw new InvalidOperationException(
                $"Evaluate failed: {root.GetPropertyOrDefault("errorCode")} {root.GetPropertyOrDefault("message")}");
        }

        if (root.TryGetProperty("evaluate", out var evaluate))
        {
            return evaluate.ValueKind == JsonValueKind.String
                ? evaluate.GetString() ?? ""
                : evaluate.ToString();
        }

        if (root.TryGetProperty("data", out var data)
            && data.ValueKind == JsonValueKind.Object
            && data.TryGetProperty("evaluate", out var nested))
        {
            return nested.ValueKind == JsonValueKind.String
                ? nested.GetString() ?? ""
                : nested.ToString();
        }

        throw new InvalidOperationException(
            "Evaluate response missing evaluate value: " + root);
    }

    public async Task WaitEvaluateContainsAsync(
        string expression,
        string expectedSubstring,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(30));
        string? last = null;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            last = await EvaluateAsync(expression, ct);
            if (last.Contains(expectedSubstring, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            await Task.Delay(250, ct);
        }

        throw new TimeoutException(
            $"Evaluate '{expression}' did not contain '{expectedSubstring}'. Last={last}");
    }

    public async Task<NavigateSessionHubResponse> NavigateAsync(
        string path,
        string query = "",
        CancellationToken ct = default)
    {
        EnsureConnected();
        EnsureSession();
        return await _connection!.InvokeAsync<NavigateSessionHubResponse>(
            "NavigateAsync",
            new NavigateSessionHubRequest
            {
                SessionId = _sessionId,
                Token = _token,
                Path = path,
                Query = query,
            },
            ct);
    }

    public async Task<ResizeSessionHubResponse> ResizeAsync(
        int width,
        int height,
        DeviceProfile? device = null,
        CancellationToken ct = default)
    {
        EnsureConnected();
        EnsureSession();
        return await _connection!.InvokeAsync<ResizeSessionHubResponse>(
            "ResizeAsync",
            new ResizeSessionHubRequest
            {
                SessionId = _sessionId,
                Token = _token,
                Width = width,
                Height = height,
                RequestId = Guid.NewGuid().ToString("D"),
                Device = device,
            },
            ct);
    }

    public async Task WaitJournalAsync(
        string type,
        TimeSpan timeout,
        CancellationToken ct = default,
        Func<JournalFactWire, bool>? predicate = null)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (TryTakeJournal(type, predicate, out _))
            {
                return;
            }

            await Task.Delay(100, ct);
        }

        throw new TimeoutException($"Timed out waiting for journal type {type}");
    }

    /// <summary>
    /// Removes and returns the first matching fact; leaves unrelated facts in the queue.
    /// </summary>
    public bool TryTakeJournal(
        string type,
        Func<JournalFactWire, bool>? predicate,
        out JournalFactWire? fact)
    {
        var kept = new List<JournalFactWire>();
        fact = null;
        var found = false;
        while (_journal.TryDequeue(out var item))
        {
            if (!found
                && string.Equals(item.Type, type, StringComparison.Ordinal)
                && (predicate is null || predicate(item)))
            {
                fact = item;
                found = true;
                continue;
            }

            kept.Add(item);
        }

        foreach (var item in kept)
        {
            _journal.Enqueue(item);
        }

        return found;
    }

    public async ValueTask DisposeAsync()
    {
        if (_journalCts is not null)
        {
            await _journalCts.CancelAsync();
            _journalCts.Dispose();
        }

        if (_journalPump is not null)
        {
            try
            {
                await _journalPump;
            }
            catch
            {
                // ignore
            }
        }

        if (_connection is not null)
        {
            try
            {
                if (_sessionId != Guid.Empty && !string.IsNullOrEmpty(_token))
                {
                    await _connection.InvokeAsync(
                        "StopSessionAsync",
                        new StopSessionHubRequest
                        {
                            SessionId = _sessionId,
                            Token = _token,
                        });
                }
            }
            catch
            {
                // best-effort
            }

            await _connection.DisposeAsync();
        }

        _http.Dispose();
    }

    private void EnsureConnected()
    {
        if (_connection is null)
        {
            throw new InvalidOperationException("Not connected");
        }
    }

    private void EnsureSession()
    {
        if (_sessionId == Guid.Empty || string.IsNullOrEmpty(_token))
        {
            throw new InvalidOperationException("No live session");
        }
    }

    public readonly record struct TouchPointWire(int Id, double X, double Y);

    [MessagePackObject]
    public sealed class JournalFactWire
    {
        [Key("id")]
        public Guid Id { get; set; }

        [Key("type")]
        public string Type { get; set; } = "";

        [Key("schemaVersion")]
        public int SchemaVersion { get; set; }

        [Key("payload")]
        public string? Payload { get; set; }
    }
}

file static class JsonElementExtensions
{
    public static string GetPropertyOrDefault(this JsonElement root, string name)
        => root.TryGetProperty(name, out var value) ? value.ToString() : "";
}
