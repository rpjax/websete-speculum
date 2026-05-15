using System.Collections.Immutable;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;

namespace Websete.Speculum.Host.Config;

#region Binding model (somente para ConfigurationBinder — não exponha referências)

internal sealed class SpeculumConfigBindingModel
{
    public string Environment { get; set; } = string.Empty;
    public string HttpAddress { get; set; } = string.Empty;
    public int MaxSessions { get; set; }
    public ForwardingProfileBinding[] ForwardingProfiles { get; set; } = Array.Empty<ForwardingProfileBinding>();
}

internal sealed class ForwardingProfileBinding
{
    public string Domain { get; set; } = string.Empty;
    public bool AllowSubDomains { get; set; } = true;
    public ForwardingRuleBinding[] Rules { get; set; } = Array.Empty<ForwardingRuleBinding>();
}

internal sealed class ForwardingRuleBinding
{
    public string Upstream { get; set; } = string.Empty;
    public string Downstream { get; set; } = string.Empty;
}

#endregion

public sealed class ForwardingRule
{
    public string Upstream { get; }
    public string Downstream { get; }

    internal ForwardingRule(string upstream, string downstream)
    {
        Upstream = upstream;
        Downstream = downstream;
    }
}

public sealed class ForwardingProfile
{
    public string Domain { get; }
    public bool AllowSubDomains { get; }
    public ImmutableArray<ForwardingRule> Rules { get; }

    internal ForwardingProfile(string domain, bool allowSubDomains, ImmutableArray<ForwardingRule> rules)
    {
        Domain = domain;
        AllowSubDomains = allowSubDomains;
        Rules = rules;
    }
}

/// <summary>
/// Snapshot imutável da configuração. Obtido apenas via <see cref="Load"/>.
/// </summary>
public sealed class SpeculumConfig
{
    public string Environment { get; }
    public string HttpAddress { get; }
    public int MaxSessions { get; }
    public ImmutableArray<ForwardingProfile> ForwardingProfiles { get; }

    private SpeculumConfig(
        string environment,
        string httpAddress,
        int maxSessions,
        ImmutableArray<ForwardingProfile> forwardingProfiles)
    {
        Environment = environment;
        HttpAddress = httpAddress;
        MaxSessions = maxSessions;
        ForwardingProfiles = forwardingProfiles;
    }

    /// <summary>
    /// Lê as chaves na raiz do <see cref="IConfiguration"/> (appsettings + ambiente + env vars),
    /// igual ao fluxo montado por <c>WebApplication.CreateBuilder(args)</c> em <c>Program.cs</c>.
    /// Retorna um snapshot imutável (coleções e texto não são mutáveis pelo consumidor).
    /// </summary>
    public static SpeculumConfig Load(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var binding = new SpeculumConfigBindingModel();
        configuration.Bind(binding);
        SpeculumConfigValidator.Validate(binding);
        return Freeze(binding);
    }

    private static SpeculumConfig Freeze(SpeculumConfigBindingModel m)
    {
        var rawProfiles = m.ForwardingProfiles ?? Array.Empty<ForwardingProfileBinding>();
        var profiles = ImmutableArray.CreateBuilder<ForwardingProfile>(rawProfiles.Length);

        foreach (var pb in rawProfiles)
        {
            var ruleBindings = pb.Rules ?? Array.Empty<ForwardingRuleBinding>();
            var rules = ImmutableArray.CreateBuilder<ForwardingRule>(ruleBindings.Length);

            foreach (var rb in ruleBindings)
                rules.Add(new ForwardingRule(rb.Upstream, rb.Downstream));

            profiles.Add(new ForwardingProfile(pb.Domain, pb.AllowSubDomains, rules.MoveToImmutable()));
        }

        return new SpeculumConfig(
            m.Environment,
            m.HttpAddress,
            m.MaxSessions,
            profiles.MoveToImmutable());
    }
}

