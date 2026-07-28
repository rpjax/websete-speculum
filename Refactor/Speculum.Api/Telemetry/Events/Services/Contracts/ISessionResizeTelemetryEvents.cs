namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionResizeTelemetryEvents
{
    void Applied(int width, int height, string? resizeId);
    void Rejected(
        int? width,
        int? height,
        string? resizeId,
        string? errorCode,
        string? message,
        string? phase);
}
