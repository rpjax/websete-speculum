namespace Speculum.Api.Profiles.Retention;

/// <summary>
/// Shared gate: Enforcer may seize exclusive control; Cleaner only runs when free.
/// Enforcer waits for an in-flight Cleaner to finish, then holds the gate (nobody stops Enforcer).
/// </summary>
public interface IRetentionWorkGate
{
    bool TryEnterCleaner();

    void ExitCleaner();

    /// <summary>Blocks until Cleaner is out, then seizes the gate for Enforcer.</summary>
    void EnterEnforcer();

    void ExitEnforcer();
}

public sealed class RetentionWorkGate : IRetentionWorkGate
{
    private readonly object _lock = new();
    private int _enforcerDepth;
    private bool _cleanerInside;

    public bool TryEnterCleaner()
    {
        lock (_lock)
        {
            if (_enforcerDepth > 0 || _cleanerInside)
                return false;
            _cleanerInside = true;
            return true;
        }
    }

    public void ExitCleaner()
    {
        lock (_lock)
        {
            _cleanerInside = false;
            Monitor.PulseAll(_lock);
        }
    }

    public void EnterEnforcer()
    {
        lock (_lock)
        {
            while (_cleanerInside)
            {
                Monitor.Wait(_lock);
            }

            _enforcerDepth++;
        }
    }

    public void ExitEnforcer()
    {
        lock (_lock)
        {
            if (_enforcerDepth > 0)
                _enforcerDepth--;
            Monitor.PulseAll(_lock);
        }
    }
}
