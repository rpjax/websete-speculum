using Aidan.Core.Errors;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Domain runtime narrative for navigation outcomes and live browser faults.
/// </summary>
public interface ISessionLiveEvents
{
    void FeatureLoopFaulted(Exception exception);

    void NavigateRequested(string path, string query);

    void NavigateCompleted(string url);

    void NavigateFailed(string phase, Error[] errors);

    void MainFrameNavigationBlocked(string url, string? errorCode, string? message);

    void BrowserCrashed(string? errorCode, string? message, string? phase);

    /// <summary>Live session abandoned (SessionEnded + Faulted stop).</summary>
    void LiveSessionAbandoned(string reason, string? errorCode, string? message);
}
