using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

public static class SessionEndpoints
{
    public static IEndpointRouteBuilder MapSessionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/sessions", async (
            int? skip,
            int? take,
            LifecycleState? state,
            MirrorMode? mirrorMode,
            Guid? sessionId,
            Guid? profileId,
            bool? sortDescending,
            ISessionRepository sessions,
            ILiveSessionService liveSessions,
            CancellationToken ct) =>
        {
            var (records, total) = await sessions.ListAsync(
                    new ListSessions
                    {
                        Skip = skip ?? 0,
                        Take = take ?? ListSessions.DefaultTake,
                        State = state,
                        MirrorMode = mirrorMode,
                        SessionId = sessionId,
                        ProfileId = profileId,
                        SortDescending = sortDescending ?? true,
                    },
                    ct)
                .ConfigureAwait(false);

            var live = liveSessions.ListSnapshots().ToDictionary(s => s.SessionId);
            var items = records.Select(r => ToResponse(r, live)).ToArray();
            return Results.Ok(new { items, total });
        }).WithTags("Sessions");

        endpoints.MapGet("/api/sessions/{sessionId:guid}", async (
            Guid sessionId,
            ISessionRepository sessions,
            ILiveSessionService liveSessions,
            CancellationToken ct) =>
        {
            var (records, _) = await sessions.ListAsync(
                    new ListSessions { SessionId = sessionId, Take = 1 },
                    ct)
                .ConfigureAwait(false);
            var record = records.FirstOrDefault();
            if (record is null)
            {
                return Results.NotFound(new { error = "Session not found" });
            }

            var live = liveSessions.ListSnapshots().ToDictionary(s => s.SessionId);
            return Results.Ok(ToResponse(record, live));
        }).WithTags("Sessions");

        endpoints.MapGet("/api/sessions/{sessionId:guid}/journal-export", async (
            Guid sessionId,
            IJournalReader journal,
            CancellationToken ct) =>
        {
            var facts = new List<JournalEntry>();
            var offset = 0;
            while (true)
            {
                var batch = await journal.ReadAsync(
                        new JournalQuery
                        {
                            Offset = offset,
                            Filter = new JournalQueryFilter
                            {
                                IndexKeys = [new JournalIndexKey("session", sessionId.ToString())],
                            },
                            Orders = [new JournalQueryOrder { Property = JournalOrderProperty.Sequence }],
                        },
                        ct)
                    .ConfigureAwait(false);

                if (batch.Count == 0)
                {
                    break;
                }

                facts.AddRange(batch);
                offset += batch.Count;
            }

            return Results.Ok(new
            {
                sessionId,
                exportedAt = DateTimeOffset.UtcNow,
                factCount = facts.Count,
                facts = facts.Select(ToFactResponse),
            });
        }).WithTags("Sessions");

        return endpoints;
    }

    private static object ToResponse(
        SessionListItem record,
        IReadOnlyDictionary<Guid, LiveSessionTelemetrySnapshot> live)
    {
        live.TryGetValue(record.SessionId, out var snapshot);
        return new
        {
            sessionId = record.SessionId,
            profileId = record.ProfileId,
            state = record.State.ToString(),
            startedAt = record.StartedAt,
            endedAt = record.EndedAt,
            endReason = record.EndReason,
            mirrorMode = record.MirrorMode?.ToString(),
            viewportWidth = record.ViewportWidth,
            viewportHeight = record.ViewportHeight,
            connectionOpen = snapshot?.ConnectionOpen,
            uptimeMs = snapshot?.UptimeMs,
            jsBridgeEnabled = snapshot?.JsBridgeEnabled,
        };
    }

    private static object ToFactResponse(JournalEntry entry)
        => new
        {
            id = entry.Id,
            sequence = entry.Sequence,
            type = entry.Type,
            publishedAt = entry.PublishedAt,
            schemaVersion = entry.SchemaVersion,
            indexKeys = entry.IndexKeys.Select(k => new { k.Type, k.Value }),
            payload = entry.Payload,
        };
}
