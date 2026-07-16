using System.Text.Json;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Diagnostics.Probes;
using Speculum.Api.Motor.Live;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Diagnostics.Query;

public static class DiagnosticsEndpoints
{
    public static void MapDiagnosticsEndpoints(this WebApplication app)
    {
        var g = app.MapGroup("/api/admin/diagnostics/v1");

        g.MapGet("/runtime", (IDiagnosticsRuntime runtime, IDiagnosticsRedactor redactor) =>
        {
            var snap = runtime.GetSnapshot();
            return Results.Ok(new
            {
                diagnosticsSchemaVersion = snap.DiagnosticsSchemaVersion,
                enabled = snap.Enabled,
                effectiveCapabilities = snap.EffectiveCapabilities,
                elevate = snap.Elevate,
                degraded = snap.Degraded,
                bytesUsed = snap.BytesUsed,
                storageMaxBytes = snap.StorageMaxBytes,
                eventsStored = snap.EventsStored,
                eventsDropped = snap.EventsDropped,
                overflowCount = snap.OverflowCount,
                probeInFlight = snap.ProbeInFlight,
                lastCleanupUtc = snap.LastCleanupUtc,
                redactionMode = redactor.Mode,
                redaction = redactor.Mode,
            });
        });

        // SPA operator overview — composes existing runtime + session registry (no new motor behaviour).
        g.MapGet("/overview", (IDiagnosticsRuntime runtime, IDiagnosticsRedactor redactor, IMotorSessionRegistry registry) =>
        {
            var snap = runtime.GetSnapshot();
            return Results.Ok(new
            {
                diagnosticsSchemaVersion = snap.DiagnosticsSchemaVersion,
                enabled = snap.Enabled,
                degraded = snap.Degraded,
                elevate = snap.Elevate,
                bytesUsed = snap.BytesUsed,
                eventsStored = snap.EventsStored,
                eventsDropped = snap.EventsDropped,
                overflowCount = snap.OverflowCount,
                probeInFlight = snap.ProbeInFlight,
                lastCleanupUtc = snap.LastCleanupUtc,
                redactionMode = redactor.Mode,
                storageMaxBytes = snap.StorageMaxBytes,
                effectiveCapabilities = snap.EffectiveCapabilities,
                liveSessions = new
                {
                    activeCount = registry.ActiveCount,
                    startingCount = registry.StartingCount,
                    total = registry.ActiveCount + registry.StartingCount,
                },
                needsAttention = snap.Degraded
                    ? new[] { "Diagnostics circuit is degraded — probes may be capped. Use Recover." }
                    : Array.Empty<string>(),
            });
        });

        g.MapPut("/elevate", async (HttpContext http, IDiagnosticsRuntime runtime, IDiagnosticsSelfEmitter self) =>
        {
            using var doc = await JsonDocument.ParseAsync(http.Request.Body);
            var root = doc.RootElement;
            var minutes = root.TryGetProperty("minutes", out var m) && m.TryGetInt32(out var mins) ? mins : 15;

            minutes = Math.Clamp(minutes, 1, runtime.GetSnapshot().Options.Elevate.BrowserQueryMaxMinutes);
            var actor = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            runtime.SetElevate(TimeSpan.FromMinutes(minutes));
            self.ElevateStarted(minutes, actor);
            return Results.Ok(new { elevated = true, minutes, redaction = "none" });
        });

        g.MapDelete("/elevate", (HttpContext http, IDiagnosticsRuntime runtime, IDiagnosticsSelfEmitter self) =>
        {
            var actor = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            runtime.ClearElevate();
            self.ElevateExpired("manual_clear", actor);
            return Results.Ok(new { elevated = false });
        });

        // Ops/lab: circuit breaker recovery must not wait for the cleanup timer alone.
        // Degraded caps effective capabilities at Metric and blocks BrowserQuery probes.
        g.MapPost("/recover", (HttpContext http, IDiagnosticsRuntime runtime, IDiagnosticsSelfEmitter self) =>
        {
            var actor = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var wasDegraded = runtime.IsDegraded;
            if (wasDegraded)
            {
                runtime.SetDegraded(false);
                self.Recovered("manual_recover", actor);
            }

            return Results.Ok(new { degraded = false, recovered = wasDegraded });
        });

        g.MapGet("/host", async (
            IEnumerable<IDiagnosticsProbeProvider> providers,
            IDiagnosticsRedactor redactor) =>
        {
            var hostProbe = providers.FirstOrDefault(p => p.Name == "host-resources");
            if (hostProbe is null)
                return Results.Json(new { errorCode = "probe_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);

            var result = await hostProbe.ExecuteAsync(new ProbeRequest());
            if (!result.Ok)
                return Results.Json(new { errorCode = result.ErrorCode }, statusCode: StatusCodes.Status403Forbidden);

            return Results.Ok(new
            {
                data = redactor.RedactProbeResult(result.Data!),
                redaction = redactor.Mode,
            });
        });

        g.MapGet("/resolve", (
            string? connectionId,
            string? persistedSessionId,
            string? sidecarSessionId,
            IMotorSessionRegistry registry,
            IDiagnosticsRuntime runtime,
            IDiagnosticsRedactor redactor) =>
        {
            IMotorSession? session = null;
            string? resolvedConnectionId = connectionId;

            if (!string.IsNullOrWhiteSpace(connectionId))
                session = registry.Get(connectionId);
            else if (!string.IsNullOrWhiteSpace(persistedSessionId)
                     && registry.TryFindByPersistedSessionId(persistedSessionId, out var byPersisted, out var cid))
            {
                session = byPersisted;
                resolvedConnectionId = cid;
            }
            else if (!string.IsNullOrWhiteSpace(sidecarSessionId)
                     && registry.TryFindBySidecarSessionId(sidecarSessionId, out var bySidecar, out var scid))
            {
                session = bySidecar;
                resolvedConnectionId = scid;
            }

            if (session is null)
                return Results.NotFound(new { errorCode = "motor_not_found" });

            var snap = ShapeSnapshot(session.GetDiagnosticsSnapshot(), runtime);
            return Results.Ok(new
            {
                connectionId = resolvedConnectionId,
                snapshot = redactor.RedactSessionSnapshot(snap),
                redaction = redactor.Mode,
            });
        });

        g.MapGet("/sessions", (IMotorSessionRegistry registry) =>
            Results.Ok(new
            {
                activeCount = registry.ActiveCount,
                startingCount = registry.StartingCount,
                sessions = registry.ListSessions(),
            }));

        g.MapGet("/sessions/{connectionId}", (
            string connectionId,
            IMotorSessionRegistry registry,
            IDiagnosticsRuntime runtime,
            IDiagnosticsRedactor redactor) =>
        {
            var session = registry.Get(connectionId);
            if (session is null)
                return Results.NotFound(new { errorCode = "session_gone" });

            var snap = ShapeSnapshot(session.GetDiagnosticsSnapshot(), runtime);
            return Results.Ok(new
            {
                snapshot = redactor.RedactSessionSnapshot(snap),
                redaction = redactor.Mode,
            });
        });

        g.MapGet("/sessions/{connectionId}/events", (
            string connectionId,
            DateTimeOffset? since,
            string? namePrefix,
            SessionEventRing ring,
            SqliteDiagnosticsEventSink sink,
            IDiagnosticsRedactor redactor) =>
            Results.Ok(QueryTimeline(connectionId, since, namePrefix, ring, sink, redactor)));

        // Global timeline (Drain / DiagnosticsSelf / events without connectionId).
        g.MapGet("/events", (
            DateTimeOffset? since,
            string? namePrefix,
            string? connectionId,
            SessionEventRing ring,
            SqliteDiagnosticsEventSink sink,
            IDiagnosticsRedactor redactor) =>
            Results.Ok(QueryTimeline(connectionId, since, namePrefix, ring, sink, redactor)));

        // Telemetry explorer history — server-side time range + keyset pagination + optional
        // downsampling. Distinct from /events so the shared timeline contract stays untouched.
        // Raw mode (bucketSeconds unset/0): { items, total, nextCursor } paged by cursor.
        // Bucketed mode (bucketSeconds > 0): last-sample-per-bucket over the whole range for charts.
        g.MapGet("/telemetry/history", (
            DateTimeOffset? since,
            DateTimeOffset? until,
            string? connectionId,
            string? namePrefix,
            int? limit,
            string? cursor,
            int? bucketSeconds,
            SqliteDiagnosticsEventSink sink,
            IDiagnosticsRedactor redactor) =>
        {
            var prefix = string.IsNullOrWhiteSpace(namePrefix) ? "Telemetry." : namePrefix;

            if (bucketSeconds is > 0)
            {
                var bucketed = sink.QueryEventsBucketed(connectionId, since, until, prefix, bucketSeconds.Value);
                return Results.Ok(new
                {
                    items = bucketed.Select(e => ShapeEvent(e, redactor)),
                    total = (long)bucketed.Count,
                    nextCursor = (string?)null,
                    bucketSeconds = bucketSeconds.Value,
                    redaction = redactor.Mode,
                });
            }

            var (curUtc, curId) = SqliteDiagnosticsEventSink.DecodeCursor(cursor);
            var page = sink.QueryEventsPaged(connectionId, since, until, prefix, limit ?? 200, curUtc, curId);
            return Results.Ok(new
            {
                items = page.Items.Select(e => ShapeEvent(e, redactor)),
                total = page.Total,
                nextCursor = page.NextCursor,
                bucketSeconds = 0,
                redaction = redactor.Mode,
            });
        });

        g.MapPost("/sessions/{connectionId}/browser", async (
            string connectionId,
            HttpContext http,
            IMotorSessionRegistry registry,
            IDiagnosticsRuntime runtime,
            ISidecarDiagnosticsEmitter sidecarDiag,
            IDiagnosticsRedactor redactor,
            DiagnosticsProbeGate probeGate,
            IEnumerable<IDiagnosticsProbeProvider> providers) =>
        {
            var session = registry.Get(connectionId);
            if (session is null)
                return Results.NotFound(new { errorCode = "session_gone" });

            if (!probeGate.TryEnter(connectionId, out var lease) || lease is null)
            {
                sidecarDiag.ProbeBusyRejected(connectionId);
                return Results.Json(new { errorCode = "probe_busy" },
                    statusCode: StatusCodes.Status429TooManyRequests);
            }

            using (lease)
            {
                using var doc = await JsonDocument.ParseAsync(http.Request.Body);
                var root = doc.RootElement;
                var ops = root.TryGetProperty("ops", out var opsEl) && opsEl.ValueKind == JsonValueKind.Array
                    ? opsEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToArray()
                    : Array.Empty<string>();
                var evaluate = root.TryGetProperty("evaluateExpression", out var ev) ? ev.GetString() : null;
                var selector = root.TryGetProperty("domSelector", out var sel) ? sel.GetString() : null;
                var correlationId = root.TryGetProperty("correlationId", out var cid)
                    ? cid.GetString()
                    : Guid.NewGuid().ToString("N");

                var needsBrowserQuery = ops.Any(o =>
                    o is "cookies" or "storage" or "dom" or "evaluate");
                if (needsBrowserQuery
                    && !runtime.IsCapabilityEnabled(DiagnosticsDomain.BrowserQuery, DiagnosticsCapability.Probe))
                {
                    return Results.Json(new { errorCode = "probe_level_insufficient" },
                        statusCode: StatusCodes.Status403Forbidden);
                }

                if (!runtime.IsCapabilityEnabled(DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric))
                {
                    return Results.Json(new { errorCode = "probe_level_insufficient" },
                        statusCode: StatusCodes.Status403Forbidden);
                }

                sidecarDiag.ProbeRequested(connectionId, correlationId, session.PersistedSessionId, ops);

                var sidecar = providers.FirstOrDefault(p => p.Name == "sidecar-diag");
                if (sidecar is null)
                    return Results.Json(new { errorCode = "probe_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);

                try
                {
                    using var probeScope = runtime is DiagnosticsRuntime concrete ? concrete.BeginProbe() : null;
                    var opts = runtime.GetSnapshot().Options.Probe;
                    using var cts = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);
                    cts.CancelAfter(opts.DiagTimeoutMs);

                    var result = await sidecar.ExecuteAsync(new ProbeRequest
                    {
                        ConnectionId = connectionId,
                        Ops = ops,
                        EvaluateExpression = evaluate,
                        DomSelector = selector,
                        CorrelationId = correlationId,
                        MaxProbeResponseBytes = opts.MaxProbeResponseBytes,
                    }, cts.Token);

                    if (!result.Ok)
                    {
                        var status = result.ErrorCode switch
                        {
                            "probe_timeout" => StatusCodes.Status504GatewayTimeout,
                            "response_too_large" => StatusCodes.Status413PayloadTooLarge,
                            "probe_level_insufficient" => StatusCodes.Status403Forbidden,
                            _ => StatusCodes.Status404NotFound,
                        };
                        var errorCode = result.ErrorCode ?? "probe_failed";
                        if (result.ErrorCode == "probe_timeout")
                            sidecarDiag.ProbeTimedOut(connectionId, correlationId, ops, errorCode);
                        else
                            sidecarDiag.ProbeRejected(connectionId, correlationId, ops, errorCode);
                        return Results.Json(new { errorCode = result.ErrorCode }, statusCode: status);
                    }

                    sidecarDiag.ProbeCompleted(connectionId, correlationId, session.PersistedSessionId, ops);

                    return Results.Ok(new
                    {
                        ok = true,
                        correlationId,
                        data = redactor.RedactProbeResult(result.Data!),
                        redaction = redactor.Mode,
                    });
                }
                catch (OperationCanceledException)
                {
                    sidecarDiag.ProbeTimedOut(connectionId, correlationId, ops);
                    return Results.Json(new { errorCode = "probe_timeout" }, statusCode: StatusCodes.Status504GatewayTimeout);
                }
            }
        });

        g.MapGet("/catalog/events", () =>
            Results.Ok(new
            {
                diagnosticsSchemaVersion = DiagnosticsSchema.Version,
                events = DiagnosticsEventCatalog.All,
            }));

        g.MapGet("/persisted", async (IBrowserSessionStore sessions) =>
            Results.Ok(await sessions.ListSessionsAsync()));

        g.MapGet("/persisted/{sessionId}", async (
            string sessionId,
            IBrowserSessionStore sessions,
            IDiagnosticsRuntime runtime,
            IDiagnosticsRedactor redactor) =>
        {
            if (!runtime.IsCapabilityEnabled(DiagnosticsDomain.PersistedSessions, DiagnosticsCapability.Snapshot))
                return Results.Json(new { errorCode = "probe_level_insufficient" }, statusCode: StatusCodes.Status403Forbidden);

            var detail = await sessions.GetSessionDetailAsync(sessionId);
            if (detail is null)
                return Results.NotFound(new { errorCode = "session_gone" });

            return Results.Ok(new
            {
                detail = redactor.RedactPersistedDetail(detail),
                redaction = redactor.Mode,
            });
        });

        g.MapPut("/persisted/{sessionId}/state", async (
            string sessionId,
            HttpContext http,
            IBrowserSessionStore sessions,
            IDiagnosticsRuntime runtime) =>
        {
            if (!runtime.IsCapabilityEnabled(DiagnosticsDomain.PersistedSessions, DiagnosticsCapability.Snapshot))
                return Results.Json(new { errorCode = "probe_level_insufficient" }, statusCode: StatusCodes.Status403Forbidden);

            BrowserStatePayload? state;
            try
            {
                state = await JsonSerializer.DeserializeAsync<BrowserStatePayload>(
                    http.Request.Body,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch (JsonException)
            {
                return Results.Json(new { errorCode = "invalid_state" }, statusCode: StatusCodes.Status400BadRequest);
            }

            if (state is null)
                return Results.Json(new { errorCode = "invalid_state" }, statusCode: StatusCodes.Status400BadRequest);

            var detail = await sessions.GetSessionDetailAsync(sessionId);
            if (detail is null)
                return Results.NotFound(new { errorCode = "session_gone" });

            await sessions.SaveStateAsync(sessionId, state);
            return Results.Ok(new { ok = true, sessionId });
        });
    }

    private static object ShapeSnapshot(MotorSessionDiagnosticsSnapshot snap, IDiagnosticsRuntime runtime)
    {
        // Full session snapshot is gated by Motor.Snapshots; otherwise a Metric-tier subset.
        // Always emit Phase as a stable string for Act→Assert (cookbook / MotorAssert).
        if (!runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Snapshot))
        {
            return new
            {
                connectionId = snap.ConnectionId,
                phase = snap.Phase.ToString(),
                fps = snap.Fps,
                uptimeMs = snap.UptimeMs,
                sidecarConnected = snap.SidecarConnected,
                frameSequence = snap.FrameSequence,
                frameChannelDepth = snap.FrameChannelDepth,
                statusChannelDepth = snap.StatusChannelDepth,
                inputQueueApprox = snap.InputQueueApprox,
            };
        }

        return new
        {
            connectionId = snap.ConnectionId,
            persistedSessionId = snap.PersistedSessionId,
            sidecarSessionId = snap.SidecarSessionId,
            clientToken = snap.ClientToken,
            correlationId = snap.CorrelationId,
            phase = snap.Phase.ToString(),
            startedAt = snap.StartedAt,
            uptimeMs = snap.UptimeMs,
            lastEventUtc = snap.LastEventUtc,
            fps = snap.Fps,
            frameSequence = snap.FrameSequence,
            lastFrameUtc = snap.LastFrameUtc,
            inputQueueApprox = snap.InputQueueApprox,
            frameChannelDepth = snap.FrameChannelDepth,
            statusChannelDepth = snap.StatusChannelDepth,
            currentUrl = snap.CurrentUrl,
            lastNavigateResult = snap.LastNavigateResult,
            lastNavigateUtc = snap.LastNavigateUtc,
            sidecarConnected = snap.SidecarConnected,
            lastFault = snap.LastFault,
            exportingState = snap.ExportingState,
            forwardingHost = snap.ForwardingHost,
            jsBridgeEnabled = snap.JsBridgeEnabled,
            scriptCount = snap.ScriptCount,
            allowlistCount = snap.AllowlistCount,
            profileDomain = snap.ProfileDomain,
        };
    }

    private static IEnumerable<object> QueryTimeline(
        string? connectionId,
        DateTimeOffset? since,
        string? namePrefix,
        SessionEventRing ring,
        SqliteDiagnosticsEventSink sink,
        IDiagnosticsRedactor redactor)
    {
        IEnumerable<DiagnosticsEvent> ringEvents = string.IsNullOrWhiteSpace(connectionId)
            ? []
            : ring.GetSince(connectionId, since, namePrefix);

        var stored = sink.QueryEvents(connectionId, since, namePrefix);
        return ringEvents
            .Concat(stored)
            .GroupBy(e => e.Id)
            .Select(g => g.First())
            .OrderBy(e => e.Utc)
            .Select(e => ShapeEvent(e, redactor));
    }

    private static object ShapeEvent(DiagnosticsEvent e, IDiagnosticsRedactor redactor)
    {
        // Surface the span boundary role (from the static catalog) so the UI can classify a lone
        // span beat — one whose partner fell outside the query window — as an open vs a close
        // instead of guessing (a trimmed-open close would otherwise render as a phantom open span).
        var spanRole = DiagnosticsEventCatalog.TryGet(e.Name, out var descriptor)
            && descriptor.SpanRole != SpanRole.None
            ? descriptor.SpanRole.ToString()
            : null;

        return new
        {
            e.DiagnosticsSchemaVersion,
            e.Id,
            e.Utc,
            domain = e.Domain.ToString(),
            e.Name,
            severity = e.Severity.ToString(),
            e.CorrelationId,
            e.ConnectionId,
            e.PersistedSessionId,
            e.SidecarSessionId,
            e.Seq,
            e.SpanId,
            e.SpanKey,
            spanRole,
            e.CausationId,
            payload = redactor.RedactPayload(e.Payload),
            redaction = redactor.Mode,
        };
    }
}
