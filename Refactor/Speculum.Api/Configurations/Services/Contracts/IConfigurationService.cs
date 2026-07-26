namespace Speculum.Api.Configurations.Services.Contracts;

public interface IConfigurationService
{
    EngineConfiguration GetCurrent();
}
