using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Default until <see cref="BrowserSessionsServiceCollectionExtensions.AddBrowserSessions"/>
/// replaces with <see cref="SessionDrainOrchestrator"/>.
/// </summary>
public sealed class NoOpSessionDrainOrchestrator : ISessionDrainOrchestrator
{
    public bool IsDraining => false;

    public Task DrainAsync(SessionDrainRequest request, CancellationToken ct = default)
        => Task.CompletedTask;
}
