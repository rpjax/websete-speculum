using Aidan.Core.Errors;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Runtime (post-start) session observations for navigation and the live browser.
/// </summary>
public interface ISessionLiveEvents
{
    void AttachedClientCommandFailed(string command, Exception exception);

    void FeatureLoopFaulted(Exception exception);

    void NavigateRequested(string path, string query);

    void NavigateUrlResolved(string url);

    void NavigateCompleted(string url);

    void NavigateFailed(string phase, Error[] errors);

    void LocationChanged(string url);

    void MainFrameNavigationBlocked(string url, string? errorCode, string? message);

    void BrowserCrashed(string? errorCode, string? message, string? phase);

    void InputRejected(string? errorCode, string? message, string? phase);

    /// <summary>Opt-in test/debug: input successfully pushed to the sidecar.</summary>
    void InputApplied(string kind, string? phase);

    /// <summary>Opt-in test/debug: viewport resize applied.</summary>
    void ResizeApplied(int width, int height, string? resizeId);

    /// <summary>Opt-in test/debug: viewport resize rejected.</summary>
    void ResizeRejected(
        int? width,
        int? height,
        string? resizeId,
        string? errorCode,
        string? message,
        string? phase);

    /// <summary>Live session abandoned (SessionEnded + Faulted stop).</summary>
    void LiveSessionAbandoned(string reason, string? errorCode, string? message);
}
