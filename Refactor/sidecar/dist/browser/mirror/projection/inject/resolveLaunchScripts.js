"use strict";
/**
 * Resolve session launch scripts for CDP inline inject (no HTML script tags).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLaunchUrlMatcherJs = buildLaunchUrlMatcherJs;
exports.resolveLaunchScripts = resolveLaunchScripts;
exports.filterLaunchScriptsForUrl = filterLaunchScriptsForUrl;
const Navigation_1 = require("../../../patchright/Navigation");
const remoteCache = new Map();
const REMOTE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_REMOTE_BYTES = 8 * 1024 * 1024;
async function fetchRemoteScript(url) {
    const cached = remoteCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < REMOTE_CACHE_TTL_MS) {
        return cached.content;
    }
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`resolveLaunchScripts: remote fetch ${url} status ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_REMOTE_BYTES) {
        throw new Error(`resolveLaunchScripts: remote script too large ${url} (${buf.byteLength} bytes)`);
    }
    const content = new TextDecoder('utf-8').decode(buf);
    remoteCache.set(url, { content, fetchedAt: Date.now() });
    return content;
}
function wrapLaunchContent(script, content) {
    const rulesJson = JSON.stringify(script.targetRules ?? []);
    const escaped = content.replace(/<\/script/gi, '<\\/script');
    if (script.type === 'Module') {
        const dataUrl = `data:text/javascript;base64,${Buffer.from(content, 'utf-8').toString('base64')}`;
        return `
(function speculum_launch_${sanitizeId(script.file)}() {
  'use strict';
  try {
    if (!__speculumLaunchUrlMatch(${rulesJson}, location.href)) return;
    import('${dataUrl}');
  } catch (_) {}
})();
`;
    }
    return `
(function speculum_launch_${sanitizeId(script.file)}() {
  'use strict';
  try {
    if (!__speculumLaunchUrlMatch(${rulesJson}, location.href)) return;
    ${escaped}
  } catch (_) {}
})();
`;
}
function sanitizeId(file) {
    return file.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 48) || 'script';
}
/** Runtime URL matcher embedded once when any launch script is present. */
function buildLaunchUrlMatcherJs() {
    return `
function __speculumLaunchUrlMatch(rules, href) {
  if (!rules || !rules.length) return false;
  try {
    var url = new URL(href);
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule) continue;
      var domain = rule.domain;
      var path = rule.path;
      if (!domain || !path) continue;
      var host = url.hostname.toLowerCase();
      var pathname = url.pathname.toLowerCase();
      if (!__speculumDomainMatch(domain, host)) continue;
      if (!__speculumPathMatch(path, pathname)) continue;
      return true;
    }
  } catch (_) {}
  return false;
}
function __speculumDomainMatch(pattern, host) {
  var scope = String(pattern.scope || '').toLowerCase();
  if (scope === 'any') return true;
  if (scope !== 'pattern' || !pattern.labels || !pattern.labels.length) return false;
  var labels = pattern.labels;
  var first = labels[0];
  if (String(first.match || '').toLowerCase() === 'any') {
    var apexParts = [];
    for (var i = 1; i < labels.length; i++) {
      var part = labels[i];
      if (String(part.match || '').toLowerCase() !== 'exact' || !String(part.value || '').trim()) return false;
      apexParts.push(String(part.value).trim().toLowerCase());
    }
    if (!apexParts.length) return false;
    var apex = apexParts.join('.');
    return host.endsWith('.' + apex) && host !== apex;
  }
  for (var j = 0; j < labels.length; j++) {
    var l = labels[j];
    if (String(l.match || '').toLowerCase() !== 'exact' || !String(l.value || '').trim()) return false;
  }
  var exact = labels.map(function (l) { return String(l.value).trim().toLowerCase(); }).join('.');
  return host === exact;
}
function __speculumPathMatch(pattern, pathname) {
  var scope = String(pattern.scope || '').toLowerCase();
  if (scope === 'any') return true;
  if (scope !== 'pattern') return false;
  var segments = pathname.split('/').filter(Boolean);
  var expected = pattern.segments || [];
  var matchType = String(pattern.matchType || '').toLowerCase();
  if (matchType === 'exact' && segments.length !== expected.length) return false;
  if (segments.length < expected.length) return false;
  for (var i = 0; i < expected.length; i++) {
    var part = expected[i];
    if (String(part.match || '').toLowerCase() === 'any') continue;
    if (String(part.match || '').toLowerCase() !== 'exact') return false;
    if (String(part.value || '').trim().toLowerCase() !== segments[i]) return false;
  }
  return true;
}
`;
}
async function resolveLaunchScripts(scripts) {
    const out = [];
    for (const script of scripts) {
        let content = script.content ?? '';
        if (script.remoteUrl && script.remoteUrl.length > 0) {
            content = await fetchRemoteScript(script.remoteUrl);
        }
        if (!content.trim())
            continue;
        out.push({
            file: script.file,
            wrappedSource: wrapLaunchContent(script, content),
            targetRulesJson: JSON.stringify(script.targetRules ?? []),
        });
    }
    return out;
}
/** Launch scripts matching a frame URL at bundle build time (optional filter). */
function filterLaunchScriptsForUrl(scripts, frameUrl) {
    if (!frameUrl || frameUrl === 'about:blank') {
        return scripts.filter((s) => s.targetRulesJson === '[]');
    }
    try {
        const url = new URL(frameUrl);
        return scripts.filter((s) => {
            const rules = JSON.parse(s.targetRulesJson);
            if (!rules?.length)
                return false;
            const pseudo = {
                position: '',
                type: 'Classic',
                file: s.file,
                content: '',
                targetRules: rules,
            };
            return (0, Navigation_1.scriptMatchesUrl)(pseudo, url);
        });
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=resolveLaunchScripts.js.map