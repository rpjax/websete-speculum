using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Speculum.MotorAssert.Tests;

/// <summary>
/// Act→Assert helpers for diagnostics probes/snapshots. Missing properties fail hard.
/// </summary>
public sealed class DiagnosticsAssertClient(MotorAssertHost host)
{
    private static readonly JsonSerializerOptions Json = MotorAssertHost.Json;

    public async Task<JsonElement> GetRuntimeAsync(CancellationToken ct = default)
    {
        using var doc = await host.Http.GetFromJsonAsync<JsonDocument>("api/admin/diagnostics/v1/runtime", Json, ct);
        return doc!.RootElement.Clone();
    }

    public async Task<JsonElement?> TryGetSessionAsync(string connectionId, CancellationToken ct = default)
    {
        var res = await host.Http.GetAsync($"api/admin/diagnostics/v1/sessions/{connectionId}", ct);
        if (res.StatusCode == HttpStatusCode.NotFound)
            return null;
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.Clone();
    }

    public async Task<JsonElement> RequireSessionAsync(string connectionId, CancellationToken ct = default)
    {
        var session = await TryGetSessionAsync(connectionId, ct);
        Assert.NotNull(session);
        return session!.Value;
    }

    public JsonElement RequireSnapshot(JsonElement sessionEnvelope)
    {
        Assert.True(sessionEnvelope.TryGetProperty("snapshot", out var snap), "session envelope missing snapshot");
        return snap;
    }

    public string RequireString(JsonElement obj, string name)
    {
        Assert.True(obj.TryGetProperty(name, out var el), $"missing property '{name}'");
        var s = el.GetString();
        Assert.False(string.IsNullOrWhiteSpace(s), $"property '{name}' empty");
        return s!;
    }

    public bool RequireBool(JsonElement obj, string name)
    {
        Assert.True(obj.TryGetProperty(name, out var el), $"missing property '{name}'");
        Assert.True(el.ValueKind is JsonValueKind.True or JsonValueKind.False, $"property '{name}' not bool");
        return el.GetBoolean();
    }

    public async Task AssertSessionGoneAsync(string connectionId, CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(30);
        HttpResponseMessage? last = null;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            last = await host.Http.GetAsync($"api/admin/diagnostics/v1/sessions/{connectionId}", ct);
            if (last.StatusCode == HttpStatusCode.NotFound)
            {
                using var doc = JsonDocument.Parse(await last.Content.ReadAsStringAsync(ct));
                Assert.Equal("session_gone", doc.RootElement.GetProperty("errorCode").GetString());
                return;
            }

            await Task.Delay(200, ct);
        }

