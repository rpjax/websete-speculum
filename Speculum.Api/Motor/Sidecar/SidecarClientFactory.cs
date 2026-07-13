namespace Speculum.Api.Motor.Sidecar;

public sealed class SidecarClientFactory : ISidecarClientFactory
{
    public ISidecarClient Create(string sessionId) => new SidecarClient(sessionId);
}
