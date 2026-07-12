namespace Speculum.Api.Config.Runtime;

public sealed class SessionPolicyOptions
{
    public int TtlDays { get; init; } = 30;
}
