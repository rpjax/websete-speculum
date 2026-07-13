namespace Speculum.MotorAssert.Tests;

/// <summary>
/// Marks tests that need the motor-assertive Docker stack (Chrome).
/// Skipped automatically when MOTOR_ASSERT_API_BASE is unset (local fast gate).
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public sealed class MotorAssertFactAttribute : FactAttribute
{
    public MotorAssertFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("MOTOR_ASSERT_API_BASE")))
        {
            Skip = "Requires MOTOR_ASSERT_API_BASE (GitHub Actions motor-assertive job only).";
        }
    }
}
