// Perfil baseline Speculum — software WebRender (produção sem GPU).
// mirror: once — deve existir antes do processo subir (user.js no profile).
user_pref("gfx.webrender.software", true);
user_pref("gfx.webrender.enabled", true);
user_pref("layers.acceleration.disabled", true);
user_pref("layers.acceleration.force-enabled", false);
user_pref("gfx.webrender.compositor", true);

// --- begin Speculum product prefs ---
// Single session tab — first-run / chrome noise off; open/_blank → same tab.
// Supervisor também reescreve este bloco em todo launch (ProductProfilePrefs).
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