internal static class SpeculumConfigValidator
{
    private static readonly Regex FqdnRegex = new(
        @"^(?i)[a-z0-9]+([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]+([-a-z0-9]*[a-z0-9])?)+$",
        RegexOptions.Compiled,
        TimeSpan.FromMilliseconds(250));

    private static ReadOnlySpan<char> UrlAndPathChars => " /:\\";

    private static ReadOnlySpan<char> PathSeparatorsAndSlashes => "/\\";

    internal static void Validate(SpeculumConfigBindingModel config)
    {
        ArgumentNullException.ThrowIfNull(config);

        var b = new ValidationResultBuilder();

        ValidateEnvironment(config.Environment, b);
        ValidateHttpAddress(config.HttpAddress, b);
        ValidateMaxSessions(config.MaxSessions, b);
        ValidateForwardingProfiles(config.ForwardingProfiles, b);

        b.ThrowIfInvalid();
    }

    private static void ValidateEnvironment(string environment, ValidationResultBuilder b)
    {
        if (string.IsNullOrWhiteSpace(environment))
        {
            b.WithError("$.Environment", "Environment is empty");
            return;
        }

        var e = environment.Trim();
        if (e.Length > 64)
            b.WithError("$.Environment", "Exceeds 64 characters");

        if (ContainsAnyChar(e.AsSpan(), PathSeparatorsAndSlashes))
            b.WithError("$.Environment", "Must not contain path characters");
    }

    private static void ValidateHttpAddress(string addr, ValidationResultBuilder b)
    {
        if (string.IsNullOrWhiteSpace(addr))
        {
            b.WithError("$.HttpAddress", "Address is empty");
            return;
        }

        if (!TrySplitHostPort(addr.Trim(), out _, out _, out var detail))
        {
            b.WithError("$.HttpAddress", string.IsNullOrEmpty(detail) ? "Invalid host:port format" : detail);
            return;
        }
    }

    private static void ValidateMaxSessions(int max, ValidationResultBuilder b)
    {
        if (max <= 0)
            b.WithError("$.MaxSessions", "Must be greater than 0");

        if (max > 65535)
            b.WithError("$.MaxSessions", "Exceeds safe OS-oriented upper bound (65535)");
    }

