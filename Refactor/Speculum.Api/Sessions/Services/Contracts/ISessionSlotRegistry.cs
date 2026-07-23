namespace Speculum.Api.Sessions.Services.Contracts;

public interface ISessionSlotRegistry
{
    int GetAvailableSlots();
    bool IsAquired(Guid sessionId);
    bool TryAquire(Guid sessionId);
    void Release(Guid sessionId);
}
