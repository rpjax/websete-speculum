namespace Speculum.Api.BrowserSessions.Services.Contracts;

public interface ISessionSlotRegistry
{
    int GetAvailableSlots();
    bool IsAquired(Guid sessionId);
    bool TryAquire(Guid sessionId);
    void Release(Guid sessionId);
}
