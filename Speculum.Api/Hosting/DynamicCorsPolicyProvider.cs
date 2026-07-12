using Microsoft.AspNetCore.Cors.Infrastructure;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Hosting;

public sealed class DynamicCorsPolicyProvider : ICorsPolicyProvider
{
    private readonly BootstrapConfig _bootstrap;

    public DynamicCorsPolicyProvider(BootstrapConfig bootstrap)
    {
        _bootstrap = bootstrap;
    }

    public Task<CorsPolicy?> GetPolicyAsync(HttpContext context, string? policyName)
    {
        var store = context.RequestServices.GetRequiredService<ISpeculumConfigStore>();

        var builder = new CorsPolicyBuilder();

        if (store.IsSubdomainMirroringOperational)
        {
            var bootstrapOrigins = new HashSet<string>(
                _bootstrap.CorsAllowedOrigins,
                StringComparer.OrdinalIgnoreCase);

            builder.SetIsOriginAllowed(origin =>
                bootstrapOrigins.Contains(origin)
                || HostMapper.IsAllowedMotorOrigin(origin, _bootstrap.MotorPublicDomain));
        }
        else
        {
            builder.WithOrigins(_bootstrap.CorsAllowedOrigins.ToArray());
        }

        builder.AllowAnyHeader()
               .AllowAnyMethod()
               .AllowCredentials();

        return Task.FromResult<CorsPolicy?>(builder.Build());
    }
}
