namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>M3: consumer queue exceeded hard ceiling — disconnect with reason, never silent gap.</summary>
internal sealed class ConsumerPressureExceededException : Exception
{
    public ConsumerPressureExceededException(string reasonCode)
        : base(reasonCode)
    {
        ReasonCode = reasonCode;
    }

    public string ReasonCode { get; }
}
