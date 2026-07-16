using System.Text.Json.Serialization;
using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Diagnostics.Pipeline;

/// <summary>
/// Payload for the synthetic <c>Diagnostics.SpanAbandoned</c> close. Carries the abandoned span's
/// key plus <c>errorCode</c>/<c>phase</c> (mandatory for a catalogued failure) and how long the
/// span had been open.
/// </summary>
public sealed record SpanAbandonedPayload(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? SpanKey,
    string ErrorCode,
    string Phase,
    long OpenMs);

/// <summary>
/// Central span correlation. Every event flowing through <see cref="DiagnosticsEventBus"/> is
/// stamped here (right after the capability gate): a monotonic <c>Seq</c> for deterministic
/// ordering, plus span pairing driven purely by the catalog descriptor's <see cref="SpanRole"/>.
/// <list type="bullet">
/// <item><b>Open</b> mints a <c>SpanId</c> keyed by <c>(scope, SpanKey)</c> where scope is the
/// event's <c>ConnectionId</c> (or <c>CorrelationId</c> for connection-less beats), and sets
/// <c>CausationId</c> to the innermost already-open span (parent link) for layered nesting.</item>
/// <item><b>Close</b> echoes the matching open's <c>SpanId</c> and clears it.</item>
/// <item><b>None</b> gets <c>CausationId</c> = the innermost still-open span in the same scope.</item>
/// </list>
/// Open spans are closed synthetically on timeout (<see cref="SweepTimeouts"/>), teardown
/// (<see cref="CloseScope"/>), or boot recovery (<see cref="RecoverFromStore"/>), each emitting a
/// catalogued <c>Diagnostics.SpanAbandoned</c> with <c>errorCode</c>+<c>phase</c>.
/// </summary>
public sealed class SpanTracker
{
    private readonly Lazy<IDiagnosticsEventBus> _bus;
    private readonly TimeProvider _time;
    private readonly object _gate = new();
    private readonly Dictionary<string, OpenSpan> _openBySpanId = new(StringComparer.Ordinal);
    private long _seq;

    public SpanTracker(Lazy<IDiagnosticsEventBus> bus, TimeProvider? timeProvider = null)
    {
        _bus = bus;
        _time = timeProvider ?? TimeProvider.System;
    }

    /// <summary>Count of currently-open spans (test/telemetry visibility).</summary>
    public int OpenSpanCount
    {
        get { lock (_gate) return _openBySpanId.Count; }
    }

    /// <summary>
    /// Stamps <paramref name="evt"/> in place: assigns <c>Seq</c> and resolves span identity from
    /// the descriptor's role. Called by the bus for every catalogued event.
    /// </summary>
    public void Stamp(DiagnosticsEvent evt, DiagnosticsEventDescriptor descriptor)
    {
        evt.Seq = Interlocked.Increment(ref _seq);
        var scope = Scope(evt);
        if (scope is null)
            return;

        lock (_gate)
        {
            switch (descriptor.SpanRole)
            {
                case SpanRole.Open:
                    var spanId = evt.SpanId ?? Guid.NewGuid().ToString("N");
                    // Nest under the innermost span already open in this scope (parent link) so the
                    // timeline can render layered spans; null for a top-level span.
                    if (FindInnermost(scope) is { } parent)
                        evt.CausationId = parent.SpanId;
                    evt.SpanId = spanId;
                    evt.SpanKey = descriptor.SpanKey;
                    _openBySpanId[spanId] = new OpenSpan(
                        spanId, descriptor.SpanKey, scope, evt,
                        Deadline(descriptor.SpanTimeoutSec), evt.Seq, _time.GetUtcNow());
                    break;

                case SpanRole.Close:
                    if (evt.SpanId is not null)
                    {
                        // Pre-stamped synthetic close (abandon / recovery): echo verbatim.
                        _openBySpanId.Remove(evt.SpanId);
                    }
                    else if (FindOpen(scope, descriptor.SpanKey) is { } match)
                    {
                        evt.SpanId = match.SpanId;
                        evt.SpanKey = match.SpanKey;
                        _openBySpanId.Remove(match.SpanId);
                    }
                    else
                    {
                        // Close with no live open (cross-restart / degenerate): standalone beat.
                        evt.SpanKey = descriptor.SpanKey;
                    }
                    break;

                default:
                    if (FindInnermost(scope) is { } inner)
                        evt.CausationId = inner.SpanId;
                    break;
            }
        }
    }

    /// <summary>Abandons open spans whose timeout elapsed. Called each cleanup cycle.</summary>
    public void SweepTimeouts(DateTimeOffset now)
    {
        List<OpenSpan> expired;
        lock (_gate)
        {
            expired = _openBySpanId.Values
                .Where(s => s.Deadline is not null && now >= s.Deadline)
                .ToList();
            foreach (var s in expired)
                _openBySpanId.Remove(s.SpanId);
        }

        foreach (var s in expired)
            PublishAbandon(s, "span_timeout", "timeout");
    }

