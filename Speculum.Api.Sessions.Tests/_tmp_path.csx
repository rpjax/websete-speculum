using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Sessions.Services;
using System.Text;
using System.Text.Json;

var configuration = SessionsTestHarness.Engine(""www.target.test"");
configuration.Navigation = new NavigationConfiguration {
  DefaultTargetHost = ""www.target.test"",
  AllowedMainFrameUrls = [
    new UrlMatchRule {
      Domain = new DomainPattern {
        Scope = PatternScope.Pattern,
        Labels = [
          new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = ""shop"" },
          new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = ""target"" },
          new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = ""test"" },
        ]
      },
      Path = new PathPattern {
        Scope = PatternScope.Pattern,
        MatchType = PathMatchType.Prefix,
        Segments = [ new PathSegmentPattern { Match = PatternPartMatch.Exact, Value = ""catalog"" } ]
      }
    },
    new UrlMatchRule { Domain = new DomainPattern { Scope = PatternScope.Pattern, Labels = [
      new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = ""target"" },
      new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = ""test"" },
    ]}},
    new UrlMatchRule { Domain = new DomainPattern { Scope = PatternScope.Pattern, Labels = [
      new DomainLabelPattern { Match = PatternPartMatch.Any },
      new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = ""target"" },
      new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = ""test"" },
    ]}},
  ]
};
var json = JsonSerializer.Serialize(new { v = 1, h = ""shop.target.test"" });
var nso = Uri.EscapeDataString(Convert.ToBase64String(Encoding.UTF8.GetBytes(json)));
var resolver = new UrlResolver(new SessionsTestHarness.StaticConfigurationService(configuration));
var allowed = resolver.Resolve(""/catalog/item"", $""_w7s_nso={nso}"", ""speculum.test"");
Console.WriteLine($""ok={allowed.IsSuccess} err={string.Join(';', allowed.Errors.Select(e => e.Message))} val={allowed.Value}"");
