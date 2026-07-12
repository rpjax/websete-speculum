using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Speculum.Api.Config.Runtime;

namespace Speculum.Api.Config.Store;

public sealed class ConfigValidationException : Exception
{
    public IReadOnlyList<(string Path, string Message)> Errors { get; }

    public ConfigValidationException(IReadOnlyList<(string Path, string Message)> errors)
        : base(Format(errors))
    {
        Errors = errors;
    }

    private static string Format(IReadOnlyList<(string Path, string Message)> errors)
    {
        var sb = new StringBuilder("Configuration validation failed:");
        foreach (var (path, message) in errors)
            sb.AppendLine().Append("  ").Append(path).Append(": ").Append(message);
        return sb.ToString();
    }
}

public static class ConfigValidator
{
    private static readonly Regex FqdnRegex = new(
        @"^(?i)[a-z0-9]+([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]+([-a-z0-9]*[a-z0-9])?)+$",
        RegexOptions.Compiled,
        TimeSpan.FromMilliseconds(250));

    private static readonly HashSet<string> ValidPositions =
        new(["HeaderTop", "HeaderBottom", "BodyTop", "BodyBottom"], StringComparer.Ordinal);

    private static readonly HashSet<string> ValidTypes =
        new(["Classic", "Module"], StringComparer.Ordinal);

    public static void ValidateSection(
        string key,
        JsonElement body,
        ForwardingOptions? currentForwarding = null,
        HostingOptions? currentHosting = null)
    {
        key = ConfigSectionKeys.NormalizeKey(key);
        var errors = new List<(string, string)>();

        switch (key)
        {
            case ConfigSectionKeys.Admin:
                ValidateAdmin(body, errors);
                break;
            case ConfigSectionKeys.Forwarding:
                ValidateForwarding(body, errors);
                break;
            case ConfigSectionKeys.MaxSessions:
                ValidateMaxSessions(body, errors);
                break;
            case ConfigSectionKeys.ScriptInjection:
                ValidateScriptInjection(body, errors);
                break;
            case ConfigSectionKeys.JsBridge:
                ValidateJsBridge(body, errors);
                break;
            case ConfigSectionKeys.SessionPolicy:
                ValidateSessionPolicy(body, errors);
                break;
            case ConfigSectionKeys.Hosting:
                ValidateHosting(body, errors, currentForwarding);
                break;
            case ConfigSectionKeys.SubdomainMirroring:
                ValidateSubdomainMirroringLegacy(body, errors, currentForwarding);
                break;
            default:
                errors.Add(("$.key", $"Unknown configuration section '{key}'."));
                break;
        }

        if (errors.Count > 0)
            throw new ConfigValidationException(errors);
    }

