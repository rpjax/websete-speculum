namespace Speculum.Api.Config.Runtime;

public static class HostingProfileResolver
{
    public static HostingProfileOptions? Resolve(string? requestHost, HostingOptions? hosting)
    {
        if (string.IsNullOrWhiteSpace(requestHost) || hosting?.Profiles is not { Count: > 0 })
            return null;

        var host = requestHost.Split(':')[0].Trim().ToLowerInvariant();

        foreach (var profile in hosting!.Profiles)
        {
            var domain = profile.Domain.Trim().ToLowerInvariant();
            if (host == domain)
                return profile;

            if (host == "www." + domain)
                return profile;

            if (profile.SubdomainMirroringEnabled)
            {
                var suffix = "." + domain;
                if (host.EndsWith(suffix, StringComparison.Ordinal) && host.Length > suffix.Length)
                    return profile;
            }
        }

        return null;
    }

    public static bool IsKnownHost(string? requestHost, HostingOptions? hosting)
        => Resolve(requestHost, hosting) is not null;

    /// <summary>
    /// CORS / origin check: apex and www always allowed; mirrored subdomains only when operational.
    /// </summary>
    public static bool IsAllowedOriginHost(
        string? requestHost,
        HostingOptions? hosting,
        IReadOnlyList<HostingProfileStatus>? profileStatuses)
    {
        if (string.IsNullOrWhiteSpace(requestHost) || hosting?.Profiles is not { Count: > 0 })
            return false;

        var host = requestHost.Split(':')[0].Trim().ToLowerInvariant();
        var profile = Resolve(host, hosting);
        if (profile is null)
            return false;

        var domain = profile.Domain.Trim().ToLowerInvariant();
        if (host == domain || host == "www." + domain)
            return true;

        if (!profile.SubdomainMirroringEnabled)
            return false;

        var status = profileStatuses?.FirstOrDefault(s =>
            s.Domain.Equals(profile.Domain, StringComparison.OrdinalIgnoreCase));
        return status?.MirroringOperational == true;
    }

    public static string ResolveAcmeEmail(HostingProfileOptions profile, HostingOptions hosting)
    {
        if (!string.IsNullOrWhiteSpace(profile.AcmeEmail))
            return profile.AcmeEmail.Trim();
        return hosting.AcmeEmail.Trim();
    }

    public static string SanitizeDomainForFile(string domain)
        => domain.Trim().ToLowerInvariant().Replace('.', '-');
}
