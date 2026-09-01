using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Requests;

/// <summary>Paged operator query over durable session rows (live + historical).</summary>
public sealed class ListSessions
{
    public const int DefaultTake = 50;
    public const int MaxTake = 200;

    public int Skip { get; set; }

    public int Take { get; set; } = DefaultTake;

    /// <summary>Filter by lifecycle state; null = all states.</summary>
    public LifecycleState? State { get; set; }

    /// <summary>Filter by mirror surface; null = all.</summary>
    public MirrorMode? MirrorMode { get; set; }

    /// <summary>Exact session id match (operator pasted an id) — takes precedence when set.</summary>
    public Guid? SessionId { get; set; }

    public Guid? ProfileId { get; set; }

    public bool SortDescending { get; set; } = true;
}
