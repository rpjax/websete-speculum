using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Events.Services.Contracts;

namespace Speculum.Api.Profiles.Events.Services;

public sealed class ProfileEventsFactory : IProfileEventsFactory
{
    private readonly IJournalWriter _writer;

    public ProfileEventsFactory(IJournalWriter writer)
    {
        _writer = writer ?? throw new ArgumentNullException(nameof(writer));
    }

    public IProfileEvents ForProfileOperation(string? correlationId)
        => new ProfileEvents(_writer, correlationId);
}
