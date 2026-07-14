namespace Speculum.Api.Motor.Sidecar;

/// <summary>Sidecar wire error carrying a stable <see cref="ErrorCode"/> for diagnostics Act→Assert.</summary>
public sealed class SidecarProtocolException : InvalidOperationException
{
    public string ErrorCode { get; }

    public SidecarProtocolException(string errorCode, string message)
        : base(message)
    {
        ErrorCode = string.IsNullOrWhiteSpace(errorCode) ? "sidecar_session_create_failed" : errorCode.Trim();
    }
}
