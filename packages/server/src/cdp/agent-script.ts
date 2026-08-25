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
  // Reinstall over older agents so new capabilities (qa hit-testing) land on reconnect
  var old = g.${AGENT_GLOBAL_KEY};
  if (old && old.version >= 2) return 'already-installed';

  var MAX_ACTIONS = 500;

  // Inherit wrapped stores/actions by reference: the old dispatch wrappers keep
  // pushing into the same arrays, so nothing recorded is lost on reinstall.
  var agent = {
    version: 2,
    stores: (old && old.stores) || {},
    queryClient: (old && old.queryClient) || null,
    navigation: (old && old.navigation) || null,
    actions: (old && old.actions) || [],
    results: {},
    actionCounter: (old && old.actionCounter) || 0
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

  // ---- QA hit-testing (zero-config element inspection for the cockpit) ----

  agent.qaHierarchy = null;

  function flattenStyle(st) {
    if (!st) return null;
    if (Array.isArray(st)) {
      var out = {};
      for (var i = 0; i < st.length; i++) {
        var f = flattenStyle(st[i]);
        if (f) { for (var k in f) out[k] = f[k]; }
      }
      return out;
    }
    if (typeof st === 'object') return st;
    return null;
  }

  function firstHostInstance() {
    var hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook || typeof hook.getFiberRoots !== 'function') return null;
    var ids = [];
    if (hook.renderers && hook.renderers.forEach) hook.renderers.forEach(function(_, id) { ids.push(id); });
    for (var i = 0; i < ids.length; i++) {
      var roots = [];
      try { hook.getFiberRoots(ids[i]).forEach(function(r) { roots.push(r); }); } catch (e) {}
      for (var j = 0; j < roots.length; j++) {
        var f = roots[j].current;
        var guard = 0;
        while (f && guard++ < 200) {
          if (typeof f.type === 'string' && f.stateNode) {
            var sn = f.stateNode;
            if (sn.canonical) return sn.canonical.publicInstance || sn.canonical;
            return sn;
          }
          f = f.child;
        }
      }
    }
    return null;
  }

  function levelData(item) {
    var dummyFindNodeHandle = function() { return null; };
    return item.getInspectorData(dummyFindNodeHandle);
  }

  function serializeLevel(data) {
    var props = {};
    try {
      var raw = data.props || {};
      var keys = Object.keys(raw);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] !== 'children' && keys[i] !== 'style') props[keys[i]] = raw[keys[i]];
      }
    } catch (e) {}
    var style = null;
    try { style = flattenStyle(data.props && data.props.style); } catch (e2) {}
    return { props: prune(props, 2), style: prune(style, 2) };
  }

  agent.qaHitTestKick = function(id, x, y) {
    var done = function(ok, val, err) {
      agent.results[id] = { done: true, ok: ok, value: val === undefined ? null : val, error: err || null };
    };
    var hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook || !hook.renderers) { done(false, null, 'devtools hook not found'); return 'no-hook'; }
    var inspectedView = firstHostInstance();
    if (!inspectedView) { done(false, null, 'no host instance found (app not mounted?)'); return 'no-host'; }

    var renderers = [];
    hook.renderers.forEach(function(r) { renderers.push(r); });
    var handled = false;

    for (var i = 0; i < renderers.length && !handled; i++) {
      var inspect = renderers[i].rendererConfig && renderers[i].rendererConfig.getInspectorDataForViewAtPoint;
      if (!inspect) continue;
      try {
        inspect(inspectedView, x, y, function(viewData) {
          if (!viewData || !viewData.hierarchy || viewData.hierarchy.length === 0) return false;
          handled = true;
          agent.qaHierarchy = viewData.hierarchy;
          var names = [];
          for (var n = 0; n < viewData.hierarchy.length; n++) names.push(viewData.hierarchy[n].name || 'Unknown');
          var selectedIndex = viewData.selectedIndex != null ? viewData.selectedIndex : names.length - 1;
          var level = {};
          try { level = serializeLevel(levelData(viewData.hierarchy[selectedIndex])); } catch (e) {}
          done(true, {
            frame: viewData.frame,
            hierarchy: names,
            selectedIndex: selectedIndex,
            selectedName: names[selectedIndex],
            componentStack: String(viewData.componentStack || '').slice(0, 4000),
            props: level.props || {},
            style: level.style || null
          });
          return true;
        });
      } catch (e) {
        if (!handled) done(false, null, 'hit-test failed: ' + String(e));
        return 'error';
      }
    }
    if (!handled && !agent.results[id]) done(false, null, 'no renderer answered at that point');
    return 'kicked';
  };

  agent.qaMeasureLevelKick = function(id, index) {
    var done = function(ok, val, err) {
      agent.results[id] = { done: true, ok: ok, value: val === undefined ? null : val, error: err || null };
    };
    if (!agent.qaHierarchy || !agent.qaHierarchy[index]) { done(false, null, 'no hit-test in progress or bad index'); return 'no-hierarchy'; }
    try {
      var data = levelData(agent.qaHierarchy[index]);
      var level = serializeLevel(data);
      var finished = false;
      data.measure(function(mx, my, width, height, left, top) {
        finished = true;
        done(true, {
          frame: { top: top, left: left, width: width, height: height },
          name: agent.qaHierarchy[index].name || 'Unknown',
          props: level.props,
          style: level.style
        });
      });
      setTimeout(function() {
        if (!finished) done(true, { frame: null, name: agent.qaHierarchy[index].name || 'Unknown', props: level.props, style: level.style });
      }, 400);
    } catch (e) {
      done(false, null, String(e));
    }
    return 'kicked';
  };

  g.${AGENT_GLOBAL_KEY} = agent;
  return 'installed';
})()
`;
