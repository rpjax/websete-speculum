namespace Speculum.Api.Sessions.Models;

public enum StopReason
{
    UserStop,
    Replaced,
    Cancelled,
    Disconnected,
    TimedOut,
    Faulted,
    Drain,
    ForceStop,
}

public static class StopReasonExtensions
{
    public static string ToStableString(this StopReason reason) => reason switch
    {
        StopReason.UserStop => "UserStop",
        StopReason.Replaced => "Replaced",
        StopReason.Cancelled => "Cancelled",
        StopReason.Disconnected => "Disconnected",
        StopReason.TimedOut => "TimedOut",
        StopReason.Faulted => "Faulted",
        StopReason.Drain => "Drain",
        StopReason.ForceStop => "ForceStop",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
    };
}
