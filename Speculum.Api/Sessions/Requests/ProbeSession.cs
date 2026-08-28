using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Requests;

/// <summary>Diagnostics probe against a live session.</summary>
public sealed class ProbeSession
{
    public Guid SessionId { get; set; }

    public required DiagProbeRequest Probe { get; set; }
}
