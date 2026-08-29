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
  var T_CONFIG = 2000;
  var nextReq = 1;
  var pending = new Map();

  function post(msg) {
    window.postMessage(Object.assign({ channel: CHANNEL }, msg), '*');
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

  var ready = (async function () {
    var isRoot = window.parent === window;
    var res = await request('config-request', T_CONFIG);
    if (!res || res.kind !== 'config-ok' || !res.config || typeof res.config !== 'object') {
      if (isRoot) {
        throw new Error(
          '[speculumProjection] SessionConfig missing within ' + T_CONFIG + 'ms — root session fault',
        );
      }
      // Nested dormant: leave CONFIG unset; awaitProjectionConfig returns null.
      return null;
    }
    globalThis[CONFIG_GLOBAL] = res.config;
    return res.config;
  })();

  globalThis[READY_GLOBAL] = ready;

  globalThis[UPWARD_GLOBAL] = {
    initContext: function () {
      return request('initContext-request', 5000).then(function (res) {
        if (!res || res.kind !== 'initContext-ok') {
          throw new Error(
            '[speculumProjection] initContext: SW did not answer (' +
              (res && res.reason ? res.reason : 'fail') +
              ')',
          );
        }
        var generation = res.generation;
        if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 1) {
          throw new Error('[speculumProjection] initContext: bad generation');
        }
        return { generation: generation };
      });
    },
  };
})();
