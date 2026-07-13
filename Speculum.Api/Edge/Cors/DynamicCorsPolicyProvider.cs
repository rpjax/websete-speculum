using Microsoft.AspNetCore.Cors.Infrastructure;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Store;
using Speculum.Api.Motor.Mapping;

namespace Speculum.Api.Edge.Cors;

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
        var hosting = store.Current.Hosting;
        var statuses = store.Current.HostingProfileStatuses;

        var builder = new CorsPolicyBuilder();
        builder.SetIsOriginAllowed(origin =>
        {
            if (_bootstrap.DevCorsOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
                return true;

            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                return false;

            return HostingProfileResolver.IsAllowedOriginHost(uri.Host, hosting, statuses);
        });

        builder.AllowAnyHeader()
               .AllowAnyMethod()
               .AllowCredentials();

        return Task.FromResult<CorsPolicy?>(builder.Build());
    }
}
