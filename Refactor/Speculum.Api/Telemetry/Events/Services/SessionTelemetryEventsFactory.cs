using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry.Events.Services.Contracts;

namespace Speculum.Api.Telemetry.Events.Services;

public sealed class SessionTelemetryEventsFactory(IJournalWriter writer) : ISessionTelemetryEventsFactory
{
    private readonly IJournalWriter _writer = writer ?? throw new ArgumentNullException(nameof(writer));

    public ISessionTelemetryEvents ForSession(Guid sessionId, Guid profileId)
        => new SessionTelemetryEvents(_writer, sessionId, profileId);
}
