using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Admin;

public static class PublicEndpoints
{
    public static void MapPublicEndpoints(this WebApplication app)
    {
        app.MapGet("/api/public/client-config", (
            HttpContext http,
            ISpeculumConfigStore store) =>
        {
            var config = store.Current;
            var requestHost = http.Request.Host.Value ?? "";
            var profile = HostingProfileResolver.Resolve(requestHost, config.Hosting);
            var profileStatuses = config.HostingProfileStatuses
                .ToDictionary(s => s.Domain, s => s, StringComparer.OrdinalIgnoreCase);

            return Results.Ok(new
            {
                nsoParamName = NavigationStateParam.Name,
                forwardingHost = config.Forwarding?.Host ?? "",
                profiles = config.Hosting.Profiles.Select(p => new
                {
                    domain = p.Domain,
                    mirroringEnabled = p.SubdomainMirroringEnabled
                        && profileStatuses.TryGetValue(p.Domain, out var st)
                        && st.MirroringOperational,
                }),
                mirroringEnabled = profile?.SubdomainMirroringEnabled == true
                    && profileStatuses.TryGetValue(profile.Domain, out var current)
                    && current.MirroringOperational,
                currentDomain = profile?.Domain,
            });
        });
    }
}
