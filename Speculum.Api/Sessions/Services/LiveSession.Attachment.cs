using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

internal sealed partial class LiveSession
{
    // ── Caller attachment ────────────────────────────────────────────────────

    public IResult<Guid> Attach(IAttachedSessionClient client)
    {
        ArgumentNullException.ThrowIfNull(client);

        lock (_attachmentGate)
        {
            if (IsReleased)
            {
                return Result<Guid>.Failure("Live session is released");
            }

            if (_attachmentId is not null)
            {
                return Result<Guid>.Failure("A client is already attached");
            }

            var attachedId = Guid.CreateVersion7();
            _attachmentId = attachedId;
            _attachedClient = client;
            _collector.AddRef(SessionId);
            _mux.SetAttachedConsumer(attachedId);
            return Result<Guid>.Success(attachedId);
        }
    }

    public IResult Detach(Guid attachmentId)
    {
        lock (_attachmentGate)
        {
            if (IsReleased)
            {
                // Release already dropped the attachment and collector ref.
                return Result.Success();
            }

            if (_attachmentId != attachmentId)
            {
                return Result.Failure("Attachment not found");
            }

            _attachmentId = null;
            _attachedClient = null;
            _collector.Release(SessionId);
            _mux.SetAttachedConsumer(null);
            return Result.Success();
        }
    }

    public IResult ObserveSessionNotifications(INotificationStream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);

        ChannelReader<SessionNotification> featureReader;
        CancellationToken lifetimeToken;

        lock (_attachmentGate)
        {
            if (IsReleased)
            {
                return Result.Failure("Live session is released");
            }

            if (_featureNotifications is not null)
            {
                return Result.Failure("Session notifications are already observed");
            }

            if (!TryGetLifetimeToken(out lifetimeToken))
            {
                return Result.Failure("Live session is released");
            }

            var channel = stream.GetNotificationChannel();
            if (channel.IsFailure)
            {
                return Result.Failure(channel.Errors.ToArray());
            }

            _featureNotifications = stream;
            featureReader = channel.Value;
        }

        var loop = RunFeatureLoopAsync(featureReader, lifetimeToken);
        _featureLoop = loop;
        ObserveFeatureLoop(loop);
        return Result.Success();
    }

    private void ObserveFeatureLoop(Task loop)
    {
        _ = loop.ContinueWith(
            static (task, state) =>
            {
                var session = (LiveSession)state!;
                if (task.IsFaulted && task.Exception is not null)
                {
                    var error = task.Exception.GetBaseException();
                    session._logger.LogError(
                        error,
                        "Session {SessionId} feature loop faulted.",
                        session.SessionId);
                    try
                    {
                        session._liveEvents.FeatureLoopFaulted(error);
                    }
                    catch (Exception journalEx)
                    {
                        session._logger.LogWarning(
                            journalEx,
                            "Session {SessionId} failed to journal FeatureLoopFaulted.",
                            session.SessionId);
                    }
                }
            },
            this,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously | TaskContinuationOptions.OnlyOnFaulted,
            TaskScheduler.Default);
    }

    private async Task RunFeatureLoopAsync(
        ChannelReader<SessionNotification> reader,
        CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var notification in reader.ReadAllAsync(cancellationToken)
                .ConfigureAwait(false))
            {
                TryJournalNotification(notification);

                if (notification.Kind == SessionNotificationKind.Crashed)
                {
                    // True sidecar onCrash (Chromium). gRPC link stays open until TearDown CloseAsync.
                    await AbandonAsync(
                            StopReason.Faulted,
                            notification.ErrorCode ?? "browser_crashed",
                            notification.Message ?? "Browser session crashed")
                        .ConfigureAwait(false);
                    break;
                }

                IAttachedSessionClient? client;
                lock (_attachmentGate)
                {
                    client = _attachedClient;
                }

                if (client is null)
                {
                    continue;
                }

                if (notification.Kind == SessionNotificationKind.EditableFocusChanged)
                {
                    try
                    {
                        await client.EditableFocusChangedAsync(notification.Editing, cancellationToken)
                            .ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug(
                            ex,
                            "Session {SessionId} failed to push EditableFocusChanged to attached client.",
                            SessionId);
                        try
                        {
                            _telemetry.Client.AttachedCommandFailed("EditableFocusChanged", ex);
                        }
                        catch (Exception journalEx)
                        {
                            _logger.LogWarning(
                                journalEx,
                                "Session {SessionId} failed to journal AttachedClientCommandFailed.",
                                SessionId);
                        }
                    }

                    continue;
                }

                if (string.IsNullOrWhiteSpace(notification.Url))
                {
                    continue;
                }

                var url = notification.Url.Trim();
                string? command = null;
                try
                {
                    switch (notification.Kind)
                    {
                        case SessionNotificationKind.LocationChanged:
                            command = "SyncUrl";
                            await client.SyncUrlAsync(url, cancellationToken)
                                .ConfigureAwait(false);
                            break;
                        case SessionNotificationKind.MainFrameNavigationBlocked:
                            command = "Redirect";
                            await client.RedirectAsync(url, cancellationToken).ConfigureAwait(false);
                            break;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(
                        ex,
                        "Session {SessionId} failed to push {Kind} to attached client.",
                        SessionId,
                        notification.Kind);
                    if (command is not null)
                    {
                        try
                        {
                            _telemetry.Client.AttachedCommandFailed(command, ex);
                        }
                        catch (Exception journalEx)
                        {
                            _logger.LogWarning(
                                journalEx,
                                "Session {SessionId} failed to journal AttachedClientCommandFailed.",
                                SessionId);
                        }
                    }
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ChannelClosedException)
        {
        }
        catch (ObjectDisposedException)
        {
        }
        finally
        {
            // Notification channel ended while still live → sidecar session link is gone.
            // Intentional Release cancels the lifetime token and skips this.
            if (!cancellationToken.IsCancellationRequested && !IsReleased)
            {
                await AbandonAsync(
                        StopReason.Faulted,
                        "sidecar_connection_ended",
                        "Sidecar session connection ended")
                    .ConfigureAwait(false);
            }
        }
    }
}
