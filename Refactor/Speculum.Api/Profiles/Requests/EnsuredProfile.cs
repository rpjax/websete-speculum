namespace Speculum.Api.Profiles.Requests;

/// <summary>
/// Profile a client may start sessions with. <see cref="Created"/> is false when the
/// requested profile already existed. Unknown requested ids never bind — a new
/// server-generated id is returned with <see cref="Created"/> true.
/// </summary>
public sealed class EnsuredProfile
{
    public Guid ProfileId { get; init; }

    public bool Created { get; init; }
}
