namespace Speculum.Api.Sessions.Models;

/// <summary>Decision returned by a session permission hook.</summary>
public enum PermissionDecision
{
    Deny = 0,
    Allow = 1,
}
