using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Services;

public sealed class JournalHealth : IJournalHealth
{
    private readonly IOptionsMonitor<JournalDrainOptions> _options;
    private readonly JournalDrainMetrics _metrics;
    private readonly ILogger<JournalHealth> _logger;
    private readonly object _gate = new();

    private bool _persistDegraded;
    private bool _queuePressure;
    private bool _drainRunning;
    private bool _drainStarted;
    private string? _lastPersistError;
    private string? _pressureReason;
    private int _consecutiveSuccesses;

    public JournalHealth(
        IOptionsMonitor<JournalDrainOptions> options,
        JournalDrainMetrics metrics,
        ILogger<JournalHealth> logger)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _metrics = metrics ?? throw new ArgumentNullException(nameof(metrics));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public JournalHealthState State
    {
        get
        {
            lock (_gate)
                return _persistDegraded || _queuePressure
                    ? JournalHealthState.Degraded
                    : JournalHealthState.Healthy;
        }
    }

    public string? LastError
    {
        get
        {
            lock (_gate)
                return _lastPersistError ?? _pressureReason;
        }
    }

    public bool IsQueuePressureActive
    {
        get
        {
            lock (_gate)
                return _queuePressure;
        }
    }

    public bool IsPersistDegraded
    {
        get
        {
            lock (_gate)
                return _persistDegraded;
        }
    }

    public bool IsDrainRunning
    {
        get
        {
            lock (_gate)
                return _drainRunning;
        }
    }

    public bool IsAdmissionOpen
    {
        get
        {
            lock (_gate)
                return !_drainStarted || _drainRunning;
        }
    }

    public void SetDrainRunning(bool running)
    {
        lock (_gate)
        {
            if (running)
                _drainStarted = true;
            _drainRunning = running;
        }
    }

    public void MarkDegraded(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        MarkDegraded(exception.Message);
    }

    public void MarkDegraded(string reason)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);

        lock (_gate)
        {
            _lastPersistError = reason;
            _consecutiveSuccesses = 0;
            if (_persistDegraded)
                return;

            var wasHealthy = !_persistDegraded && !_queuePressure;
            _persistDegraded = true;
            if (wasHealthy)
                _metrics.RecordDegradedEnter();

            _logger.LogWarning("Journal persist Degraded: {Reason}", reason);
        }
    }

    public void MarkQueuePressure(string reason)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);

        lock (_gate)
        {
            _pressureReason = reason;
            if (_queuePressure)
                return;

            var wasHealthy = !_persistDegraded && !_queuePressure;
            _queuePressure = true;
            if (wasHealthy)
                _metrics.RecordDegradedEnter();

            _logger.LogWarning("Journal queue pressure Degraded: {Reason}", reason);
        }
    }

    public void ClearQueuePressure()
    {
        lock (_gate)
        {
            if (!_queuePressure)
                return;

            _queuePressure = false;
            _pressureReason = null;

            if (!_persistDegraded)
            {
                _metrics.RecordDegradedRecover();
                _logger.LogInformation("Journal queue pressure cleared; Healthy.");
            }
            else
            {
                _logger.LogInformation(
                    "Journal queue pressure cleared; persist Degraded remains ({Reason}).",
                    _lastPersistError);
            }
        }
    }

    public void NoteSuccess()
    {
        lock (_gate)
        {
            if (!_persistDegraded)
            {
                _consecutiveSuccesses = 0;
                return;
            }

            _consecutiveSuccesses++;
            var needed = Math.Max(1, _options.CurrentValue.RecoverAfterSuccessfulBatches);
            if (_consecutiveSuccesses < needed)
                return;

            _persistDegraded = false;
            _lastPersistError = null;
            _consecutiveSuccesses = 0;

            if (!_queuePressure)
            {
                _metrics.RecordDegradedRecover();
                _logger.LogInformation("Journal recovered to Healthy after successful batches.");
            }
            else
            {
                _logger.LogInformation(
                    "Journal persist Degraded cleared; queue pressure still active.");
            }
        }
    }

    public void Recover()
    {
        lock (_gate)
        {
            var wasDegraded = _persistDegraded || _queuePressure;
            _persistDegraded = false;
            _queuePressure = false;
            _lastPersistError = null;
            _pressureReason = null;
            _consecutiveSuccesses = 0;

            if (!wasDegraded)
                return;

            _metrics.RecordDegradedRecover();
            _logger.LogInformation("Journal Recover() cleared Degraded.");
        }
    }
}
