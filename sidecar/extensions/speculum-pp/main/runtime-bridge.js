/**
 * MAIN-world bridge: SessionConfig gate + root upward peer (`initContext`).
 * Talks to the isolated content script over `speculum.extension.runtime`.
 */
(function speculum_runtime_bridge() {
  'use strict';
  var CHANNEL = 'speculum.extension.runtime';
  var CONFIG_GLOBAL = '__SPECULUM_PROJECTION__';
  var READY_GLOBAL = '__SPECULUM_PROJECTION_READY__';
  var UPWARD_GLOBAL = '__speculumProjectionUpward';
  var TIMING_GLOBAL = '__SPECULUM_LAUNCH_TIMING__';
  /** Matches launch budget ConfigGate slice (25s * 0.68) until SessionConfig carries override. */
  var DEFAULT_CONFIG_GATE_MS = 17000;
  /** Matches launch budget InitContext slice (25s * 0.8) until SessionConfig carries override. */
  var DEFAULT_INIT_CONTEXT_MS = 20000;
  var nextReq = 1;
  var pending = new Map();

  function post(msg) {
    window.postMessage(Object.assign({ channel: CHANNEL }, msg), '*');
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function recordTiming(key, fields) {
    var bag = globalThis[TIMING_GLOBAL];
    if (!bag || typeof bag !== 'object') bag = {};
    bag[key] = fields;
    globalThis[TIMING_GLOBAL] = bag;
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.channel !== CHANNEL) return;
    if (d.kind !== 'config-ok' && d.kind !== 'config-fail' && d.kind !== 'initContext-ok' && d.kind !== 'initContext-fail')
      return;
    var waiter = pending.get(d.reqId);
    if (!waiter) return;
    pending.delete(d.reqId);
    waiter(d);
  });

  function request(kind, timeoutMs) {
    return new Promise(function (resolve) {
      var reqId = nextReq++;
      var timer = setTimeout(function () {
        pending.delete(reqId);
        resolve({ kind: kind + '-fail', reason: 'timeout' });
      }, timeoutMs);
      pending.set(reqId, function (d) {
        clearTimeout(timer);
        resolve(d);
      });
      post({ kind: kind, reqId: reqId });
    });
  }

  function resolveInitContextBudgetMs(config) {
    if (config && typeof config.initContextTimeoutMs === 'number' && config.initContextTimeoutMs > 0) {
      return config.initContextTimeoutMs;
    }
    return DEFAULT_INIT_CONTEXT_MS;
  }

  async function awaitSessionConfig() {
    var deadline = Date.now() + DEFAULT_CONFIG_GATE_MS;
    var attempts = 0;
    while (Date.now() < deadline) {
      attempts += 1;
      var slice = Math.min(500, Math.max(1, deadline - Date.now()));
      var res = await request('config-request', slice);
      if (res && res.kind === 'config-ok' && res.config && typeof res.config === 'object') {
        return { config: res.config, attempts: attempts };
      }
      await sleep(Math.min(50 * attempts, 250));
    }
    return { config: null, attempts: attempts };
  }

  var ready = (async function () {
    var gateStart = Date.now();
    var result = await awaitSessionConfig();
    var durationMs = Date.now() - gateStart;
    recordTiming('configGate', { durationMs: durationMs, attempts: result.attempts, ok: result.config !== null });
    if (!result.config) return null;
    globalThis[CONFIG_GLOBAL] = result.config;
    return result.config;
  })();

  globalThis[READY_GLOBAL] = ready;

  globalThis[UPWARD_GLOBAL] = {
    initContext: function () {
      return (async function () {
        var cfg = globalThis[CONFIG_GLOBAL];
        var initStart = Date.now();
        var deadline = Date.now() + resolveInitContextBudgetMs(cfg);
        var attempts = 0;
        while (Date.now() < deadline) {
          attempts += 1;
          var slice = Math.min(500, Math.max(1, deadline - Date.now()));
          var res = await request('initContext-request', slice);
          if (res && res.kind === 'initContext-ok') {
            var generation = res.generation;
            if (typeof generation === 'number' && Number.isInteger(generation) && generation >= 1) {
              recordTiming('initContext', {
                durationMs: Date.now() - initStart,
                attempts: attempts,
                ok: true,
                generation: generation,
              });
              return { generation: generation };
            }
          }
          await sleep(Math.min(50 * attempts, 250));
        }
        recordTiming('initContext', {
          durationMs: Date.now() - initStart,
          attempts: attempts,
          ok: false,
        });
        return Promise.reject(
          new Error('[speculumProjection] initContext: SW did not answer (budget exhausted)'),
        );
      })();
    },
  };
})();
