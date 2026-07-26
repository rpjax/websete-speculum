using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class SessionBindingRegistry : ISessionBindingRegistry, IDisposable
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Entry> _byCaller =
        new(StringComparer.Ordinal);
    private readonly Dictionary<Guid, Entry> _startsBySession = new();
    private readonly ILiveSessionService _liveSessions;

    public SessionBindingRegistry(ILiveSessionService liveSessions)
    {
        _liveSessions = liveSessions;
    }

    public SessionBindingStart BeginStart(string callerId, Guid sessionId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(callerId);

        Entry? previous;
        var next = Entry.Starting(sessionId);
        lock (_gate)
        {
            _byCaller.Remove(callerId, out previous);
            _byCaller.Add(callerId, next);
            _startsBySession.Add(sessionId, next);
        }

        Guid? replaced = previous is { IsLive: true }
            ? previous.SessionId
            : null;
        CloseEntry(previous);
        var previousStartCompletion = previous is { IsLive: false }
            ? previous.StartCompletion.Task
            : Task.CompletedTask;
        return new SessionBindingStart(
            next.StartCancellation.Token,
            replaced,
            previousStartCompletion);
    }

    public bool TryPromote(
        string callerId,
        Guid sessionId,
        Guid attachmentId,
        string token)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(callerId);
        ArgumentException.ThrowIfNullOrWhiteSpace(token);

        lock (_gate)
        {
            if (!_byCaller.TryGetValue(callerId, out var entry)
                || entry.IsLive
                || entry.SessionId != sessionId)
            {
                return false;
            }

            entry.AttachmentId = attachmentId;
            entry.Token = token;
            entry.IsLive = true;
            entry.StartCancellation.Dispose();
            _startsBySession.Remove(sessionId);
            entry.StartCompletion.TrySetResult();
            return true;
        }
    }

    public bool TryCancelStart(string callerId, Guid sessionId)
    {
        Entry? entry = null;
        lock (_gate)
        {
            if (_byCaller.TryGetValue(callerId, out var current)
                && !current.IsLive
                && current.SessionId == sessionId)
            {
                _byCaller.Remove(callerId);
                entry = current;
            }
        }

        CloseEntry(entry);
        return entry is not null;
    }

    public void CompleteStart(Guid sessionId)
    {
        Entry? entry;
        lock (_gate)
        {
            _startsBySession.Remove(sessionId, out entry);
        }

        entry?.StartCompletion.TrySetResult();
    }

    public bool IsAuthorized(string callerId, Guid sessionId, string token)
    {
        lock (_gate)
        {
            return _byCaller.TryGetValue(callerId, out var entry)
                && entry.IsLive
                && entry.SessionId == sessionId
                && FixedTimeEquals(entry.Token, token);
        }
    }

    public bool TryGetLive(
        Guid sessionId,
        string token,
        out SessionBinding binding)
    {
        lock (_gate)
        {
            foreach (var (callerId, entry) in _byCaller)
            {
                if (entry.IsLive
                    && entry.SessionId == sessionId
                    && FixedTimeEquals(entry.Token, token))
                {
                    binding = new SessionBinding(
                        callerId,
                        entry.SessionId,
                        entry.AttachmentId,
                        entry.Token);
                    return true;
                }
            }
        }

        binding = null!;
        return false;
    }

    public IResult RegisterPipe(
        Guid sessionId,
        string token,
        Guid pipeId,
        IDisposable resource)
    {
        ArgumentNullException.ThrowIfNull(resource);
        lock (_gate)
        {
            var entry = _byCaller.Values.FirstOrDefault(candidate =>
                candidate.IsLive
                && candidate.SessionId == sessionId
                && FixedTimeEquals(candidate.Token, token));
            if (entry is null)
            {
                return Result.Failure("Live session binding not found");
            }

            if (entry.Pipes.ContainsKey(pipeId))
            {
                return Result.Failure("Pipe is already registered");
            }

            entry.Pipes.Add(pipeId, resource);
            return Result.Success();
        }
    }

    public void UnregisterPipe(Guid pipeId)
    {
        IDisposable? resource = null;
        lock (_gate)
        {
            foreach (var entry in _byCaller.Values)
            {
                if (entry.Pipes.Remove(pipeId, out resource))
                {
                    break;
                }
            }
        }

        DisposeResource(resource);
    }

    public void CloseCaller(string callerId)
    {
        Entry? entry;
        lock (_gate)
        {
            _byCaller.Remove(callerId, out entry);
        }

        CloseEntry(entry);
    }

    public void CloseSession(Guid sessionId)
    {
        List<Entry> entries = new();
        lock (_gate)
        {
            foreach (var pair in _byCaller
                         .Where(pair => pair.Value.SessionId == sessionId)
                         .ToArray())
            {
                _byCaller.Remove(pair.Key);
                entries.Add(pair.Value);
            }
        }

        foreach (var entry in entries)
        {
            CloseEntry(entry);
        }
    }

    public void Dispose()
    {
        Entry[] entries;
        lock (_gate)
        {
            entries = _byCaller.Values.ToArray();
            _byCaller.Clear();
            _startsBySession.Clear();
        }

        foreach (var entry in entries)
        {
            CloseEntry(entry);
        }
    }

    private void CloseEntry(Entry? entry)
    {
        if (entry is null)
        {
            return;
        }

        if (!entry.IsLive)
        {
            lock (_gate)
            {
                if (_startsBySession.TryGetValue(entry.SessionId, out var current)
                    && ReferenceEquals(current, entry))
                {
                    _startsBySession.Remove(entry.SessionId);
                }
            }

            try
            {
                entry.StartCancellation.Cancel();
            }
            catch (ObjectDisposedException)
            {
            }

            try
            {
                entry.StartCancellation.Dispose();
            }
            catch (ObjectDisposedException)
            {
            }

            entry.StartCompletion.TrySetResult();
        }

        foreach (var resource in entry.Pipes.Values)
        {
            DisposeResource(resource);
        }

        entry.Pipes.Clear();
        if (entry.IsLive
            && _liveSessions.TryGet(entry.SessionId, out var live))
        {
            live.Detach(entry.AttachmentId);
        }
    }

    private static bool FixedTimeEquals(string expected, string actual)
        => !string.IsNullOrEmpty(expected)
            && !string.IsNullOrEmpty(actual)
            && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(expected),
                System.Text.Encoding.UTF8.GetBytes(actual));

    private static void DisposeResource(IDisposable? resource)
    {
        try
        {
            resource?.Dispose();
        }
        catch
        {
            // Binding close is best-effort; all sibling resources must still close.
        }
    }

    private sealed class Entry
    {
        private Entry(Guid sessionId)
        {
            SessionId = sessionId;
        }

        public Guid SessionId { get; }
        public CancellationTokenSource StartCancellation { get; } = new();
        public TaskCompletionSource StartCompletion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Dictionary<Guid, IDisposable> Pipes { get; } = new();
        public bool IsLive { get; set; }
        public Guid AttachmentId { get; set; }
        public string Token { get; set; } = "";

        public static Entry Starting(Guid sessionId) => new(sessionId);
    }
}
