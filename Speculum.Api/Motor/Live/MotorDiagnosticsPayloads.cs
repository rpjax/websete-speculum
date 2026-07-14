using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Motor.Live;

/// <summary>Stable diagnostics payloads for Motor catalog failure / lifecycle emits.</summary>
internal static class MotorDiagnosticsPayloads
{
    public const int MessageMaxChars = 512;

    public static object StartFailed(
        string errorCode,
        string phase,
        string? message,
        string? persistedSessionId = null,
        bool? restored = null,
        bool? stateLoaded = null,
        int? cookieCount = null)
    {
        return new Dictionary<string, object?>
        {
            ["errorCode"] = errorCode,
            ["phase"] = phase,
            ["message"] = Truncate(message),
            ["persistedSessionId"] = persistedSessionId,
            ["restored"] = restored,
            ["stateLoaded"] = stateLoaded,
            ["cookieCount"] = cookieCount,
        };
    }

    public static object ExportFailed(string errorCode, string? message, string? persistedSessionId = null)
        => new Dictionary<string, object?>
        {
            ["errorCode"] = errorCode,
            ["phase"] = "export",
            ["message"] = Truncate(message),
            ["persistedSessionId"] = persistedSessionId,
        };

    public static object ExportCompleted(
        string? persistedSessionId,
        int? cookieCount = null,
        int? localStorageCount = null,
        int? historyCount = null)
        => new Dictionary<string, object?>
        {
            ["persistedSessionId"] = persistedSessionId,
            ["cookieCount"] = cookieCount,
            ["localStorageCount"] = localStorageCount,
            ["historyCount"] = historyCount,
        };

    public static object NavigateRejected(string? message, string? clientUrl = null, string? targetUrl = null)
        => new Dictionary<string, object?>
        {
            ["errorCode"] = "navigate_rejected",
            ["phase"] = "navigate",
            ["message"] = Truncate(message),
            ["clientUrl"] = clientUrl,
            ["targetUrl"] = targetUrl,
        };

    public static object SidecarFault(string fault)
    {
        var errorCode = string.Equals(fault, "sidecar_channel_closed", StringComparison.Ordinal)
            ? "sidecar_channel_closed"
            : "sidecar_fault";
        return new Dictionary<string, object?>
        {
            ["fault"] = Truncate(fault),
            ["errorCode"] = errorCode,
        };
    }

    public static object Probe(string[] ops, string? errorCode = null)
    {
        var map = new Dictionary<string, object?> { ["ops"] = ops };
        if (!string.IsNullOrWhiteSpace(errorCode))
            map["errorCode"] = errorCode;
        return map;
    }

    public static string ClassifyStartFailure(Exception ex, string phase)
    {
        if (ex is SidecarProtocolException spe)
            return spe.ErrorCode;
        if (ex is OperationCanceledException)
            return "session_cancelled";
        if (phase == "promote")
            return "session_cancelled";
        if (string.Equals(ex.Message, "Sessão cancelada durante startup.", StringComparison.Ordinal))
            return "session_cancelled";
        return "session_start_failed";
    }

    public static string Truncate(string? message)
    {
        if (string.IsNullOrEmpty(message)) return "";
        return message.Length <= MessageMaxChars ? message : message[..MessageMaxChars];
    }
}