        throw new TimeoutException(
            $"Session {connectionId} still present after disconnect (last={(int?)last?.StatusCode}).");
    }

    public async Task<IReadOnlyList<JsonElement>> WaitForEventsAsync(
        string? connectionId,
        string namePrefix,
        DateTimeOffset since,
        Func<IReadOnlyList<JsonElement>, bool> predicate,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(45));
        Exception? last = null;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var events = await QueryEventsAsync(connectionId, namePrefix, since, ct);
                if (predicate(events))
                    return events;
            }
            catch (Exception ex)
            {
                last = ex;
            }

            await Task.Delay(400, ct);
        }

        var dump = Path.Combine(
            Environment.GetEnvironmentVariable("MOTOR_ASSERT_DUMP_DIR") ?? Path.GetTempPath(),
            "motor-assert-fail-" + Guid.NewGuid().ToString("N"));
        await host.DumpFailureAsync(connectionId, since, dump);
        throw new TimeoutException(
            $"Timed out waiting for events namePrefix={namePrefix}. Dump: {dump}. Last={last?.Message}");
    }

    public async Task<IReadOnlyList<JsonElement>> QueryEventsAsync(
        string? connectionId,
        string? namePrefix,
        DateTimeOffset? since,
        CancellationToken ct = default)
    {
        var qs = new StringBuilder("api/admin/diagnostics/v1/events?");
        if (since is not null)
            qs.Append("since=").Append(Uri.EscapeDataString(since.Value.ToUniversalTime().ToString("o"))).Append('&');
        if (!string.IsNullOrEmpty(namePrefix))
            qs.Append("namePrefix=").Append(Uri.EscapeDataString(namePrefix)).Append('&');
        if (!string.IsNullOrEmpty(connectionId))
            qs.Append("connectionId=").Append(Uri.EscapeDataString(connectionId));

        using var doc = await host.Http.GetFromJsonAsync<JsonDocument>(qs.ToString().TrimEnd('&', '?'), Json, ct);
        return doc!.RootElement.EnumerateArray().Select(e => e.Clone()).ToArray();
    }

    public async Task<JsonElement> PostBrowserProbeAsync(
        string connectionId,
        string[] ops,
        string? evaluateExpression = null,
        string? domSelector = null,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["ops"] = ops,
            ["evaluateExpression"] = evaluateExpression,
            ["domSelector"] = domSelector,
            ["correlationId"] = Guid.NewGuid().ToString("N"),
        };
        var res = await host.Http.PostAsJsonAsync(
            $"api/admin/diagnostics/v1/sessions/{connectionId}/browser", body, Json, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(text);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"Probe failed {(int)res.StatusCode}: {text}");
        return doc.RootElement.Clone();
    }

    public async Task<string> ExpectEvaluateAsync(
        string connectionId,
        string expression,
        string expectedSubstring,
        CancellationToken ct = default)
    {
        var probe = await PostBrowserProbeAsync(connectionId, ["evaluate"], evaluateExpression: expression, ct: ct);
        Assert.True(probe.GetProperty("ok").GetBoolean(), probe.ToString());
        Assert.True(probe.TryGetProperty("data", out var data), "probe missing data");
        var text = data.ToString();
        Assert.Contains(expectedSubstring, text, StringComparison.Ordinal);
        return text;
    }

    public async Task ExpectCookieAsync(
        string connectionId,
        string name,
        string? valueContains = null,
        CancellationToken ct = default)
    {
        var probe = await PostBrowserProbeAsync(connectionId, ["cookies"], ct: ct);
        Assert.True(probe.GetProperty("ok").GetBoolean(), probe.ToString());
        var blob = probe.GetProperty("data").ToString();
        Assert.Contains(name, blob, StringComparison.Ordinal);
        if (valueContains is not null)
            Assert.Contains(valueContains, blob, StringComparison.Ordinal);
    }

    public async Task ExpectLocalStorageAsync(
        string connectionId,
        string key,
        string valueContains,
        CancellationToken ct = default)
    {
        var probe = await PostBrowserProbeAsync(
            connectionId,
            ["evaluate"],
            evaluateExpression: $"localStorage.getItem({JsonSerializer.Serialize(key)})",
            ct: ct);
        Assert.True(probe.GetProperty("ok").GetBoolean(), probe.ToString());
        Assert.Contains(valueContains, probe.GetProperty("data").ToString(), StringComparison.Ordinal);
    }

    public async Task WaitFrameSequenceAtLeastAsync(
        string connectionId,
        long minSequence,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(45));
        while (DateTime.UtcNow < deadline)
        {
            var session = await RequireSessionAsync(connectionId, ct);
            var snap = RequireSnapshot(session);
            Assert.True(snap.TryGetProperty("frameSequence", out var seqEl), "snapshot missing frameSequence");
            if (seqEl.GetInt64() >= minSequence)
                return;
            await Task.Delay(200, ct);
        }

        throw new TimeoutException($"frameSequence never reached {minSequence}");
    }

    public static bool HasEvent(IReadOnlyList<JsonElement> events, string name, string? correlationId = null)
        => events.Any(e =>
            string.Equals(e.GetProperty("name").GetString(), name, StringComparison.Ordinal)
            && (correlationId is null
                || string.Equals(e.GetProperty("correlationId").GetString(), correlationId, StringComparison.Ordinal)));

    public static JsonElement RequireProperty(JsonElement obj, string name)
    {
        Assert.True(obj.TryGetProperty(name, out var el), $"missing property '{name}' on {obj}");
        return el;
    }

    public async Task<(int ActiveCount, int StartingCount)> GetRegistryCountsAsync(CancellationToken ct = default)
    {
        using var doc = await host.Http.GetFromJsonAsync<JsonDocument>("api/admin/diagnostics/v1/sessions", Json, ct);
        var root = doc!.RootElement;
        var active = RequireProperty(root, "activeCount").GetInt32();
        var starting = root.TryGetProperty("startingCount", out var sc) ? sc.GetInt32() : 0;
        return (active, starting);
    }
}
