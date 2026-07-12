using Speculum.Api.Config.Runtime;

namespace Speculum.Api.Config.Store;

public static class HostingEvaluator
{
    public static (bool Operational, string[] Missing) EvaluateProfile(
        HostingProfileOptions profile,
        ForwardingOptions? forwarding)
    {
        if (!profile.SubdomainMirroringEnabled)
            return (true, []);

        var missing = new List<string>();

        var edgeTls = profile.EdgeTls;
        if (edgeTls is null)
        {
            missing.Add("edgeTls");
        }
        else
        {
            if (string.IsNullOrWhiteSpace(edgeTls.Email))
                missing.Add("edgeTls.email");
            if (string.IsNullOrWhiteSpace(edgeTls.ApiToken))
                missing.Add("edgeTls.apiToken");
            if (!string.Equals(edgeTls.Provider, "cloudflare", StringComparison.OrdinalIgnoreCase))
                missing.Add("edgeTls.provider");
        }

        if (forwarding is null || forwarding.Domains.Length == 0)
        {
            missing.Add("forwarding.domains");
        }
        else if (!HostMapper.HasWildcardDomain(forwarding.Domains))
        {
            missing.Add("forwarding.domainsWildcard");
        }

        return (missing.Count == 0, missing.ToArray());
    }

    public static IReadOnlyList<HostingProfileStatus> EvaluateAll(
        HostingOptions hosting,
        ForwardingOptions? forwarding)
    {
        return hosting.Profiles.Select(p =>
        {
            var (op, missing) = EvaluateProfile(p, forwarding);
            return new HostingProfileStatus
            {
                Domain                      = p.Domain,
                SubdomainMirroringEnabled   = p.SubdomainMirroringEnabled,
                MirroringOperational        = op,
                Missing                     = missing,
            };
        }).ToArray();
    }
}
