using System.Text.Json;

namespace Speculum.Lab.Session;

/// <summary>
/// Journal leve da sessão lab: Virtual (telemetry) + Projected (client.telemetry).
/// Eventos nunca passam accept.
/// </summary>
public sealed class LabSessionJournal
{
    private readonly object _gate = new();
    private readonly List<object> _events = new();
    private readonly List<object> _projected = new();
    private long _outboundDrops;
    private long _virtualTelemetry;
    private long _projectedTelemetry;
    private string? _dossierDir;
    private object? _lastVirtualSnapshot;
    private object? _lastProjectedSnapshot;

    public string? DossierDir
    {
        get { lock (_gate) return _dossierDir; }
        set { lock (_gate) _dossierDir = value; }
    }

    public void ObserveVirtualTelemetry(object message)
    {
        lock (_gate)
        {
            _virtualTelemetry++;
            if (_events.Count < 10_000)
            {
                _events.Add(message);
            }
        }
    }

    public void ObserveProjectedTelemetry(JsonElement message)
    {
        object boxed;
        try
        {
            boxed = JsonSerializer.Deserialize<object>(message.GetRawText()) ?? message.GetRawText();
        }
        catch (JsonException)
        {
            boxed = message.GetRawText();
        }

        lock (_gate)
        {
            _projectedTelemetry++;
            if (_projected.Count < 10_000)
            {
                _projected.Add(boxed);
            }
        }
    }

    public void StoreVirtualSnapshot(object snap)
    {
        lock (_gate)
        {
            _lastVirtualSnapshot = snap;
        }
    }

    public void StoreProjectedSnapshot(object snap)
    {
        lock (_gate)
        {
            _lastProjectedSnapshot = snap;
        }
    }

    public void RecordOutboundDrop() => Interlocked.Increment(ref _outboundDrops);

    public object Stats(bool capsEvents, bool capsMetrics)
    {
        lock (_gate)
        {
            return new
            {
                caps = new { events = capsEvents, metrics = capsMetrics },
                virtualTelemetry = _virtualTelemetry,
                projectedTelemetry = _projectedTelemetry,
                outboundDrops = Interlocked.Read(ref _outboundDrops),
                dossierDir = _dossierDir,
                bufferedVirtual = _events.Count,
                bufferedProjected = _projected.Count,
                hasVirtualSnapshot = _lastVirtualSnapshot is not null,
                hasProjectedSnapshot = _lastProjectedSnapshot is not null,
            };
        }
    }

    public string ExportDossier(string sessionId, bool capsEvents, bool capsMetrics)
    {
        string dir;
        lock (_gate)
        {
            dir = _dossierDir ?? "";
            if (string.IsNullOrWhiteSpace(dir))
            {
                dir = Path.Combine(
                    Path.GetTempPath(),
                    "speculum-lab-runs",
                    $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{sessionId}");
                _dossierDir = dir;
            }

            Directory.CreateDirectory(dir);
            File.WriteAllText(
                Path.Combine(dir, "manifest.json"),
                JsonSerializer.Serialize(new
                {
                    sessionId,
                    exportedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    caps = new { events = capsEvents, metrics = capsMetrics },
                    virtualTelemetry = _virtualTelemetry,
                    projectedTelemetry = _projectedTelemetry,
                    outboundDrops = Interlocked.Read(ref _outboundDrops),
                }));

            WriteNdjson(Path.Combine(dir, "telemetry.ndjson"), _events);
            WriteNdjson(Path.Combine(dir, "projected.ndjson"), _projected);

            if (_lastVirtualSnapshot is not null)
            {
                File.WriteAllText(
                    Path.Combine(dir, "virtual-snapshot.json"),
                    JsonSerializer.Serialize(_lastVirtualSnapshot));
            }

            if (_lastProjectedSnapshot is not null)
            {
                File.WriteAllText(
                    Path.Combine(dir, "projected-snapshot.json"),
                    JsonSerializer.Serialize(_lastProjectedSnapshot));
            }
        }

        return dir;
    }

    private static void WriteNdjson(string path, List<object> rows)
    {
        using var w = new StreamWriter(path);
        foreach (var e in rows)
        {
            w.WriteLine(JsonSerializer.Serialize(e));
        }
    }
}
