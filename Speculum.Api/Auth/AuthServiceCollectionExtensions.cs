using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Speculum.Api.Auth.Services;
using Speculum.Api.Auth.Services.Contracts;
using Speculum.Api.Database;

namespace Speculum.Api.Auth;

public static class AuthServiceCollectionExtensions
{
    public static IServiceCollection AddOperatorAuth(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (!services.Any(d => d.ServiceType == typeof(SpeculumDbContext)))
        {
            throw new InvalidOperationException(
                "AddOperatorAuth requires AddDatabase() to be called first.");
        }

        services.TryAddSingleton<IPasswordHasher, Pbkdf2PasswordHasher>();
        services.TryAddScoped<IAuthService, AuthService>();
        return services;
    }
}