    private static void ValidateForwarding(JsonElement body, List<(string, string)> errors)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            errors.Add(("$.Forwarding", "Must be a JSON object."));
            return;
        }

        if (!body.TryGetProperty("host", out var hostEl) || hostEl.ValueKind != JsonValueKind.String)
        {
            errors.Add(("$.Forwarding.host", "host is required."));
            return;
        }

        var host = hostEl.GetString()?.Trim() ?? "";
        if (!IsValidFqdn(host))
            errors.Add(("$.Forwarding.host", "Must be a valid FQDN (no scheme or path)."));

        if (!body.TryGetProperty("domains", out var domainsEl) || domainsEl.ValueKind != JsonValueKind.Array)
        {
            errors.Add(("$.Forwarding.domains", "domains array is required."));
            return;
        }

        if (domainsEl.GetArrayLength() == 0)
        {
            errors.Add(("$.Forwarding.domains", "At least one domain pattern is required."));
            return;
        }

        var patterns = new List<string>();
        var i = 0;
        foreach (var item in domainsEl.EnumerateArray())
        {
            var prefix = $"$.Forwarding.domains[{i}]";
            if (item.ValueKind != JsonValueKind.String)
            {
                errors.Add((prefix, "Must be a string."));
                i++;
                continue;
            }

            var pattern = item.GetString()?.Trim() ?? "";
            if (!IsValidDomainPattern(pattern))
                errors.Add((prefix, "Invalid domain pattern."));
            else
                patterns.Add(pattern);
            i++;
        }

        if (errors.Count == 0 && !string.IsNullOrEmpty(host) && patterns.Count > 0
            && !DomainMatcher.MatchesAny(host, patterns))
        {
            errors.Add(("$.Forwarding.host",
                $"Host '{host}' must match at least one entry in domains."));
        }
    }

    private static void ValidateMaxSessions(JsonElement body, List<(string, string)> errors)
    {
        if (body.ValueKind != JsonValueKind.Number || !body.TryGetInt32(out var value))
        {
            errors.Add(("$.MaxSessions", "Must be a JSON number."));
            return;
        }

        if (value <= 0)
            errors.Add(("$.MaxSessions", "Must be greater than 0."));
        if (value > 65535)
            errors.Add(("$.MaxSessions", "Exceeds upper bound (65535)."));
    }

    private static void ValidateAdmin(JsonElement body, List<(string, string)> errors)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            errors.Add(("$.Admin", "Must be a JSON object."));
            return;
        }

        if (!body.TryGetProperty("apiKey", out var keyEl) || keyEl.ValueKind != JsonValueKind.String)
        {
            errors.Add(("$.Admin.apiKey", "apiKey is required."));
            return;
        }

        if (string.IsNullOrWhiteSpace(keyEl.GetString()))
            errors.Add(("$.Admin.apiKey", "apiKey must not be empty."));
    }

    private static void ValidateJsBridge(JsonElement body, List<(string, string)> errors)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            errors.Add(("$.JsBridge", "Must be a JSON object."));
            return;
        }

        if (!body.TryGetProperty("enable", out var enableEl)
            || enableEl.ValueKind is not JsonValueKind.True and not JsonValueKind.False)
        {
            errors.Add(("$.JsBridge.enable", "enable boolean is required."));
        }
    }

    private static void ValidateScriptInjection(JsonElement body, List<(string, string)> errors)
    {
        if (body.ValueKind != JsonValueKind.Array)
        {
            errors.Add(("$.ScriptInjection", "Must be a JSON array."));
            return;
        }

        var i = 0;
        foreach (var entry in body.EnumerateArray())
        {
            var prefix = $"$.ScriptInjection[{i}]";
            if (entry.ValueKind != JsonValueKind.Object)
            {
                errors.Add((prefix, "Must be a JSON object."));
                i++;
                continue;
            }

            var hasScriptId = entry.TryGetProperty("scriptId", out var idEl)
                && idEl.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(idEl.GetString());
            var hasUrl = entry.TryGetProperty("url", out var urlEl)
                && urlEl.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(urlEl.GetString());

            if (hasScriptId == hasUrl)
            {
                errors.Add((prefix, "Exactly one of 'scriptId' or 'url' must be set."));
                i++;
                continue;
            }

            if (hasScriptId)
                ValidateScriptId(idEl.GetString()!.Trim(), prefix + ".scriptId", errors);

            if (hasUrl)
                ValidateScriptUrl(urlEl.GetString()!.Trim(), prefix + ".url", errors);

            if (entry.TryGetProperty("position", out var posEl))
            {
                if (posEl.ValueKind != JsonValueKind.String || !ValidPositions.Contains(posEl.GetString() ?? ""))
                    errors.Add((prefix + ".position", $"Invalid position. Valid: {string.Join(", ", ValidPositions)}"));
            }

            if (entry.TryGetProperty("type", out var typeEl))
            {
                if (typeEl.ValueKind != JsonValueKind.String || !ValidTypes.Contains(typeEl.GetString() ?? ""))
                    errors.Add((prefix + ".type", $"Invalid type. Valid: {string.Join(", ", ValidTypes)}"));
            }

            i++;
        }
    }

    private static void ValidateScriptId(string scriptId, string path, List<(string, string)> errors)
    {
        if (scriptId.Length != 32 || !scriptId.All(c => char.IsAsciiHexDigit(c)))
            errors.Add((path, "Must be a 32-character hex script id."));
    }

    private static void ValidateScriptUrl(string url, string path, List<(string, string)> errors)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || uri.Scheme is not "http" and not "https")
        {
            errors.Add((path, "Must be an absolute http or https URL."));
            return;
        }

        if (!SsrfGuard.IsAllowedUrl(uri))
            errors.Add((path, "URL is blocked by SSRF guard (private/reserved addresses)."));
    }

    private static void ValidateSessionPolicy(JsonElement body, List<(string, string)> errors)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            errors.Add(("$.SessionPolicy", "Must be a JSON object."));
            return;
        }

        if (!body.TryGetProperty("ttlDays", out var ttlEl) || !ttlEl.TryGetInt32(out var ttl))
        {
            errors.Add(("$.SessionPolicy.ttlDays", "ttlDays integer is required."));
            return;
        }

        if (ttl <= 0)
            errors.Add(("$.SessionPolicy.ttlDays", "Must be greater than 0."));
        if (ttl > 3650)
            errors.Add(("$.SessionPolicy.ttlDays", "Exceeds upper bound (3650 days)."));
    }

    private static void ValidateHosting(
        JsonElement body,
        List<(string, string)> errors,
        ForwardingOptions? currentForwarding)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            errors.Add(("$.Hosting", "Must be a JSON object."));
            return;
        }

        if (body.TryGetProperty("acmeEmail", out var acmeEl)
            && acmeEl.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(acmeEl.GetString())
            && !IsValidEmail(acmeEl.GetString()!))
        {
            errors.Add(("$.Hosting.acmeEmail", "Must be a valid email address."));
        }

        if (!body.TryGetProperty("profiles", out var profilesEl) || profilesEl.ValueKind != JsonValueKind.Array)
        {
            errors.Add(("$.Hosting.profiles", "profiles array is required."));
            return;
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var i = 0;
        foreach (var profile in profilesEl.EnumerateArray())
        {
            var prefix = $"$.Hosting.profiles[{i}]";
            if (profile.ValueKind != JsonValueKind.Object)
            {
                errors.Add((prefix, "Must be a JSON object."));
                i++;
                continue;
            }

            if (!profile.TryGetProperty("domain", out var domainEl) || domainEl.ValueKind != JsonValueKind.String)
            {
                errors.Add(($"{prefix}.domain", "domain is required."));
            }
            else
            {
                var domain = domainEl.GetString()?.Trim() ?? "";
                if (!IsValidFqdn(domain))
                    errors.Add(($"{prefix}.domain", "Must be a valid FQDN."));
                else if (!seen.Add(domain))
                    errors.Add(($"{prefix}.domain", "Duplicate domain."));
            }

            if (profile.TryGetProperty("acmeEmail", out var pAcme)
                && pAcme.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(pAcme.GetString())
                && !IsValidEmail(pAcme.GetString()!))
            {
                errors.Add(($"{prefix}.acmeEmail", "Must be a valid email address."));
            }

            var mirroring = profile.TryGetProperty("subdomainMirroringEnabled", out var mEl)
                            && mEl.ValueKind == JsonValueKind.True;

            if (mirroring)
                ValidateProfileEdgeTls(profile, prefix, errors, currentForwarding);

            i++;
        }
    }

    private static void ValidateProfileEdgeTls(
        JsonElement profile,
        string prefix,
        List<(string, string)> errors,
        ForwardingOptions? currentForwarding)
    {
        if (!profile.TryGetProperty("edgeTls", out var edgeTls) || edgeTls.ValueKind != JsonValueKind.Object)
        {
            errors.Add(($"{prefix}.edgeTls", "edgeTls object is required when subdomainMirroringEnabled."));
            return;
        }

        if (!edgeTls.TryGetProperty("provider", out var providerEl)
            || providerEl.ValueKind != JsonValueKind.String
            || !string.Equals(providerEl.GetString(), "cloudflare", StringComparison.OrdinalIgnoreCase))
        {
            errors.Add(($"{prefix}.edgeTls.provider", "Must be 'cloudflare'."));
        }

        if (!edgeTls.TryGetProperty("email", out var emailEl)
            || emailEl.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(emailEl.GetString()))
        {
            errors.Add(($"{prefix}.edgeTls.email", "email is required when mirroring enabled."));
        }

        if (!edgeTls.TryGetProperty("apiToken", out var tokenEl)
            || tokenEl.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(tokenEl.GetString())
            || tokenEl.GetString() == "***")
        {
            errors.Add(($"{prefix}.edgeTls.apiToken", "apiToken is required when mirroring enabled."));
        }

        if (currentForwarding is null || currentForwarding.Domains.Length == 0)
        {
            errors.Add(($"{prefix}", "Forwarding.domains must be configured when mirroring enabled."));
        }
        else if (!HostMapper.HasWildcardDomain(currentForwarding.Domains))
        {
            errors.Add(($"{prefix}", "Forwarding.domains must include a wildcard when mirroring enabled."));
        }
    }

    private static bool IsValidEmail(string value)
        => value.Contains('@') && !value.StartsWith('@') && !value.EndsWith('@');

    private static void ValidateSubdomainMirroringLegacy(
        JsonElement body,
        List<(string, string)> errors,
        ForwardingOptions? currentForwarding)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            errors.Add(("$.SubdomainMirroring", "Must be a JSON object. Use Hosting section instead."));
            return;
        }

        var enabled = body.TryGetProperty("enabled", out var enabledEl)
                      && enabledEl.ValueKind == JsonValueKind.True;

        if (!enabled)
            return;

        errors.Add(("$.SubdomainMirroring", "Legacy section deprecated. Configure Hosting profiles instead."));
    }

    private static bool IsValidFqdn(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (value.Contains("://") || value.Contains('/') || value.Contains(' ') || value.Contains(':'))
            return false;
        try { return FqdnRegex.IsMatch(value); }
        catch (RegexMatchTimeoutException) { return false; }
    }

    private static bool IsValidDomainPattern(string pattern)
    {
        if (string.IsNullOrWhiteSpace(pattern)) return false;
        if (pattern.StartsWith("*.", StringComparison.Ordinal))
            return IsValidFqdn(pattern[2..]);
        return IsValidFqdn(pattern);
    }
}
