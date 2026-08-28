using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Speculum.Api.Database;
using Speculum.Api.Scripts.Services;
using Speculum.Api.Scripts.Services.Contracts;
using Speculum.Api.Scripts.Storage;

namespace Speculum.Api.Scripts;

public static class ScriptsServiceCollectionExtensions
{
    public static IServiceCollection AddScripts(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (!services.Any(d => d.ServiceType == typeof(SpeculumDbContext)))
        {
            throw new InvalidOperationException(
                "AddScripts requires AddDatabase() to be called first.");
        }

        services.TryAddScoped<IScriptRepository, EfScriptRepository>();
        services.TryAddScoped<IScriptService, ScriptService>();

        return services;
    }
}
