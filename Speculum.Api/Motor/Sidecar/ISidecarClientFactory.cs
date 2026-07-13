namespace Speculum.Api.Motor.Sidecar;

public interface ISidecarClientFactory
{
    ISidecarClient Create(string sessionId);
}
