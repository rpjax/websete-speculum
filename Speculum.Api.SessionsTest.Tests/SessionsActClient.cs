using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using MessagePack;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Presentation;
using Speculum.Api.Presentation.Sessions;
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
    private readonly ConcurrentQueue<string> _redirects = new();
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

        _connection.On<RedirectHubEvent>("Redirect", ev =>
        {
            if (!string.IsNullOrWhiteSpace(ev.Url))
            {
                _redirects.Enqueue(ev.Url);
            }
        });

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
        Guid? profileId = null,
        CancellationToken ct = default)
        => StartSessionAsync(path, query: "", width, height, device, profileId, waitForReady: true, ct);

    /// <summary>
    /// Start a live session at arbitrary path/query (use <c>_w7s_nso</c> for external hosts).
    /// </summary>
    public async Task<StartSessionHubResponse> StartSessionAsync(
        string path,
        string query = "",
        int width = 1280,
        int height = 720,
        DeviceProfile? device = null,
        Guid? profileId = null,
        bool waitForReady = true,
        CancellationToken ct = default)
    {
        EnsureConnected();
        var hub = _connection!;
        var resolvedProfileId = profileId ?? await EnsureProfileAsync(ct: ct);

        var started = await hub.InvokeAsync<StartSessionHubResponse>(
            "StartSessionAsync",
            new StartSessionHubRequest
            {
                ProfileId = resolvedProfileId,
                Path = path,
                Query = query,
                ViewportWidth = width,
                ViewportHeight = height,
                Device = device,
            },
            ct);

        _sessionId = started.SessionId;
        _token = started.Token;

        if (waitForReady)
        {
            // Effect wait: page usable (navigation done). Prefer evaluate over journal race.
            await WaitEvaluateContainsAsync(
                "document.readyState",
                "complete",
                TimeSpan.FromSeconds(45),
                ct);
        }

        return started;
    }

    /// <summary>
    /// Registers Allow handlers on SessionHooks before initial navigation completes.
    /// </summary>
    public async Task<JsonElement> RegisterPermissionGrantAsync(
        bool camera = true,
        bool microphone = true,
        CancellationToken ct = default)
    {
        EnsureSession();
        using var response = await _http.PostAsJsonAsync(
            $"{_host.ApiBase}/api/sessions/{_sessionId}/permissions/register",
            new
            {
                token = _token,
                camera,
                microphone,
            },
            ct);
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"permission register failed ({(int)response.StatusCode}): {json}");
        }

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False)
        {
            throw new InvalidOperationException($"permission register not ok: {json}");
        }

        return root.Clone();
    }

    public async Task<Guid> EnsureProfileAsync(
        Guid? profileId = null,
        CancellationToken ct = default)
    {
        EnsureConnected();
        var ensured = await _connection!.InvokeAsync<EnsureProfileHubResponse>(
            "EnsureProfileAsync",
            new EnsureProfileHubRequest { ProfileId = profileId },
            ct);
        return ensured.ProfileId;
    }

    public async Task StopSessionAsync(CancellationToken ct = default)
    {
        EnsureConnected();
        if (_sessionId == Guid.Empty || string.IsNullOrEmpty(_token))
        {
            return;
        }

        await _connection!.InvokeAsync(
            "StopSessionAsync",
            new StopSessionHubRequest
            {
                SessionId = _sessionId,
                Token = _token,
            },
            ct);
        _sessionId = Guid.Empty;
        _token = string.Empty;
    }

    public async Task<ProfileSummaryWire> GetProfileAsync(
        Guid profileId,
        CancellationToken ct = default)
    {
        using var response = await _http.GetAsync(
            $"{_host.ApiBase}/api/profiles/{profileId:D}",
            ct);
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"GET profile failed ({(int)response.StatusCode}): {json}");
        }

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        return new ProfileSummaryWire(
            ProfileId: root.GetProperty("profileId").GetGuid(),
            CookieCount: root.GetProperty("cookieCount").GetInt32(),
            LocalStorageCount: root.GetProperty("localStorageCount").GetInt32(),
            IdbRecordCount: root.GetProperty("idbRecordCount").GetInt32(),
            HistoryCount: root.GetProperty("historyCount").GetInt32());
    }

    public async Task<JsonElement> ProbeAsync(
        IReadOnlyList<string> ops,
        string? evaluateExpression = null,
        string? domSelector = null,
        CancellationToken ct = default)
    {
        EnsureSession();
        using var response = await _http.PostAsJsonAsync(
            $"{_host.ApiBase}/api/sessions/{_sessionId}/probe",
            new
            {
                token = _token,
                ops,
                evaluateExpression,
                domSelector,
            },
            ct);
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"probe failed ({(int)response.StatusCode}): {json}");
        }

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False)
        {
            throw new InvalidOperationException($"probe not ok: {json}");
        }

        return root.GetProperty("data").Clone();
    }

    public async Task WaitFixtureHomeStorageSeededAsync(CancellationToken ct = default)
    {
        await WaitEvaluateContainsAsync("localStorage.getItem('sf_ls')", "home-ls", ct: ct);
        await WaitEvaluateContainsAsync(FixtureIdbReadExpression, "home-idb", ct: ct);
    }

    /// <summary>motor-fixture <c>/home</c> IDB oracle (<c>sf_idb</c> store key <c>v</c>).</summary>
    public const string FixtureIdbReadExpression =
        "(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('sf_idb',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const tx=db.transaction('kv','readonly');const g=tx.objectStore('kv').get('v');g.onsuccess=()=>res(g.result);g.onerror=()=>rej(g.error);});})()";

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

    /// <summary>
    /// Wait for a PageProjection frame on the Diff stream (harness opens a consumer).
    /// </summary>
    public async Task<PageProjectionFrameWire> WaitPageProjectionFrameAsync(
        bool requireResync = false,
        int timeoutMs = 45_000,
        CancellationToken ct = default)
    {
        EnsureSession();
        using var response = await _http.PostAsJsonAsync(
            $"{_host.ApiBase}/api/sessions/{_sessionId}/page-projection/wait-frame",
            new { token = _token, timeoutMs, requireResync },
            ct);
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"wait-frame failed ({(int)response.StatusCode}): {json}");
        }

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False)
        {
            throw new InvalidOperationException($"wait-frame not ok: {json}");
        }

        return new PageProjectionFrameWire(
            Sequence: root.GetProperty("sequence").GetInt64(),
            ContextId: root.GetProperty("contextId").GetUInt32(),
            Generation: root.GetProperty("generation").GetInt64(),
            Flags: root.GetProperty("flags").GetUInt32(),
            Resync: root.GetProperty("resync").GetBoolean(),
            BodyLen: root.GetProperty("bodyLen").GetInt32());
    }

    /// <summary>
    /// Id-addressed PP click via Virtual resolve (same EventApplier as PushDomInput).
    /// </summary>
    public async Task ResolveAndClickAsync(string selector, CancellationToken ct = default)
    {
        EnsureSession();
        using var response = await _http.PostAsJsonAsync(
            $"{_host.ApiBase}/api/sessions/{_sessionId}/page-projection/resolve-click",
            new { token = _token, selector },
            ct);
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"resolve-click failed ({(int)response.StatusCode}): {json}");
        }
    }

    /// <summary>POST sealed resync — frame arrives on the Diff stream (not in the HTTP body).</summary>
    public async Task RequestPageProjectionResyncAsync(
        uint contextId = 1,
        string? reason = null,
        CancellationToken ct = default)
    {
        EnsureSession();
        var url =
            $"{_host.ApiBase}/api/sessions/{_sessionId}/page-projection/resync"
            + $"?contextId={contextId}"
            + $"&{SessionBindingAuth.QueryParameterName}={Uri.EscapeDataString(_token)}";
        if (!string.IsNullOrWhiteSpace(reason))
        {
            url += $"&reason={Uri.EscapeDataString(reason)}";
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.TryAddWithoutValidation(SessionBindingAuth.HeaderName, _token);
        using var response = await _http.SendAsync(request, ct);
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"resync failed ({(int)response.StatusCode}): {json}");
        }

        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("ok", out var ok)
            && ok.ValueKind == JsonValueKind.False)
        {
            throw new InvalidOperationException($"resync not ok: {json}");
        }
    }

    public async Task WaitRedirectAsync(
        TimeSpan timeout,
        CancellationToken ct = default,
        Func<string, bool>? predicate = null)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            while (_redirects.TryDequeue(out var url))
            {
                if (predicate is null || predicate(url))
                {
                    return;
                }
            }

            await Task.Delay(100, ct);
        }

        throw new TimeoutException("Timed out waiting for hub Redirect");
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
        Exception? lastError = null;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                last = await EvaluateAsync(expression, ct);
                lastError = null;
                if (last.Contains(expectedSubstring, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }
            catch (HttpRequestException ex)
            {
                // Mid-navigation (e.g. goback) can 400 evaluate until the main frame settles.
                lastError = ex;
            }

            await Task.Delay(250, ct);
        }

        if (lastError is not null)
        {
            throw new TimeoutException(
                $"Evaluate '{expression}' did not contain '{expectedSubstring}'. Last error={lastError.Message}",
                lastError);
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

    /// <summary>Drop all buffered journal facts (e.g. before an absence window).</summary>
    public void ClearJournal()
    {
        while (_journal.TryDequeue(out _))
        {
        }
    }

    /// <summary>Drop buffered hub Redirect events.</summary>
    public void ClearRedirects()
    {
        while (_redirects.TryDequeue(out _))
        {
        }
    }

    /// <summary>Count buffered facts of a type without removing them.</summary>
    public int CountJournal(string type)
    {
        var count = 0;
        var kept = new List<JournalFactWire>();
        while (_journal.TryDequeue(out var item))
        {
            kept.Add(item);
            if (string.Equals(item.Type, type, StringComparison.Ordinal))
            {
                count++;
            }
        }

        foreach (var item in kept)
        {
            _journal.Enqueue(item);
        }

        return count;
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
                    await StopSessionAsync();
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

    public readonly record struct PageProjectionFrameWire(
        long Sequence,
        uint ContextId,
        long Generation,
        uint Flags,
        bool Resync,
        int BodyLen);

    public readonly record struct ProfileSummaryWire(
        Guid ProfileId,
        int CookieCount,
        int LocalStorageCount,
        int IdbRecordCount,
        int HistoryCount);

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
