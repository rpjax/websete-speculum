using System.Net;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Sessions.Services;

namespace Speculum.Api.Configurations.Models.Scripting;

public sealed class ScriptingConfigurationValidator : IValidateOptions<ScriptingConfiguration>
{
    public ValidateOptionsResult Validate(string? name, ScriptingConfiguration options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var failures = new List<string>();
        for (var i = 0; i < options.Injections.Count; i++)
        {
            var injection = options.Injections[i];
            var hasStored = injection.Source.StoredScriptId is { } storedId && storedId != Guid.Empty;
            var hasRemote = injection.Source.RemoteUrl is not null;

            if (!Enum.IsDefined(injection.Position))
                failures.Add($"Scripting.Injections[{i}].Position is invalid.");

            if (!Enum.IsDefined(injection.ExecutionType))
                failures.Add($"Scripting.Injections[{i}].ExecutionType is invalid.");

            if (!Enum.IsDefined(injection.Source.SourceType))
                failures.Add($"Scripting.Injections[{i}].Source.SourceType is invalid.");

            switch (injection.Source.SourceType)
            {
                case ScriptSourceType.Stored:
                    if (!hasStored || hasRemote)
                    {
                        failures.Add(
                            $"Scripting.Injections[{i}] Stored source requires StoredScriptId and no RemoteUrl.");
                    }
                    break;
                case ScriptSourceType.Remote:
                    if (!hasRemote || hasStored)
                    {
                        failures.Add(
                            $"Scripting.Injections[{i}] Remote source requires RemoteUrl and no StoredScriptId.");
                    }
                    else
                    {
                        var urlFailure = ValidateRemoteUrl(injection.Source.RemoteUrl!, i);
                        if (urlFailure is not null)
                            failures.Add(urlFailure);
                    }
                    break;
                default:
                    failures.Add($"Scripting.Injections[{i}] must specify a supported source type.");
                    break;
            }

            if (injection.TargetRules.Count == 0)
            {
                failures.Add(
                    $"Scripting.Injections[{i}].TargetRules must contain at least one rule (use Any/Any for match-all).");
            }

            for (var r = 0; r < injection.TargetRules.Count; r++)
            {
                var ruleFailure = ValidateRule(injection.TargetRules[r], i, r);
                if (ruleFailure is not null)
                    failures.Add(ruleFailure);
            }
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }

    /// <summary>Validate remote URL shape + literal IP policy at options validate.</summary>
    internal static string? ValidateRemoteUrl(Uri url, int injectionIndex)
    {
        if (!url.IsAbsoluteUri || url.Scheme is not ("http" or "https"))
            return $"Scripting.Injections[{injectionIndex}].Source.RemoteUrl must be absolute http/https.";

        if (!string.IsNullOrEmpty(url.UserInfo))
            return $"Scripting.Injections[{injectionIndex}].Source.RemoteUrl must not include user info.";

        var host = url.DnsSafeHost;
        if (string.IsNullOrWhiteSpace(host)
            || string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
        {
            return $"Scripting.Injections[{injectionIndex}].Source.RemoteUrl host is not publicly routable.";
        }

        if (IPAddress.TryParse(host, out var ip) && !PublicHttpUrlPolicy.IsPublicIp(ip))
        {
            return $"Scripting.Injections[{injectionIndex}].Source.RemoteUrl must not target private/loopback addresses.";
        }

        return null;
    }

    private static string? ValidateRule(UrlMatchRule rule, int injectionIndex, int ruleIndex)
    {
        if (!Enum.IsDefined(rule.Domain.Scope) || !Enum.IsDefined(rule.Path.Scope)
            || !Enum.IsDefined(rule.Path.MatchType))
        {
            return $"Scripting.Injections[{injectionIndex}].TargetRules[{ruleIndex}] has invalid scope/matchType.";
        }

        if (rule.Domain.Scope == PatternScope.Pattern)
        {
            if (rule.Domain.Labels.Count == 0)
                return $"Scripting.Injections[{injectionIndex}].TargetRules[{ruleIndex}].Domain labels are required.";

            for (var i = 0; i < rule.Domain.Labels.Count; i++)
            {
                var label = rule.Domain.Labels[i];
                if (!Enum.IsDefined(label.Match))
                    return $"Scripting.Injections[{injectionIndex}].TargetRules[{ruleIndex}].Domain.Labels[{i}] is invalid.";

                if (label.Match == PatternPartMatch.Any && i != 0)
                    return $"Scripting.Injections[{injectionIndex}].TargetRules[{ruleIndex}].Domain only leading '*' is supported.";

                if (label.Match == PatternPartMatch.Exact && string.IsNullOrWhiteSpace(label.Value))
                    return $"Scripting.Injections[{injectionIndex}].TargetRules[{ruleIndex}].Domain.Labels[{i}] value is required.";
            }
        }

        if (rule.Path.Scope == PatternScope.Pattern)
        {
            for (var i = 0; i < rule.Path.Segments.Count; i++)
            {
                var segment = rule.Path.Segments[i];
                if (!Enum.IsDefined(segment.Match))
                    return $"Scripting.Injections[{injectionIndex}].TargetRules[{ruleIndex}].Path.Segments[{i}] is invalid.";

                if (segment.Match == PatternPartMatch.Exact && string.IsNullOrWhiteSpace(segment.Value))
                    return $"Scripting.Injections[{injectionIndex}].TargetRules[{ruleIndex}].Path.Segments[{i}] value is required.";
            }
        }

        return null;
    }
}