    private static void ValidateForwardingProfiles(ForwardingProfileBinding[] profiles, ValidationResultBuilder b)
    {
        if (profiles.Length == 0)
        {
            b.WithError("$.ForwardingProfiles", "At least one forwarding profile is required");
            return;
        }

        var seenDomains = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < profiles.Length; i++)
        {
            var prefix = $"$.ForwardingProfiles[{i}]";
            var profile = profiles[i];

            if (profile is null)
            {
                b.WithError(prefix, "Entry is null");
                continue;
            }

            ValidateProfileDomain(profile.Domain, prefix + ".Domain", b);

            if (IsValidFqdn(profile.Domain.Trim()) &&
                !seenDomains.Add(profile.Domain.Trim()))
            {
                b.WithError(prefix + ".Domain", "Duplicate domain across ForwardingProfiles");
            }

            var rules = profile.Rules ?? Array.Empty<ForwardingRuleBinding>();
            if (rules.Length == 0)
            {
                b.WithError(prefix + ".Rules", "At least one rule is required per profile");
                continue;
            }

            for (var r = 0; r < rules.Length; r++)
            {
                var rulePrefix = $"{prefix}.Rules[{r}]";
                var rule = rules[r];

                if (rule is null)
                {
                    b.WithError(rulePrefix, "Entry is null");
                    continue;
                }

                ValidateRewriteHost(rule.Upstream, rulePrefix + ".Upstream", b);
                ValidateRewriteHost(rule.Downstream, rulePrefix + ".Downstream", b);
            }
        }
    }

    /// <summary>Espelha validateDomain / validateRewriteRule do bootstrap Go.</summary>
    private static void ValidateProfileDomain(string domain, string jsonPath, ValidationResultBuilder b)
    {
        if (string.IsNullOrWhiteSpace(domain))
        {
            b.WithError(jsonPath, "Domain is empty");
            return;
        }

        var d = domain.Trim();

        if (!IsValidFqdn(d))
            b.WithError(jsonPath, "Must be a valid FQDN (ex: 'example.com'), not a URL");
    }

    private static void ValidateRewriteHost(string value, string jsonPath, ValidationResultBuilder b)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            b.WithError(jsonPath, "Cannot be empty");
            return;
        }

        var v = value.Trim();

        if (ContainsAnyChar(v.AsSpan(), UrlAndPathChars))
        {
            b.WithError(jsonPath, "Not a valid domain (must be FQDN; no scheme, spaces or path)");
            return;
        }

        if (!IsValidFqdn(v))
            b.WithError(jsonPath, "Not a valid domain");
    }

    private static bool IsValidFqdn(string domain)
    {
        if (string.IsNullOrWhiteSpace(domain))
            return false;

        var d = domain.Trim();
        if (ContainsAnyChar(d.AsSpan(), UrlAndPathChars))
            return false;

        try
        {
            return FqdnRegex.IsMatch(d);
        }
        catch (RegexMatchTimeoutException)
        {
            return false;
        }
    }

    private static bool ContainsAnyChar(ReadOnlySpan<char> span, ReadOnlySpan<char> anyOf)
    {
        foreach (var c in span)
        {
            if (anyOf.Contains(c))
                return true;
        }

        return false;
    }

    /// <summary>Análogo a net.SplitHostPort + faixa de porta TCP.</summary>
    private static bool TrySplitHostPort(string address, out string host, out int port, out string? detail)
    {
        host = string.Empty;
        port = 0;
        detail = null;

        if (IPEndPoint.TryParse(address, out var ep))
        {
            host = ep.Address.ToString();
            port = ep.Port;
            return port is >= 1 and <= 65535;
        }

        if (address.StartsWith('['))
        {
            var end = address.IndexOf(']', 1);
            if (end < 0)
            {
                detail = "Malformed IPv6 bracket";
                return false;
            }

            host = address[1..end];
            if (end + 1 >= address.Length || address[end + 1] != ':')
            {
                detail = "Expected ':port' after IPv6 address";
                return false;
            }

            if (!int.TryParse(address.AsSpan(end + 2), NumberStyles.None, CultureInfo.InvariantCulture, out port))
            {
                detail = "Invalid port";
                return false;
            }

            if (port is < 1 or > 65535)
            {
                detail = $"Port invalid: {port}";
                return false;
            }

            return true;
        }

        var lastColon = address.LastIndexOf(':');
        if (lastColon <= 0 || lastColon == address.Length - 1)
        {
            detail = address.Contains(':')
                ? "Invalid format (use [IPv6]:port for IPv6)"
                : "Expected host:port";
            return false;
        }

        host = address[..lastColon];
        if (host.Contains(':') && !IPAddress.TryParse(host, out _))
        {
            detail = "Invalid format (IPv6 must use [addr]:port)";
            return false;
        }

        if (!int.TryParse(address.AsSpan(lastColon + 1), NumberStyles.None, CultureInfo.InvariantCulture, out port))
        {
            detail = "Invalid port";
            return false;
        }

        if (string.IsNullOrWhiteSpace(host))
        {
            detail = "Host part cannot be empty";
            return false;
        }

        if (port is < 1 or > 65535)
        {
            detail = $"Port invalid: {port}";
            return false;
        }

        return true;
    }

    private sealed class ValidationResultBuilder
    {
        private readonly List<(string Path, string Message)> _errors = new();

        public ValidationResultBuilder WithError(string path, string message)
        {
            _errors.Add((path, message));
            return this;
        }

        public void ThrowIfInvalid()
        {
            if (_errors.Count == 0)
                return;

            var sb = new StringBuilder();
            sb.AppendLine("Speculum configuration validation failed:");
            foreach (var (path, message) in _errors)
                sb.Append("  ").Append(path).Append(": ").AppendLine(message);

            throw new InvalidOperationException(sb.ToString().TrimEnd());
        }
    }
}
