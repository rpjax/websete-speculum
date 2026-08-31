using System.Threading.Channels;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;
using Speculum.Api.Shared.Services;
using Speculum.Api.Telemetry.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// In-memory context for one live connection: mux, hooks, commands, one attached client.
/// Output streams are owned by callers (dispose to unregister); presence is Attach/Detach.
/// </summary>
internal sealed partial class LiveSession : ILiveSession
{
    private readonly ISessionConnection _connection;
    private readonly ISessionStreamMultiplexer _mux;
    private readonly SessionHooks _hooks;
    private readonly ISessionCollector _collector;
    private readonly ISessionFaultScheduler _faults;
    private readonly ISessionLiveEvents _liveEvents;
    private readonly ISessionTelemetryEvents _telemetry;
    private readonly IJournalCatalog _journalCatalog;
    private readonly ILogger _logger;
    private readonly string _requestHost;
    private readonly bool _jsBridgeEnabled;
    private readonly Guid _profileId;
    private readonly long _startedTimestamp = Environment.TickCount64;
    private readonly ScopedMutex _commandGate = new();
    private readonly object _attachmentGate = new();
    private readonly SessionResizeCoalescer _resizeCoalescer = new();

    private readonly MirrorMode _mirrorMode;
    private Guid? _attachmentId;
    private IAttachedSessionClient? _attachedClient;
    private INotificationStream? _featureNotifications;
    private Task? _featureLoop;
    private CancellationTokenSource? _lifetime = new();
    private int _released;
    private int _abandoned;
    private int _videoStreamingInputPipeStarted;
    private Channel<VideoStreamingInput>? _videoStreamingInputPipe;
    private int _pageProjectionInputPipeStarted;
    private Channel<PageProjectionIntent>? _pageProjectionInputPipe;

    public Guid SessionId { get; }

    public MirrorMode MirrorMode => _mirrorMode;

    internal LiveSession(
        Guid sessionId,
        Guid profileId,
        ISessionConnection connection,
        ISessionStreamMultiplexer mux,
        SessionHooks hooks,
        ISessionCollector collector,
        ISessionFaultScheduler faults,
        string requestHost,
        bool jsBridgeEnabled,
        MirrorMode mirrorMode,
        ISessionLiveEvents liveEvents,
        ISessionTelemetryEvents telemetry,
        IJournalCatalog journalCatalog,
        ILogger logger)
    {
        SessionId = sessionId;
        _profileId = profileId;
        _connection = connection;
        _mux = mux;
        _hooks = hooks;
        _collector = collector;
        _faults = faults;
        _requestHost = requestHost;
        _jsBridgeEnabled = jsBridgeEnabled;
        _mirrorMode = mirrorMode;
        _liveEvents = liveEvents;
        _telemetry = telemetry;
        _journalCatalog = journalCatalog;
        _logger = logger;

        hooks.BindToConnection(connection);
        connection.BindPageProjectionFrameTelemetry(new FrameTelemetryBridge(this));
    }
}
