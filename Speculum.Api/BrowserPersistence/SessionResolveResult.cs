namespace Speculum.Api.BrowserPersistence;

/// <summary>
/// Result of resolving a browser session identity against SQLite indexers.
/// </summary>
public readonly record struct SessionResolveResult(
    string SessionId,
    string ClientToken,
    bool Restored);
