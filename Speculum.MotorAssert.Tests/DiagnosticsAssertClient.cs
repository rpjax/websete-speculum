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

    public Task<string> ExpectEvaluateAsync(
        string connectionId,
        string expression,
        string expectedSubstring,
        CancellationToken ct = default)
        => WaitEvaluateContainsAsync(connectionId, expression, expectedSubstring, ct: ct);

    public Task ExpectCookieAsync(
        string connectionId,
        string name,
        string? valueContains = null,
        CancellationToken ct = default)
        => WaitCookieAsync(connectionId, name, valueContains, ct: ct);

    public Task ExpectLocalStorageAsync(
        string connectionId,
        string key,
        string valueContains,
        CancellationToken ct = default)
        => WaitLocalStorageAsync(connectionId, key, valueContains, ct: ct);

    /// <summary>Poll evaluate until the result text contains <paramref name="expectedSubstring"/>.</summary>
    public async Task<string> WaitEvaluateContainsAsync(
        string connectionId,
        string expression,
        string expectedSubstring,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(30));
        Exception? last = null;
        string? lastText = null;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var probe = await PostBrowserProbeAsync(
                    connectionId, ["evaluate"], evaluateExpression: expression, ct: ct);
                if (probe.GetProperty("ok").GetBoolean()
                    && probe.TryGetProperty("data", out var data))
                {
                    lastText = data.ToString();
                    if (lastText.Contains(expectedSubstring, StringComparison.Ordinal))
                        return lastText;
                }
            }
            catch (Exception ex)
            {
                last = ex;
            }

            await Task.Delay(250, ct);
        }

        throw new TimeoutException(
            $"evaluate never contained '{expectedSubstring}' (last={lastText}). {last?.Message}");
    }

    /// <summary>Poll cookies probe until <paramref name="name"/> (and optional value) appears.</summary>
    public async Task WaitCookieAsync(
        string connectionId,
        string name,
        string? valueContains = null,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(30));
        Exception? last = null;
        string? lastBlob = null;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var probe = await PostBrowserProbeAsync(connectionId, ["cookies"], ct: ct);
                if (probe.GetProperty("ok").GetBoolean())
                {
                    lastBlob = probe.GetProperty("data").ToString();
                    if (lastBlob.Contains(name, StringComparison.Ordinal)
                        && (valueContains is null
                            || lastBlob.Contains(valueContains, StringComparison.Ordinal)))
                        return;
                }
            }
            catch (Exception ex)
            {
                last = ex;
            }

            await Task.Delay(250, ct);
        }

        throw new TimeoutException(
            $"cookie '{name}' not observed (last={lastBlob}). {last?.Message}");
    }

    /// <summary>Poll localStorage until key's value contains <paramref name="valueContains"/>.</summary>
    public Task WaitLocalStorageAsync(
        string connectionId,
        string key,
        string valueContains,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
        => WaitEvaluateContainsAsync(
            connectionId,
            $"localStorage.getItem({JsonSerializer.Serialize(key)})",
            valueContains,
            timeout,
            ct);

    /// <summary>
    /// Wait until this connection's disconnect export finished. Must be scoped by
    /// <paramref name="connectionId"/> — a global wait can match another test's export.
    /// </summary>
    public Task WaitStateExportCompletedAsync(
        string connectionId,
        DateTimeOffset since,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
        => WaitForEventsAsync(
            connectionId,
            "Motor.StateExport",
            since,
            ev => HasEvent(ev, "Motor.StateExportCompleted"),
            timeout,
            ct);

    /// <summary>
    /// Wait for a composite <c>Telemetry.SampleCollected</c> event after <paramref name="since"/>
    /// and return its (redacted) payload. Missing sections/fields fail hard downstream.
    /// </summary>
    public async Task<JsonElement> WaitTelemetrySampleAsync(
        DateTimeOffset since,
        Func<JsonElement, bool>? payloadPredicate = null,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        var events = await WaitForEventsAsync(
            null,
            "Telemetry.SampleCollected",
            since,
            ev => ev.Any(e =>
                string.Equals(e.GetProperty("name").GetString(), "Telemetry.SampleCollected", StringComparison.Ordinal)
                && e.TryGetProperty("payload", out var p)
                && (payloadPredicate is null || payloadPredicate(p))),
            timeout ?? TimeSpan.FromSeconds(45),
            ct);

        var sample = events
            .Where(e => string.Equals(e.GetProperty("name").GetString(), "Telemetry.SampleCollected", StringComparison.Ordinal))
            .Select(e => e.GetProperty("payload"))
            .Where(p => payloadPredicate is null || payloadPredicate(p))
            .Last();
        return sample.Clone();
    }

    /// <summary>Wait until Diagnostics.ConfigApplied appears after a config mutation.</summary>
    public async Task WaitConfigAppliedAsync(
        DateTimeOffset since,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        await WaitForEventsAsync(
            null, "Diagnostics.ConfigApplied", since,
            ev => HasEvent(ev, "Diagnostics.ConfigApplied"),
            timeout ?? TimeSpan.FromSeconds(30),
            ct);
    }

    /// <summary>Wait until the fixture probe marker reports the given page id.</summary>
    public async Task WaitFixturePageAsync(
        string connectionId,
        string pageId,
        TimeSpan? timeout = null,
        CancellationToken ct = default)
    {
        await WaitEvaluateContainsAsync(
            connectionId,
            "document.getElementById('speculum-probe')?.dataset?.page",
            pageId,
            timeout,
            ct);
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
