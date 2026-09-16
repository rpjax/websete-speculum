namespace Speculum.Supervisor.Browser;

/// <summary>
/// Prefs de produto aplicadas em todo perfil antes do Gecko subir.
/// Lei: uma aba / um browsing context de sessão — sem first-run, Privacy Notice,
/// welcome, nem <c>window.open</c>/<c>_blank</c> virando segunda aba (mesmo contrato
/// do sidecar Chromium em <c>browser-session.md</c>).
/// </summary>
internal static class ProductProfilePrefs
{
    internal const string BeginMarker = "// --- begin Speculum product prefs ---";
    internal const string EndMarker = "// --- end Speculum product prefs ---";

    /// <summary>
    /// Bloco canónico. Também espelhado em <c>gecko-engine/baseline-profile/user.js</c>
    /// para mach/baseline; o supervisor é quem garante no launch de sessão.
    /// </summary>
    internal const string Block =
        """
        // --- begin Speculum product prefs ---
        // Single session tab — first-run / chrome noise off; open/_blank → same tab.
        user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
        user_pref("datareporting.policy.firstRunURL", "");
        user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
        user_pref("browser.aboutwelcome.enabled", false);
        user_pref("startup.homepage_welcome_url", "");
        user_pref("startup.homepage_welcome_url.additional", "");
        user_pref("browser.startup.homepage_override.mstone", "ignore");
        user_pref("browser.startup.page", 0);
        user_pref("browser.startup.homepage", "about:blank");
        user_pref("browser.newtabpage.enabled", false);
        user_pref("browser.newtab.preload", false);
        user_pref("browser.shell.checkDefaultBrowser", false);
        user_pref("browser.link.open_newwindow", 1);
        user_pref("browser.link.open_newwindow.restriction", 0);
        user_pref("browser.link.open_newwindow.override.external", 1);
        // --- end Speculum product prefs ---
        """;

    internal static void EnsureInProfile(string profileDirectory)
    {
        Directory.CreateDirectory(profileDirectory);
        var path = Path.Combine(profileDirectory, "user.js");
        var existing = File.Exists(path) ? File.ReadAllText(path) : string.Empty;
        var withoutProduct = StripProductBlock(existing).TrimEnd();
        var merged = string.IsNullOrEmpty(withoutProduct)
            ? Block.TrimEnd() + Environment.NewLine
            : withoutProduct + Environment.NewLine + Environment.NewLine + Block.TrimEnd() + Environment.NewLine;
        File.WriteAllText(path, merged);
    }

    internal static string StripProductBlock(string source)
    {
        if (string.IsNullOrEmpty(source))
        {
            return string.Empty;
        }

        var begin = source.IndexOf(BeginMarker, StringComparison.Ordinal);
        if (begin < 0)
        {
            return source;
        }

        var end = source.IndexOf(EndMarker, begin, StringComparison.Ordinal);
        if (end < 0)
        {
            return source[..begin].TrimEnd();
        }

        end += EndMarker.Length;
        while (end < source.Length && (source[end] == '\r' || source[end] == '\n'))
        {
            end++;
        }

        return (source[..begin] + source[end..]).TrimEnd();
    }
}
