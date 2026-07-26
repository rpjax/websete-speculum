namespace Speculum.Api.Sessions.Events.Services.Contracts;

/// <summary>
/// Runtime (post-start) session observations for the live attached client.
/// </summary>
public interface ISessionLiveEvents
{
    void AttachedClientCommandFailed(string command, Exception exception);

    void FeatureLoopFaulted(Exception exception);
}
