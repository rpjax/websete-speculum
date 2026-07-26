namespace Speculum.Api.Profiles.Events.Services.Contracts;

public interface IProfileEventsFactory
{
    /// <summary>
    /// Binds optional client correlation id onto subsequent profile journal facts.
    /// </summary>
    IProfileEvents ForProfileOperation(string? correlationId);
}
