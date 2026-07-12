using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Admin;

public static class PublicEndpoints
{
    public static void MapPublicEndpoints(this WebApplication app)
    {
        app.MapGet("/api/public/client-config", (
            BootstrapConfig bootstrap,
            ISpeculumConfigStore store) =>
        {
            var config = store.Current;
            return Results.Ok(new
            {
                motorPublicDomain          = bootstrap.MotorPublicDomain,
                subdomainMirroringEnabled  = store.IsSubdomainMirroringOperational,
                forwardingHost             = config.Forwarding?.Host ?? "",
            });
        });
    }
}
