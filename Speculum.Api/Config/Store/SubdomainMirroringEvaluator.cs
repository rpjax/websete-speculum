namespace Speculum.Api.Config.Store;

using Speculum.Api.Config.Runtime;

public static class SubdomainMirroringEvaluator
{
    public static (bool Operational, string[] Missing) Evaluate(
        SubdomainMirroringOptions? options,
        ForwardingOptions? forwarding,
        string motorPublicDomain)
    {
        if (options is null || !options.Enabled)
            return (false, []);

        var missing = new List<string>();

        if (string.IsNullOrWhiteSpace(motorPublicDomain))
            missing.Add("motorPublicDomain");

        var edgeTls = options.EdgeTls;
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
}