    /// <summary>Abandons every open span in a scope. Called on disconnect / drain teardown.</summary>
    public void CloseScope(string? scope, string reason)
    {
        if (string.IsNullOrEmpty(scope))
            return;

        List<OpenSpan> closing;
        lock (_gate)
        {
            closing = _openBySpanId.Values
                .Where(s => string.Equals(s.Scope, scope, StringComparison.Ordinal))
                .ToList();
            foreach (var s in closing)
                _openBySpanId.Remove(s.SpanId);
        }

        foreach (var s in closing)
            PublishAbandon(s, "disconnect", reason);
    }

    /// <summary>
    /// Boot recovery: seeds <c>Seq</c> past the persisted maximum so ordering stays monotonic
    /// across restarts, then abandons spans left open by a previous process.
    /// </summary>
    public void RecoverFromStore(SqliteDiagnosticsEventSink sink)
    {
        var maxSeq = sink.QueryMaxSeq();
        if (maxSeq > Interlocked.Read(ref _seq))
            Interlocked.Exchange(ref _seq, maxSeq);

        foreach (var openEvent in sink.QueryOpenSpanEvents())
        {
            if (string.IsNullOrEmpty(openEvent.SpanId))
                continue;

            // A span_id appears once either because its Open never closed (a genuine orphan) OR
            // because storage trim/TTL dropped the older Open and kept the later Close. Only the
            // former is an open span — confirm via the descriptor's role so we never fabricate an
            // abandon for a span that actually closed.
            if (!DiagnosticsEventCatalog.TryGet(openEvent.Name, out var descriptor)
                || descriptor.SpanRole != SpanRole.Open)
                continue;

            var scope = Scope(openEvent) ?? openEvent.SpanId!;
            var span = new OpenSpan(
                openEvent.SpanId!, openEvent.SpanKey, scope, openEvent,
                Deadline: null, OpenSeq: openEvent.Seq, OpenedUtc: openEvent.Utc);
            PublishAbandon(span, "span_abandoned", "recover");
        }
    }

    private void PublishAbandon(OpenSpan span, string errorCode, string phase)
    {
        var openMs = (long)Math.Max(0, (_time.GetUtcNow() - span.OpenedUtc).TotalMilliseconds);
        _bus.Value.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.DiagnosticsSelf,
            Name = "Diagnostics.SpanAbandoned",
            Severity = DiagnosticsSeverity.Warning,
            CorrelationId = span.Source.CorrelationId,
            ConnectionId = span.Source.ConnectionId,
            PersistedSessionId = span.Source.PersistedSessionId,
            SidecarSessionId = span.Source.SidecarSessionId,
            SpanId = span.SpanId,
            SpanKey = span.SpanKey,
            Payload = new SpanAbandonedPayload(span.SpanKey, errorCode, phase, openMs),
        });
    }

    // Newest-open wins (LIFO), which is correct for sequential/nested same-key spans (e.g. two
    // navigates in a row). KNOWN LIMITATION: when a client replaces/cancels a still-active session
    // on the SAME connection, two motor.session spans briefly coexist under one scope; the old
    // session's Close then resolves to the newer span. It self-heals (leftovers are abandoned on
    // disconnect) and only skews the timeline for that rare double-start — not correctness/data.
    // A full fix would scope session spans by correlationId + teardown the old under its own
    // correlation; deferred (touches emit order / MotorAssert).
    private OpenSpan? FindOpen(string scope, string? spanKey)
        => _openBySpanId.Values
            .Where(s => string.Equals(s.Scope, scope, StringComparison.Ordinal)
                        && string.Equals(s.SpanKey, spanKey, StringComparison.Ordinal))
            .OrderByDescending(s => s.OpenSeq)
            .FirstOrDefault();

    private OpenSpan? FindInnermost(string scope)
        => _openBySpanId.Values
            .Where(s => string.Equals(s.Scope, scope, StringComparison.Ordinal))
            .OrderByDescending(s => s.OpenSeq)
            .FirstOrDefault();

    private DateTimeOffset? Deadline(int timeoutSec)
        => timeoutSec > 0 ? _time.GetUtcNow().AddSeconds(timeoutSec) : null;

    private static string? Scope(DiagnosticsEvent evt)
        => !string.IsNullOrEmpty(evt.ConnectionId) ? evt.ConnectionId
            : !string.IsNullOrEmpty(evt.CorrelationId) ? evt.CorrelationId
            : null;

    private sealed record OpenSpan(
        string SpanId,
        string? SpanKey,
        string Scope,
        DiagnosticsEvent Source,
        DateTimeOffset? Deadline,
        long OpenSeq,
        DateTimeOffset OpenedUtc);
}
