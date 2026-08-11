namespace Speculum.Api.Maintenance.Requests;

/// <summary>Lab wipe — requires explicit confirm token.</summary>
public sealed class LabResetRequest
{
    /// <summary>Must be the literal string <c>RESET</c>.</summary>
    public string Confirm { get; init; } = "";
}
