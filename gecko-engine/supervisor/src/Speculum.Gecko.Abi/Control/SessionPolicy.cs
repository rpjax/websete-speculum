using Speculum.Wire;

namespace Speculum.Supervisor.Control;

/// <summary>
/// Policy that lives only in the Supervisor — never in the motor.
/// Force of resync, navigation retry budget, and offer throughput.
/// </summary>
public sealed class SessionPolicy
{
    public ResyncForce DefaultResyncForce { get; init; } = ResyncForce.FromWalk;
    public int NavigateRetryLimit { get; init; } = 2;
    public int MaxOutstandingOffers { get; init; } = 8;

    private int _navigateAttempts;
    private int _outstandingOffers;

    public ResyncForce ChooseResyncForce() => DefaultResyncForce;

    public bool TryBeginNavigate()
    {
        if (_navigateAttempts >= NavigateRetryLimit)
        {
            return false;
        }

        _navigateAttempts++;
        return true;
    }

    public void ResetNavigateAttempts() => _navigateAttempts = 0;

    public bool TryAcquireOfferSlot()
    {
        if (_outstandingOffers >= MaxOutstandingOffers)
        {
            return false;
        }

        _outstandingOffers++;
        return true;
    }

    public void ReleaseOfferSlot()
    {
        if (_outstandingOffers > 0)
        {
            _outstandingOffers--;
        }
    }
}
