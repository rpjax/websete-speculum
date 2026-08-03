using System.Text;
using System.Text.Json;
using Speculum.Api.Sessions.Models;

namespace Speculum.SessionsTest.Tests;

/// <summary>
/// Manual stealth suite collector (docs/stealth-suite.md). Not CI.
/// Run: STEALTH_SUITE=1 SESSIONS_TEST_API_BASE=http://127.0.0.1:8080/w7s
///      dotnet test --filter FullyQualifiedName~StealthSuiteCollect
/// </summary>
[Collection(nameof(SessionsTestCollection))]
[Trait("Category", "StealthSuiteManual")]
public sealed class StealthSuiteCollectTests
{
    private readonly SessionsTestHost _host = new();

    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    [Fact]
    public async Task Collect_desktop_and_mobile()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable("STEALTH_SUITE"),
                "1",
                StringComparison.Ordinal))
        {
            // Manual collector only — keep CI green without Skip API ambiguity.
            return;
        }

        var outDir = Environment.GetEnvironmentVariable("STEALTH_SUITE_OUT")
            ?? Path.GetFullPath(Path.Combine(
                AppContext.BaseDirectory,
                "..", "..", "..", "..", "..", "docs"));
        Directory.CreateDirectory(outDir);
        var rawPath = Path.Combine(outDir, "stealth-suite-raw.json");
        var mdPath = Path.Combine(outDir, "stealth-suite-results.md");

        var meta = await CollectMetaAsync();
        var desktop = await RunProfileAsync(
            "Desktop",
            width: 1280,
            height: 720,
            device: null);
        var mobile = await RunProfileAsync(
            "Mobile",
            width: 414,
            height: 711,
            device: new DeviceProfile
            {
                Mobile = true,
                Touch = true,
                DeviceScaleFactor = 2,
                MaxTouchPoints = 5,
                UserAgentProfile = "mobile",
                DeviceCategory = "phone",
            });

        var payload = new
        {
            meta,
            profiles = new[] { desktop, mobile },
        };
        await File.WriteAllTextAsync(rawPath, JsonSerializer.Serialize(payload, JsonOpts));
        await File.WriteAllTextAsync(mdPath, RenderMarkdown(meta, desktop, mobile));

        Assert.True(File.Exists(mdPath), $"expected report at {mdPath}");
        Assert.True(File.Exists(rawPath), $"expected raw at {rawPath}");
        Assert.True(desktop.LaunchOk || mobile.LaunchOk, "at least one profile must launch");
        Assert.NotEmpty(desktop.Sites);
    }

    private async Task<Dictionary<string, string?>> CollectMetaAsync()
    {
        var gitSha = "unknown";
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "git",
                Arguments = "rev-parse --short HEAD",
                RedirectStandardOutput = true,
                UseShellExecute = false,
                WorkingDirectory = Path.GetFullPath(Path.Combine(
                    AppContext.BaseDirectory, "..", "..", "..", "..", "..")),
            };
            using var p = System.Diagnostics.Process.Start(psi);
            if (p is not null)
            {
                gitSha = (await p.StandardOutput.ReadToEndAsync()).Trim();
                await p.WaitForExitAsync();
            }
        }
        catch
        {
            // ignore
        }

        return new Dictionary<string, string?>
        {
            ["whenUtc"] = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"),
            ["env"] = "dev",
            ["apiBase"] = _host.ApiBase,
            ["gitSha"] = gitSha,
            ["sidecarImage"] = "speculum-refactor/speculum-refactor-sidecar:dev",
            ["inputBackend"] = "patchright",
            ["navigationAllowlist"] = "Any (dev seed)",
        };
    }

    private async Task<ProfileResult> RunProfileAsync(
        string name,
        int width,
        int height,
        DeviceProfile? device)
    {
        var result = new ProfileResult
        {
            Name = name,
            ViewportCss = $"{width}x{height}",
            Device = device is null
                ? "desktop (mobile=false)"
                : $"mobile={device.Mobile}/touch={device.Touch}/dsf={device.DeviceScaleFactor}/mtp={device.MaxTouchPoints}",
        };

        await using var act = new SessionsActClient(_host);
        try
        {
            await act.ConnectAsync();
            // Start on about:blank equivalent — default host path /, then navigate suite URLs.
            await act.StartSessionAsync("/", query: "", width, height, device);
            result.LaunchOk = true;

            var fingerprint = await CaptureFingerprintAsync(act);
            result.Fingerprint = fingerprint;

            foreach (var target in SuiteTargets)
            {
                result.Sites.Add(await ProbeSiteAsync(act, target));
            }
        }
        catch (Exception ex)
        {
            result.LaunchOk = false;
            result.LaunchError = $"{ex.GetType().Name}: {ex.Message}";
        }

        return result;
    }

    private static readonly SuiteTarget[] SuiteTargets =
    [
        new("creepjs", "abrahamjuliot.github.io", "/creepjs/", "", CreepReadyHint, 120),
        new("sannysoft", "bot.sannysoft.com", "/", "", "webdriver", 45),
        new("vastel", "arh.antoinevastel.com", "/bots/areyouheadless", "", "headless", 45),
        new("pixelscan", "pixelscan.net", "/", "", "pixelscan|fingerprint|bot|pass|fail", 60),
        new("fingerprint", "fingerprint.com", "/demo/", "", "fingerprint|visitor|bot", 60),
        new("cloudflare", "www.cloudflare.com", "/", "", "cloudflare|challenge|Just a moment", 45),
    ];

    private const string CreepReadyHint =
        "FP ID|fingerprint|lie|headless|WebGL|canvas|noise|worker|Chrome";

    private async Task<SiteResult> ProbeSiteAsync(SessionsActClient act, SuiteTarget target)
    {
        var site = new SiteResult
        {
            Id = target.Id,
            Host = target.Host,
            Path = target.Path,
        };

        try
        {
            var query = EncodeNsoQuery(target.Host, target.ExtraQuery);
            var nav = await act.NavigateAsync(target.Path, query);
            site.NavApplied = nav.Applied;
            site.NavOutcome = nav.Outcome;
            site.NavUrl = nav.Url;
            site.NavError = string.IsNullOrEmpty(nav.ErrorCode)
                ? null
                : $"{nav.ErrorCode}/{nav.Phase}: {nav.Message}";

            if (!nav.Applied)
            {
                site.Load = "navigation_rejected";
                site.Findings = site.NavError ?? nav.Outcome;
                return site;
            }

            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(target.WaitSeconds);
            string? lastText = null;
            var ready = false;
            while (DateTime.UtcNow < deadline)
            {
                lastText = await SafeEvaluateAsync(
                    act,
                    "(() => (document.body && document.body.innerText) ? document.body.innerText.slice(0, 20000) : '')()");
                if (MatchesAny(lastText, target.ReadyPattern))
                {
                    ready = true;
                    // CreepJS keeps computing; give it a bit more after first signal.
                    if (target.Id == "creepjs")
                    {
                        await Task.Delay(15_000);
                        lastText = await SafeEvaluateAsync(
                            act,
                            "(() => (document.body && document.body.innerText) ? document.body.innerText.slice(0, 20000) : '')()");
                    }

                    break;
                }

                await Task.Delay(1500);
            }

            site.Load = ready ? "ok" : "timeout";
            site.Href = await SafeEvaluateAsync(act, "location.href");
            site.Title = await SafeEvaluateAsync(act, "document.title");
            site.RawTextExcerpt = Truncate(lastText ?? "", 8000);
            site.Findings = ExtractFindings(target.Id, lastText ?? "", site.Href ?? "");
        }
        catch (Exception ex)
        {
            site.Load = "fail";
            site.Findings = $"{ex.GetType().Name}: {ex.Message}";
        }

        return site;
    }

    private static async Task<string> CaptureFingerprintAsync(SessionsActClient act)
    {
        const string expr = """
(async () => {
  const out = {
    href: location.href,
    ua: navigator.userAgent,
    platform: navigator.platform,
    webdriver: navigator.webdriver,
    languages: navigator.languages,
    maxTouchPoints: navigator.maxTouchPoints,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    dpr: window.devicePixelRatio,
    inner: [window.innerWidth, window.innerHeight],
    outer: [window.outerWidth, window.outerHeight],
    screen: [window.screen.width, window.screen.height],
    avail: [window.screen.availWidth, window.screen.availHeight],
    chrome: !!(window).chrome,
    pluginsLength: navigator.plugins ? navigator.plugins.length : -1,
  };
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) { out.webgl = null; }
    else {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.webgl = {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      };
    }
  } catch (e) { out.webglError = String(e); }
  try {
    out.uaData = navigator.userAgentData ? {
      mobile: navigator.userAgentData.mobile,
      platform: navigator.userAgentData.platform,
      brands: navigator.userAgentData.brands,
    } : null;
  } catch (e) { out.uaDataError = String(e); }
  try {
    out.worker = await new Promise((resolve) => {
      const code = 'postMessage({ua:navigator.userAgent,platform:navigator.platform,cores:navigator.hardwareConcurrency,mem:navigator.deviceMemory})';
      const blob = new Blob([code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      const t = setTimeout(() => { try { w.terminate(); } catch (_) {} URL.revokeObjectURL(url); resolve({ error: 'timeout' }); }, 3000);
      w.onmessage = (ev) => { clearTimeout(t); try { w.terminate(); } catch (_) {} URL.revokeObjectURL(url); resolve(ev.data); };
      w.onerror = (err) => { clearTimeout(t); try { w.terminate(); } catch (_) {} URL.revokeObjectURL(url); resolve({ error: String(err && err.message || err) }); };
    });
  } catch (e) { out.workerError = String(e); }
  return JSON.stringify(out);
})()
""";
        return await SafeEvaluateAsync(act, expr);
    }

    private static string ExtractFindings(string id, string text, string href)
    {
        var lines = new List<string>();
        if (!string.IsNullOrWhiteSpace(href))
        {
            lines.Add($"href={href}");
        }

        var lowered = text.ToLowerInvariant();
        void Flag(string label, params string[] needles)
        {
            foreach (var n in needles)
            {
                if (lowered.Contains(n.ToLowerInvariant(), StringComparison.Ordinal))
                {
                    lines.Add($"{label}: matched '{n}'");
                    return;
                }
            }
        }

        switch (id)
        {
            case "creepjs":
                Flag("headless", "headless");
                Flag("lie", "lie", "lies");
                Flag("webgl", "webgl", "swiftshader", "llvmpipe", "angle");
                Flag("canvas", "canvas");
                Flag("worker", "worker");
                Flag("ua", "user agent", "user-agent", "platform");
                lines.AddRange(PickInterestingLines(text, 18, "lie", "headless", "webgl", "canvas", "worker", "chrome", "platform", "screen", "dpr", "noise", "failed", "rejected"));
                break;
            case "sannysoft":
                Flag("webdriver", "webdriver");
                Flag("chrome", "chrome");
                Flag("permissions", "permission");
                Flag("plugins", "plugin");
                lines.AddRange(PickInterestingLines(text, 20, "webdriver", "chrome", "fail", "missing", "false", "true", "headless"));
                break;
            case "vastel":
                Flag("verdict", "you are", "headless", "not headless", "chrome headless");
                lines.AddRange(PickInterestingLines(text, 12, "headless", "you are", "chrome"));
                break;
            case "pixelscan":
                Flag("verdict", "inconsistent", "bot", "pass", "fail", "suspicious");
                lines.AddRange(PickInterestingLines(text, 15, "fail", "pass", "bot", "inconsist", "webgl", "timezone", "ua", "ip"));
                break;
            case "fingerprint":
                Flag("bot", "bot", "visitor", "identified");
                lines.AddRange(PickInterestingLines(text, 12, "bot", "visitor", "incognito", "tamper"));
                break;
            case "cloudflare":
                if (lowered.Contains("just a moment", StringComparison.Ordinal)
                    || lowered.Contains("checking your browser", StringComparison.Ordinal)
                    || lowered.Contains("cf-browser-verification", StringComparison.Ordinal)
                    || lowered.Contains("turnstile", StringComparison.Ordinal))
                {
                    lines.Add("outcome=challenge");
                }
                else if (lowered.Contains("access denied", StringComparison.Ordinal)
                         || lowered.Contains("blocked", StringComparison.Ordinal)
                         || lowered.Contains("attention required", StringComparison.Ordinal))
                {
                    lines.Add("outcome=blocked");
                }
                else if (lowered.Contains("cloudflare", StringComparison.Ordinal)
                         || href.Contains("cloudflare.com", StringComparison.OrdinalIgnoreCase))
                {
                    lines.Add("outcome=passed_or_content");
                }
                else
                {
                    lines.Add("outcome=unclear");
                }

                lines.AddRange(PickInterestingLines(text, 8, "challenge", "just a moment", "blocked", "turnstile", "cloudflare"));
                break;
        }

        if (lines.Count == 1)
        {
            lines.Add(Truncate(text.ReplaceLineEndings(" ").Trim(), 400));
        }

        return string.Join(" | ", lines);
    }

    private static IEnumerable<string> PickInterestingLines(string text, int max, params string[] needles)
    {
        var taken = 0;
        foreach (var raw in text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var line = raw.Trim();
            if (line.Length < 3 || line.Length > 240)
            {
                continue;
            }

            if (needles.Any(n => line.Contains(n, StringComparison.OrdinalIgnoreCase)))
            {
                yield return line;
                taken++;
                if (taken >= max)
                {
                    yield break;
                }
            }
        }
    }

    private static bool MatchesAny(string? text, string patternCsv)
    {
        if (string.IsNullOrEmpty(text))
        {
            return false;
        }

        foreach (var part in patternCsv.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (text.Contains(part, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static async Task<string> SafeEvaluateAsync(SessionsActClient act, string expression)
    {
        try
        {
            return await act.EvaluateAsync(expression);
        }
        catch (Exception ex)
        {
            return $"__eval_error__:{ex.Message}";
        }
    }

    private static string EncodeNsoQuery(string host, string extraQuery)
    {
        var json = JsonSerializer.Serialize(new { v = 1, h = host.Trim().ToLowerInvariant() });
        var nso = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
        var encoded = Uri.EscapeDataString(nso);
        if (string.IsNullOrWhiteSpace(extraQuery))
        {
            return $"_w7s_nso={encoded}";
        }

        var trimmed = extraQuery.Trim().TrimStart('?');
        return $"{trimmed}&_w7s_nso={encoded}";
    }

    private static string Truncate(string value, int max)
        => value.Length <= max ? value : value[..max] + "…";

    private static string RenderMarkdown(
        Dictionary<string, string?> meta,
        ProfileResult desktop,
        ProfileResult mobile)
    {
        var sb = new StringBuilder();
        sb.AppendLine("## Stealth suite results");
        sb.AppendLine($"- When (UTC): {meta["whenUtc"]}");
        sb.AppendLine($"- Env: {meta["env"]}");
        sb.AppendLine($"- Sidecar image / git SHA: `{meta["sidecarImage"]}` / `{meta["gitSha"]}`");
        sb.AppendLine($"- SPECULUM_INPUT_BACKEND: `{meta["inputBackend"]}`");
        sb.AppendLine($"- API base: `{meta["apiBase"]}`");
        sb.AppendLine($"- Navigation allowlist note: {meta["navigationAllowlist"]}");
        sb.AppendLine();
        sb.AppendLine("Raw capture: [`docs/stealth-suite-raw.json`](stealth-suite-raw.json)");
        sb.AppendLine();
        AppendProfile(sb, desktop);
        AppendProfile(sb, mobile);
        sb.AppendLine("### Priority backlog (objective)");
        foreach (var item in BuildBacklog(desktop, mobile))
        {
            sb.AppendLine($"1. {item}");
        }

        sb.AppendLine();
        sb.AppendLine("### Explicitly out of scope this run");
        sb.AppendLine("- TLS JA3/JA4, IP/ASN reputation, CF private ML (not visible in-page).");
        sb.AppendLine();
        sb.AppendLine("### Method");
        sb.AppendLine("- Driven via SessionHub StartSession/Navigate + harness `POST …/evaluate` inside remote Chrome (not operator browser).");
        sb.AppendLine("- Suite order per [stealth-suite.md](stealth-suite.md).");
        return sb.ToString();
    }

    private static void AppendProfile(StringBuilder sb, ProfileResult profile)
    {
        sb.AppendLine($"### Profile: {profile.Name}");
        sb.AppendLine($"- Viewport requested (CSS): {profile.ViewportCss}");
        sb.AppendLine($"- Device: {profile.Device}");
        sb.AppendLine($"- Launch: {(profile.LaunchOk ? "ok" : $"fail — {profile.LaunchError}")}");
        if (!string.IsNullOrWhiteSpace(profile.Fingerprint))
        {
            sb.AppendLine($"- Browser snapshot (evaluate): `{Truncate(profile.Fingerprint.ReplaceLineEndings(" "), 900)}`");
        }

        sb.AppendLine();
        sb.AppendLine("| # | URL | Load | Key findings (fail/lie/mismatch only) |");
        sb.AppendLine("|---|-----|------|----------------------------------------|");
        var i = 1;
        foreach (var site in profile.Sites)
        {
            var findings = (site.Findings ?? "").Replace("|", "/").Replace("\n", " ");
            sb.AppendLine($"| {i++} | {site.Id} | {site.Load} | {Truncate(findings, 500)} |");
        }

        sb.AppendLine();
    }

    private static List<string> BuildBacklog(ProfileResult desktop, ProfileResult mobile)
    {
        var items = new List<string>();
        void Consider(ProfileResult p)
        {
            var fp = p.Fingerprint ?? "";
            if (fp.Contains("\"webdriver\":true", StringComparison.OrdinalIgnoreCase)
                || fp.Contains("webdriver\": true", StringComparison.OrdinalIgnoreCase))
            {
                items.Add($"[{p.Name}] navigator.webdriver===true — patch in ChromeRuntime / Patchright launch flags.");
            }

            if (fp.Contains("SwiftShader", StringComparison.OrdinalIgnoreCase)
                || fp.Contains("llvmpipe", StringComparison.OrdinalIgnoreCase)
                || fp.Contains("Google SwiftShader", StringComparison.OrdinalIgnoreCase))
            {
                items.Add($"[{p.Name}] WebGL renderer is software (SwiftShader/llvmpipe) — spoof or GPU passthrough (`device-emulation` / WebGL extension).");
            }

            if (p.Name == "Mobile"
                && (fp.Contains("Linux", StringComparison.Ordinal)
                    || fp.Contains("\"platform\":\"Linux", StringComparison.Ordinal)))
            {
                items.Add("[Mobile] platform/UA still Linux-like while mobile=true — align UA-CH + platform in device-emulation / userAgentProfile.");
            }

            foreach (var site in p.Sites)
            {
                var f = site.Findings ?? "";
                if (site.Load is "timeout" or "fail" or "navigation_rejected")
                {
                    items.Add($"[{p.Name}/{site.Id}] load={site.Load} — {Truncate(f, 160)}");
                }
                else if (f.Contains("outcome=challenge", StringComparison.Ordinal)
                         || f.Contains("outcome=blocked", StringComparison.Ordinal))
                {
                    items.Add($"[{p.Name}/{site.Id}] Cloudflare-facing outcome={f.Split('|').FirstOrDefault(x => x.Contains("outcome=", StringComparison.Ordinal))?.Trim()} — browser-side leaks likely contribute; correlate with CreepJS/Sannysoft.");
                }
                else if (f.Contains("lie:", StringComparison.OrdinalIgnoreCase)
                         || f.Contains("headless:", StringComparison.OrdinalIgnoreCase)
                         || f.Contains("webdriver:", StringComparison.OrdinalIgnoreCase))
                {
                    items.Add($"[{p.Name}/{site.Id}] {Truncate(f, 200)}");
                }
            }
        }

        Consider(desktop);
        Consider(mobile);

        if (items.Count == 0)
        {
            items.Add("no browser-side fails beyond known SwiftShader/datacenter IP (verify raw JSON).");
        }

        return items.Distinct(StringComparer.Ordinal).Take(12).ToList();
    }

    private sealed record SuiteTarget(
        string Id,
        string Host,
        string Path,
        string ExtraQuery,
        string ReadyPattern,
        int WaitSeconds);

    private sealed class ProfileResult
    {
        public string Name { get; set; } = "";
        public string ViewportCss { get; set; } = "";
        public string Device { get; set; } = "";
        public bool LaunchOk { get; set; }
        public string? LaunchError { get; set; }
        public string? Fingerprint { get; set; }
        public List<SiteResult> Sites { get; } = [];
    }

    private sealed class SiteResult
    {
        public string Id { get; set; } = "";
        public string Host { get; set; } = "";
        public string Path { get; set; } = "";
        public string Load { get; set; } = "pending";
        public bool NavApplied { get; set; }
        public string? NavOutcome { get; set; }
        public string? NavUrl { get; set; }
        public string? NavError { get; set; }
        public string? Href { get; set; }
        public string? Title { get; set; }
        public string? Findings { get; set; }
        public string? RawTextExcerpt { get; set; }
    }
}
