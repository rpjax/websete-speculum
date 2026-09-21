using System.Reflection;
using System.Text.RegularExpressions;
using Speculum.Api.Presentation.Sessions;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Tests;

/// <summary>
/// Keeps harness admit mapping from silently dropping new <see cref="PageProjectionIntent"/> fields.
/// </summary>
public sealed class SessionHarnessPageProjectionIntentMappingTests
{
    [Fact]
    public void Request_And_ToPageProjectionIntent_Cover_Every_Intent_Property()
    {
        var intentProps = typeof(PageProjectionIntent)
            .GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Select(p => p.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        var requestProps = typeof(SessionHarnessPageProjectionIntentRequest)
            .GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(p => p.Name != nameof(SessionHarnessPageProjectionIntentRequest.Token))
            .Select(p => p.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        Assert.True(
            intentProps.SequenceEqual(requestProps, StringComparer.Ordinal),
            "SessionHarnessPageProjectionIntentRequest must mirror PageProjectionIntent "
            + $"(minus Token). Intent=[{string.Join(", ", intentProps)}] "
            + $"Request=[{string.Join(", ", requestProps)}]");

        var sourcePath = FindHarnessEndpointsSource();
        Assert.True(File.Exists(sourcePath), $"missing source: {sourcePath}");
        var source = File.ReadAllText(sourcePath);

        var methodMatch = Regex.Match(
            source,
            @"public\s+PageProjectionIntent\s+ToPageProjectionIntent\s*\(\s*\)\s*=>\s*new\s*\(\s*\)\s*\{(?<body>.*?)\}\s*;",
            RegexOptions.Singleline);
        Assert.True(
            methodMatch.Success,
            "Could not locate ToPageProjectionIntent() body in SessionHarnessEndpoints.cs");

        var mapBody = methodMatch.Groups["body"].Value;
        foreach (var name in intentProps)
        {
            Assert.True(
                Regex.IsMatch(mapBody, $@"\b{Regex.Escape(name)}\s*=", RegexOptions.CultureInvariant),
                $"ToPageProjectionIntent mapping omits PageProjectionIntent.{name}");
        }

        Assert.Contains(
            "body.ToPageProjectionIntent()",
            source,
            StringComparison.Ordinal);
    }

    private static string FindHarnessEndpointsSource()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(
                dir.FullName,
                "Speculum.Api",
                "Presentation",
                "Sessions",
                "SessionHarnessEndpoints.cs");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate SessionHarnessEndpoints.cs from test BaseDirectory");
    }
}
