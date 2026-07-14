using System.Text.Json;
using Speculum.Api.Diagnostics.Abstractions;
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
                effectiveLevels = snap.EffectiveLevels,
                elevate = snap.Elevate,
                degraded = snap.Degraded,
                bytesUsed = snap.BytesUsed,
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
                effectiveLevels = snap.EffectiveLevels,
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

        g.MapPut("/elevate", async (HttpContext http, IDiagnosticsRuntime runtime, IDiagnosticsEventBus bus) =>
        {
            using var doc = await JsonDocument.ParseAsync(http.Request.Body);
            var root = doc.RootElement;
            var floorName = root.TryGetProperty("browserQueryFloor", out var f) ? f.GetString() : "BrowserQuery";
            var minutes = root.TryGetProperty("minutes", out var m) && m.TryGetInt32(out var mins) ? mins : 15;
            if (!Enum.TryParse<DiagnosticsLevel>(floorName, true, out var floor))
                return Results.BadRequest(new { errorCode = "invalid_level", error = "Invalid browserQueryFloor." });

            minutes = Math.Clamp(minutes, 1, runtime.GetSnapshot().Options.Elevate.BrowserQueryMaxMinutes);
            var actor = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            runtime.SetElevate(floor, TimeSpan.FromMinutes(minutes));
            bus.Publish(new DiagnosticsEvent
            {
                Domain = DiagnosticsDomain.DiagnosticsSelf,
                Name = "Diagnostics.ElevateStarted",
                Payload = new
                {
                    browserQueryFloor = floor.ToString(),
                    minutes,
                    actorIp = actor,
                    audit = true,
                },
            });
            return Results.Ok(new { elevated = true, browserQueryFloor = floor.ToString(), minutes, redaction = "none" });
        });

        g.MapDelete("/elevate", (HttpContext http, IDiagnosticsRuntime runtime, IDiagnosticsEventBus bus) =>
        {
            var actor = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            runtime.ClearElevate();
            bus.Publish(new DiagnosticsEvent
            {
                Domain = DiagnosticsDomain.DiagnosticsSelf,
                Name = "Diagnostics.ElevateExpired",
                Payload = new { reason = "manual_clear", actorIp = actor, audit = true },
            });
            return Results.Ok(new { elevated = false });
        });

        // Ops/lab: circuit breaker recovery must not wait for the cleanup timer alone.
        // Degraded caps effective levels at Metrics and blocks BrowserQuery probes.
        g.MapPost("/recover", (HttpContext http, IDiagnosticsRuntime runtime, IDiagnosticsEventBus bus) =>
        {
            var actor = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var wasDegraded = runtime.IsDegraded;
            if (wasDegraded)
            {
                runtime.SetDegraded(false);
                bus.Publish(new DiagnosticsEvent
                {
                    Domain = DiagnosticsDomain.DiagnosticsSelf,
                    Name = "Diagnostics.Recovered",
                    Payload = new { reason = "manual_recover", actorIp = actor, audit = true },
                });
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

        g.MapPost("/sessions/{connectionId}/browser", async (
            string connectionId,
            HttpContext http,
            IMotorSessionRegistry registry,
            IDiagnosticsRuntime runtime,
            IDiagnosticsEventBus bus,
            IDiagnosticsRedactor redactor,
            DiagnosticsProbeGate probeGate,
            IEnumerable<IDiagnosticsProbeProvider> providers) =>
        {
            var session = registry.Get(connectionId);
            if (session is null)
                return Results.NotFound(new { errorCode = "session_gone" });

            if (!probeGate.TryEnter(connectionId, out var lease) || lease is null)
            {
                bus.Publish(new DiagnosticsEvent
                {
                    Domain = DiagnosticsDomain.SidecarBrowser,
                    Name = "Sidecar.DiagProbeRejected",
                    Severity = DiagnosticsSeverity.Warning,
                    CorrelationId = Guid.NewGuid().ToString("N"),
                    ConnectionId = connectionId,
                    Payload = new { errorCode = "probe_busy" },
                });
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
                    && !runtime.IsEnabled(DiagnosticsDomain.BrowserQuery, DiagnosticsLevel.BrowserQuery))
                {
                    return Results.Json(new { errorCode = "probe_level_insufficient" },
                        statusCode: StatusCodes.Status403Forbidden);
                }

                if (!runtime.IsEnabled(DiagnosticsDomain.SidecarBrowser, DiagnosticsLevel.Metrics))
                {
                    return Results.Json(new { errorCode = "probe_level_insufficient" },
                        statusCode: StatusCodes.Status403Forbidden);
                }

                bus.Publish(new DiagnosticsEvent
                {
                    Domain = DiagnosticsDomain.SidecarBrowser,
                    Name = "Sidecar.DiagProbeRequested",
                    CorrelationId = correlationId,
                    ConnectionId = connectionId,
                    PersistedSessionId = session.PersistedSessionId,
                    Payload = new { ops },
                });

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
                        var eventName = result.ErrorCode == "probe_timeout"
                            ? "Sidecar.DiagProbeTimedOut"
                            : "Sidecar.DiagProbeRejected";
                        bus.Publish(new DiagnosticsEvent
                        {
                            Domain = DiagnosticsDomain.SidecarBrowser,
                            Name = eventName,
                            Severity = DiagnosticsSeverity.Warning,
                            CorrelationId = correlationId,
                            ConnectionId = connectionId,
                            Payload = MotorDiagnosticsPayloads.Probe(
                                ops, result.ErrorCode ?? "probe_failed"),
                        });
                        return Results.Json(new { errorCode = result.ErrorCode }, statusCode: status);
                    }

                    bus.Publish(new DiagnosticsEvent
                    {
                        Domain = DiagnosticsDomain.SidecarBrowser,
                        Name = "Sidecar.DiagProbeCompleted",
                        CorrelationId = correlationId,
                        ConnectionId = connectionId,
                        PersistedSessionId = session.PersistedSessionId,
                        Payload = MotorDiagnosticsPayloads.Probe(ops),
                    });

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
                    bus.Publish(new DiagnosticsEvent
                    {
                        Domain = DiagnosticsDomain.SidecarBrowser,
                        Name = "Sidecar.DiagProbeTimedOut",
                        Severity = DiagnosticsSeverity.Warning,
                        CorrelationId = correlationId,
                        ConnectionId = connectionId,
                        Payload = MotorDiagnosticsPayloads.Probe(ops, "probe_timeout"),
                    });
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
            if (!runtime.IsEnabled(DiagnosticsDomain.PersistedSessions, DiagnosticsLevel.StateSnapshots))
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
            if (!runtime.IsEnabled(DiagnosticsDomain.PersistedSessions, DiagnosticsLevel.StateSnapshots))
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
        var level = runtime.GetEffectiveLevel(DiagnosticsDomain.MotorLive);
        // Always emit Phase as a stable string for Act→Assert (cookbook / MotorAssert).
        if (level <= DiagnosticsLevel.Metrics)
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
            .Select(e => (object)new
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
                payload = redactor.RedactPayload(e.Payload),
                redaction = redactor.Mode,
            });
    }
}
