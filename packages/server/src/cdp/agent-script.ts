export const AGENT_GLOBAL_KEY = '__RN_DEVTOOLS_AGENT__';

/**
 * Self-contained script injected into the app via Runtime.evaluate.
 * Installs a global agent that discovers Redux stores / React Query / React Navigation
 * by walking the React fiber tree, reads AsyncStorage through the native module proxy,
 * and records dispatched actions by wrapping store.dispatch.
 *
 * Constraints (validated against a real RN 0.80 bridgeless app):
 * - CDP awaitPromise does not resolve RN's polyfilled Promises → async ops use a
 *   kick-and-poll pattern via agent.results slots.
 * - Written in ES5 style: it runs inside Hermes through a single evaluate call.
 */
export const AGENT_SCRIPT = `
(function() {
  var g = (typeof globalThis !== 'undefined' ? globalThis : global);
  if (g.${AGENT_GLOBAL_KEY}) return 'already-installed';

  var MAX_ACTIONS = 500;

  var agent = {
    version: 1,
    stores: {},
    queryClient: null,
    navigation: null,
    actions: [],
    results: {},
    actionCounter: 0
  };

  function isStore(v) {
    return !!v && typeof v.getState === 'function' &&
      typeof v.dispatch === 'function' && typeof v.subscribe === 'function';
  }

  function prune(value, depth) {
    if (value === null || value === undefined) return value;
    var t = typeof value;
    if (t === 'string') return value.length > 500 ? value.slice(0, 500) + '…[truncated]' : value;
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'function') return '[Function]';
    if (t !== 'object') return String(value);
    if (depth <= 0) {
      if (Array.isArray(value)) return '[Array(' + value.length + ')]';
      var shallow = Object.keys(value);
      return '{' + shallow.slice(0, 12).join(', ') + (shallow.length > 12 ? ', …' : '') + '}';
    }
    if (Array.isArray(value)) {
      var arr = [];
      var n = Math.min(value.length, 50);
      for (var i = 0; i < n; i++) {
        try { arr.push(prune(value[i], depth - 1)); } catch (e) { arr.push('[unserializable]'); }
      }
      if (value.length > 50) arr.push('…+' + (value.length - 50) + ' more');
      return arr;
    }
    var out = {};
    var keys = Object.keys(value);
    for (var j = 0; j < keys.length && j < 100; j++) {
      try { out[keys[j]] = prune(value[keys[j]], depth - 1); } catch (e2) { out[keys[j]] = '[unserializable]'; }
    }
    if (keys.length > 100) out['…'] = '+' + (keys.length - 100) + ' more keys';
    return out;
  }

  function wrapDispatch(name, store) {
    if (store.__rnDevtoolsWrapped) return;
    var original = store.dispatch;
    store.dispatch = function(action) {
      var before = null;
      try { before = store.getState(); } catch (e) {}
      var start = Date.now();
      var result = original.call(store, action);
      var duration = Date.now() - start;
      var changed = [];
      try {
        var after = store.getState();
        if (after && typeof after === 'object' && before && typeof before === 'object') {
          var keys = Object.keys(after);
          for (var i = 0; i < keys.length; i++) {
            if (after[keys[i]] !== before[keys[i]]) changed.push(keys[i]);
          }
        }
      } catch (e2) {}
      var a = action || {};
      agent.actions.push({
        id: 'agent-action-' + (++agent.actionCounter),
        actionType: a && a.type !== undefined ? String(a.type) : String(a),
        payload: a && a.payload,
        timestamp: Date.now(),
        duration: duration,
        changedKeys: changed,
        storeName: name
      });
      if (agent.actions.length > MAX_ACTIONS) agent.actions.shift();
      return result;
    };
    store.__rnDevtoolsWrapped = true;
  }

  agent.discover = function() {
    var hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    var report = { hasHook: !!hook, stores: [], queryClient: false, navigation: false, visited: 0 };
    if (!hook || typeof hook.getFiberRoots !== 'function') return report;

    var roots = [];
    var ids = [];
    if (hook.renderers && hook.renderers.forEach) {
      hook.renderers.forEach(function(_, id) { ids.push(id); });
    }
    for (var i = 0; i < ids.length; i++) {
      try { hook.getFiberRoots(ids[i]).forEach(function(r) { roots.push(r); }); } catch (e) {}
    }

    var found = [];
    var visited = 0;
    var stack = [];
    for (var j = 0; j < roots.length; j++) if (roots[j].current) stack.push(roots[j].current);
    while (stack.length && visited < 60000) {
      var f = stack.pop();
      visited++;
      var p = f.memoizedProps;
      if (p) {
        try {
          var candidate = null;
          if (isStore(p.store)) candidate = p.store;
          else if (p.value && isStore(p.value.store)) candidate = p.value.store;
          if (candidate && found.indexOf(candidate) === -1) found.push(candidate);

          if (!agent.queryClient && p.value && typeof p.value.getQueryCache === 'function') {
            agent.queryClient = p.value;
          }
          if (!agent.navigation && p.value &&
              typeof p.value.getRootState === 'function' &&
              typeof p.value.getCurrentRoute === 'function') {
            agent.navigation = p.value;
          }
        } catch (e2) {}
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }

    agent.stores = {};
    for (var k = 0; k < found.length; k++) {
      var name = found.length === 1 ? 'redux' : 'redux' + (k + 1);
      agent.stores[name] = found[k];
      wrapDispatch(name, found[k]);
    }

    report.stores = Object.keys(agent.stores);
    report.queryClient = !!agent.queryClient;
    report.navigation = !!agent.navigation;
    report.visited = visited;
    return report;
  };

  agent.summaryJson = function() {
    return JSON.stringify({
      stores: Object.keys(agent.stores),
      queryClient: !!agent.queryClient,
      navigation: !!agent.navigation,
      pendingActions: agent.actions.length
    });
  };

  agent.getStateJson = function(name, path, depth) {
    var names = Object.keys(agent.stores);
    if (names.length === 0) return JSON.stringify({ found: false, stores: [] });
    var target = name || names[0];
    var store = agent.stores[target];
    if (!store) return JSON.stringify({ found: false, stores: names });
    var state;
    try { state = store.getState(); } catch (e) {
      return JSON.stringify({ found: false, stores: names, error: String(e) });
    }
    if (path) {
      var parts = String(path).split('.');
      for (var i = 0; i < parts.length; i++) {
        if (state === null || state === undefined || typeof state !== 'object') {
          return JSON.stringify({ found: true, stores: names, store: target, path: path, missing: true });
        }
        state = state[parts[i]];
      }
    }
    return JSON.stringify({
      found: true,
      stores: names,
      store: target,
      path: path || null,
      data: prune(state, typeof depth === 'number' ? depth : 4)
    });
  };

  agent.dispatchJson = function(name, action) {
    var names = Object.keys(agent.stores);
    var target = name || names[0];
    var store = agent.stores[target];
    if (!store) return JSON.stringify({ ok: false, stores: names, error: 'store not found' });
    try {
      store.dispatch(action);
      return JSON.stringify({ ok: true, store: target });
    } catch (e) {
      return JSON.stringify({ ok: false, store: target, error: String(e) });
    }
  };

  agent.drainActionsJson = function() {
    var items = agent.actions.splice(0, agent.actions.length);
    for (var i = 0; i < items.length; i++) {
      try { items[i].payload = prune(items[i].payload, 2); } catch (e) { items[i].payload = '[unserializable]'; }
    }
    return JSON.stringify(items);
  };

  agent.getNavigationJson = function() {
    if (!agent.navigation) return JSON.stringify({ found: false });
    try {
      return JSON.stringify({
        found: true,
        currentRoute: prune(agent.navigation.getCurrentRoute(), 3),
        state: prune(agent.navigation.getRootState(), 5)
      });
    } catch (e) {
      return JSON.stringify({ found: false, error: String(e) });
    }
  };

  function storageModule() {
    var mod = null;
    try { if (typeof g.__turboModuleProxy === 'function') mod = g.__turboModuleProxy('RNCAsyncStorage'); } catch (e) {}
    if (!mod) { try { if (g.nativeModuleProxy) mod = g.nativeModuleProxy.RNCAsyncStorage; } catch (e2) {} }
    return mod;
  }

  agent.storageKick = function(id, op, key, value) {
    var mod = storageModule();
    var done = function(ok, val, err) {
      agent.results[id] = { done: true, ok: ok, value: val === undefined ? null : val, error: err || null };
    };
    if (!mod) { done(false, null, 'AsyncStorage native module not found'); return 'no-mod'; }
    try {
      if (op === 'keys') {
        mod.getAllKeys(function(err, keys) { done(!err, keys || [], err ? JSON.stringify(err) : null); });
      } else if (op === 'get') {
        mod.multiGet([key], function(err, pairs) {
          var v = pairs && pairs[0] ? pairs[0][1] : null;
          done(!err, v, err ? JSON.stringify(err) : null);
        });
      } else if (op === 'set') {
        mod.multiSet([[key, value]], function(err) { done(!err, null, err ? JSON.stringify(err) : null); });
      } else if (op === 'remove') {
        mod.multiRemove([key], function(err) { done(!err, null, err ? JSON.stringify(err) : null); });
      } else {
        done(false, null, 'unknown op: ' + op);
      }
    } catch (e) {
      done(false, null, String(e));
    }
    return 'kicked';
  };

  agent.readResultJson = function(id) {
    var r = agent.results[id];
    if (!r) return JSON.stringify({ done: false });
    if (r.done) delete agent.results[id];
    return JSON.stringify(r);
  };

  g.${AGENT_GLOBAL_KEY} = agent;
  return 'installed';
})()
`;
