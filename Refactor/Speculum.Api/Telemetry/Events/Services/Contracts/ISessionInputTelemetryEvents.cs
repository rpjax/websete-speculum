namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionInputTelemetryEvents
{
    void Applied(string kind, string? phase);
    void Rejected(string? errorCode, string? message, string? phase);
    void WebTransportReceived(string kind);
    void ControlReceived(string kind);
    void SidecarPushWritten(string kind, string? phase);
    void SidecarAdmitted(string kind);
}
