using Speculum.Api.Sessions.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

/// <summary>Domain-only no-op for <see cref="ISessionLiveEvents"/>.</summary>
internal sealed class NoOpSessionLiveEvents : ISessionLiveEvents
{
    public void FeatureLoopFaulted(Exception exception) { }
    public void NavigateRequested(string path, string query) { }
    public void NavigateCompleted(string url) { }
    public void NavigateFailed(string phase, Aidan.Core.Errors.Error[] errors) { }
    public void MainFrameNavigationBlocked(string url, string? errorCode, string? message) { }
    public void BrowserCrashed(string? errorCode, string? message, string? phase) { }
    public void LiveSessionAbandoned(string reason, string? errorCode, string? message) { }
}
