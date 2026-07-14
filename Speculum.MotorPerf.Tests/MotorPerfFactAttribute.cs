namespace Speculum.MotorPerf.Tests;

/// <summary>
/// Performance / SLO tests — run under perf.yml, not required CI.
/// Skipped when MOTOR_ASSERT_API_BASE is unset.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public sealed class MotorPerfFactAttribute : FactAttribute
{
    public MotorPerfFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("MOTOR_ASSERT_API_BASE")))
            Skip = "Requires MOTOR_ASSERT_API_BASE (GitHub Actions perf job).";
    }
}
