#!/usr/bin/env node
/**
 * Integration tests for Hocus Focus.
 *
 * Loads the real unpacked extension into a headless Chromium browser and drives
 * it over the DevTools protocol — the service worker, the popup and the pages
 * are the actual ones users run, not mocks.
 *
 *   npm test
 *
 * Requires Node 20+ (for the global WebSocket) and a Chromium-based browser.
 *
 * NOTE ON BROWSERS: Chrome 137+ ignores the --load-extension switch, so these
 * tests look for Microsoft Edge, Chromium or Chrome for Testing first. If only
 * stock Chrome is installed the suite will skip rather than report a false pass.
 */

'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT_DIR = path.resolve(__dirname, '..');

// Chosen at startup rather than hard-coded, so a browser left behind by an
// earlier run can't be mistaken for this one's.
let CDP_PORT = 0;
let SITE_PORT = 0;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Browsers that still honour --load-extension, most-preferred first.
const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

// ---------------------------------------------------------------- assertions

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`);
  }
}

function checkThat(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`);
  }
}

// ---------------------------------------------------------------- CDP client

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: CDP_PORT, path: pathname }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(body); } });
    }).on('error', reject);
  });
}

async function waitFor(fn, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fn(); if (r) return r; } catch (e) { /* keep polling */ }
    await sleep(400);
  }
  return null;
}

class Session {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label;
    this.nextId = 0;
    this.pending = new Map();
    this.errors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = () => reject(new Error(`could not attach to ${this.label}`));
      this.ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        } else if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails;
          this.errors.push(`${this.label}: ${(d.exception && d.exception.description || d.text || '').split('\n')[0]}`);
        } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
          this.errors.push(`${this.label}: ${msg.params.entry.text}`);
        }
      };
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise(resolve => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async enable() {
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    return this;
  }

  // Evaluate in the target and return the value. Promises are awaited.
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    const details = r.result && r.result.exceptionDetails;
    if (details) {
      throw new Error(`${this.label} eval threw: ${(details.exception && details.exception.description || details.text || '').split('\n')[0]}`);
    }
    return r.result && r.result.result && r.result.result.value;
  }
}

function openTarget(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: CDP_PORT, path: '/json/new?' + encodeURIComponent(url), method: 'PUT' },
      res => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', reject);
    req.end();
  });
}

async function attachToPage(urlFragment, label) {
  const targets = await getJSON('/json/list');
  const matches = targets.filter(t => t.type === 'page' && t.url.includes(urlFragment));
  if (!matches.length) return null;
  const session = new Session(matches[matches.length - 1].webSocketDebuggerUrl, label);
  await session.connect();
  return session.enable();
}

async function openPage(url, urlFragment, label) {
  await openTarget(url);
  await sleep(2000);
  return attachToPage(urlFragment, label);
}

// ---------------------------------------------------------------- the suite

async function run() {
  const browser = BROWSER_CANDIDATES.find(p => fs.existsSync(p));
  if (!browser) {
    console.log('SKIP: no browser found that supports --load-extension.');
    console.log('      Install Microsoft Edge or Chromium and re-run.');
    console.log('      (Chrome 137+ ignores --load-extension, so it cannot be used.)');
    return 0;
  }
  CDP_PORT = await freePort();
  SITE_PORT = await freePort();
  console.log(`Browser: ${browser}\nExtension: ${EXT_DIR}\n`);

  // A local site so the tests never depend on the network.
  const site = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><head><title>${req.url}</title></head><body><h1>${req.url}</h1></body></html>`);
  });
  await new Promise(r => site.listen(SITE_PORT, '127.0.0.1', r));

  const profile = path.join(os.tmpdir(), 'hocus-focus-test-' + Date.now());
  const proc = spawn(browser, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--host-resolver-rules=MAP focus.test 127.0.0.1, MAP distract.test 127.0.0.1'
  ], { stdio: 'ignore' });

  // Browsers spawn a tree of helper processes; killing just the launcher leaves
  // the DevTools endpoint alive and the next run would attach to a stale browser.
  let stopped = false;
  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        proc.kill('SIGKILL');
      }
    } catch (e) { /* already gone */ }
    site.close();
  };
  process.on('exit', shutdown);
  process.on('SIGINT', () => { shutdown(); process.exit(130); });

  try {
    await waitFor(() => getJSON('/json/version'));
    await sleep(4000);

    const swTarget = await waitFor(async () => {
      const targets = await getJSON('/json/list');
      return targets.find(t => t.type === 'service_worker' && /\/background\.js$/.test(t.url));
    });

    console.log('service worker');
    checkThat('registers and stays alive', !!swTarget, 'no background.js service worker target appeared');
    if (!swTarget) return 1;

    const extId = new URL(swTarget.url).hostname;
    const sw = await new Session(swTarget.webSocketDebuggerUrl, 'sw').connect().then(s => s.enable());
    check('firebase global is present', await sw.eval(`typeof firebase`), 'object');

    const reset = (extra = '{}') =>
      sw.eval(`new Promise(r=>chrome.storage.local.clear(()=>chrome.storage.local.set(Object.assign({studyDomains:['focus.test']},${extra}),()=>r(1))))`);

    // ---- alarms ------------------------------------------------------------
    console.log('\nalarms');
    const alarms = JSON.parse(await sw.eval(`new Promise(r=>chrome.alarms.getAll(a=>r(JSON.stringify(a))))`));
    const named = n => alarms.find(a => a.name === n);
    checkThat('flushStats scheduled', !!named('flushStats'));
    checkThat('dailySummary scheduled', !!named('dailySummary'));
    checkThat('weeklySummary scheduled', !!named('weeklySummary'), 'the weekly summary never fires without this alarm');
    check('keepAlive uses a period Chrome accepts', named('keepAlive') ? named('keepAlive').periodInMinutes >= 0.5 : true, true);

    // ---- tracking survives a service worker teardown -----------------------
    // MV3 tears the worker down every ~30s. Clearing the in-memory variables
    // reproduces exactly what the next wake-up sees.
    console.log('\ntime tracking across worker restarts');
    const tearDown = () => sw.eval(
      `activeTabId=null;activeStartTime=null;activeDomain=null;activeUrl=null;activeTitle=null;` +
      `if(badgeTimerInterval){clearInterval(badgeTimerInterval);badgeTimerInterval=null;}'torn down'`
    );
    const todaysStats = async () => {
      const key = await sw.eval(`localDateStr()`);
      const raw = await sw.eval(`new Promise(r=>chrome.storage.local.get({dailyStats:{}},d=>r(JSON.stringify(d.dailyStats['${key}']||{}))))`);
      return JSON.parse(raw);
    };

    await reset();
    await sw.eval(`startTracking(1,'http://focus.test:${SITE_PORT}/a','A')`);
    await sleep(6000);
    await tearDown();
    await sw.eval(`startTracking(2,'http://distract.test:${SITE_PORT}/b','B')`);
    await sleep(2500);
    let stats = await todaysStats();
    checkThat('time is kept when the user navigates away while the worker is asleep',
      stats['focus.test'] >= 4, `focus.test recorded ${stats['focus.test']}s, expected ~6s`);

    await reset();
    await sw.eval(`startTracking(1,'http://focus.test:${SITE_PORT}/c','C')`);
    await sleep(6000);
    await tearDown();
    await sw.eval(`stopTracking()`);
    await sleep(2000);
    stats = await todaysStats();
    checkThat('time is kept when tracking stops after a restart',
      stats['focus.test'] >= 4, `focus.test recorded ${stats['focus.test']}s, expected ~6s`);

    await reset();
    await sw.eval(`startTracking(1,'http://focus.test:${SITE_PORT}/d','D')`);
    await sleep(5000);
    await tearDown();
    await sw.eval(`startTracking(1,'http://focus.test:${SITE_PORT}/d','D')`); // same URL -> resume
    await sleep(1500);
    await sw.eval(`stopTracking()`);
    await sleep(2000);
    stats = await todaysStats();
    checkThat('resuming the same page does not double-count',
      stats['focus.test'] < 12, `focus.test recorded ${stats['focus.test']}s, expected ~7s`);

    // ---- badge does not hammer storage -------------------------------------
    console.log('\nbadge');
    await reset();
    await sw.eval(`startTracking(1,'http://focus.test:${SITE_PORT}/e','E')`);
    await sleep(2500);
    // Idempotent: counts only the settings read updateBadge performs, and can be
    // re-applied without leaving a stray top-level binding behind.
    await sw.eval(`(function(){
      if(!globalThis.__readsPatched){
        globalThis.__readsPatched=true;
        globalThis.__origGet=chrome.storage.local.get.bind(chrome.storage.local);
        chrome.storage.local.get=function(k,cb){
          if(k&&k.studyDomains!==undefined&&k.dailyStats!==undefined)globalThis.__reads++;
          return globalThis.__origGet(k,cb);
        };
      }
      globalThis.__reads=0;
      return 'patched';
    })()`);
    await sleep(4000);
    const reads = await sw.eval(`__reads`);
    checkThat('settings are cached rather than re-read every tick', reads === 0,
      `${reads} storage reads during 4s of badge ticks, expected 0`);
    await sw.eval(`new Promise(r=>chrome.storage.local.set({allowances:{'z.test':{limitSeconds:60}}},()=>r(1)))`);
    await sleep(2000);
    checkThat('cache refreshes after settings change', (await sw.eval(`__reads`)) >= 1);
    await sw.eval(`stopTracking()`);

    // ---- the nudge overlay -------------------------------------------------
    console.log('\ndistraction nudge');
    await reset();
    const page = await openPage(`http://distract.test:${SITE_PORT}/fun`, 'distract.test', 'page');
    await sleep(4500);
    checkThat('overlay is injected on a distraction site',
      page && await page.eval(`!!document.getElementById('hocus-focus-nudge-container')`));

    // ---- popup -------------------------------------------------------------
    console.log('\npopup');
    const popup = await openPage(`chrome-extension://${extId}/popup/popup.html`, 'popup/popup.html', 'popup');
    await sleep(2500);
    checkThat('focus domains render', (await popup.eval(`document.getElementById('domainList').innerText`)).includes('focus.test'));

    await popup.eval(`document.getElementById('emailNotifInput').value='nope';document.getElementById('saveEmailBtn').click()`);
    await sleep(700);
    check('rejects a malformed email', await popup.eval(`document.getElementById('emailNotifStatus').textContent`), 'Invalid email address.');

    await popup.eval(`document.getElementById('emailNotifInput').value='Reader@Example.com';document.getElementById('saveEmailBtn').click()`);
    await sleep(900);
    check('saves a valid email, lowercased',
      await popup.eval(`new Promise(r=>chrome.storage.local.get({emailNotifAddress:''},d=>r(d.emailNotifAddress)))`),
      'reader@example.com');
    check('shows the saved-address panel',
      await popup.eval(`getComputedStyle(document.getElementById('emailNotifActive')).display`), 'block');

    await popup.eval(`document.getElementById('taskInput').value='ship it';document.getElementById('addTaskBtn').click()`);
    await sleep(900);
    check('adds exactly one task per click', await popup.eval(`document.querySelectorAll('#taskList .task-item').length`), 1);

    await popup.eval(`document.getElementById('allowanceDomainInput').value='<b>x</b>.test';
                      document.getElementById('allowanceMinutes').value='20';
                      document.getElementById('addAllowanceBtn').click()`);
    await sleep(1000);
    check('allowance domains are not treated as markup',
      await popup.eval(`document.querySelectorAll('#allowanceList .allowance-item-domain b').length`), 0);

    // ---- the new tab and the dashboard must agree --------------------------
    console.log('\nreporting');
    const dayKey = await sw.eval(`localDateStr()`);
    await sw.eval(`new Promise(r=>chrome.storage.local.set({dailyStats:{'${dayKey}':{'focus.test':3600,'distract.test':1800}},studyDomains:['focus.test'],allowances:{},tempFocusLog:{},tempFocusPasses:{}},()=>r(1)))`);
    await sleep(800);

    const newtab = await openPage(`chrome-extension://${extId}/newtab.html`, 'newtab.html', 'newtab');
    await sleep(2000);
    const dash = await openPage(`chrome-extension://${extId}/analysis/analysis.html`, 'analysis/analysis.html', 'dashboard');
    await sleep(4000);

    const newtabScore = await newtab.eval(`document.getElementById('scoreValue').textContent`);
    const dashScore = await dash.eval(`document.getElementById('focusScore').textContent`);
    check('new tab focus score', newtabScore, '67');
    check('dashboard agrees with the new tab', dashScore, newtabScore);
    check('dashboard deep-work total', await dash.eval(`document.getElementById('totalFocusTime').textContent`), '1h 0m');
    checkThat('usage chart renders', await dash.eval(`!!document.querySelector('#usageChart .apexcharts-canvas')`));

    // ---- weekly summary ----------------------------------------------------
    console.log('\nweekly summary');
    await sw.eval(`(function(){const stats={};const mk=(off,f,d)=>{const x=new Date();x.setDate(x.getDate()-off);
      stats[localDateStr(x)]={'focus.test':f,'distract.test':d};};
      for(let i=0;i<7;i++)mk(i,3600,600); for(let i=7;i<14;i++)mk(i,1800,600);
      return new Promise(r=>chrome.storage.local.set({dailyStats:stats,studyDomains:['focus.test'],lastWeeklySummaryDate:''},()=>r(1)));})()`);
    await sw.eval(`globalThis.__notif=null;chrome.notifications.create=function(id,o){__notif=o||id;return Promise.resolve('x');};
                   Date.prototype.getDay=function(){return 0;};'stubbed'`);
    await sw.eval(`sendWeeklySummary()`);
    await sleep(1500);
    const notif = JSON.parse((await sw.eval(`JSON.stringify(__notif)`)) || 'null');
    checkThat('fires a summary notification', !!notif && /Weekly Focus Summary/.test(notif.title));
    checkThat('reports the week-over-week change', !!notif && /up 100%/.test(notif.message),
      notif ? `message was: ${notif.message}` : 'no notification');
    await sw.eval(`__notif=null;sendWeeklySummary()`);
    await sleep(1200);
    check('does not fire twice in one day', await sw.eval(`__notif`), null);

    // ---- nothing threw -----------------------------------------------------
    console.log('\nconsole');
    const allErrors = [sw, page, popup, newtab, dash].filter(Boolean).flatMap(s => s.errors);
    checkThat('no uncaught exceptions or console errors', allErrors.length === 0, allErrors.join('\n       '));
  } finally {
    shutdown();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailed:\n  - ' + failures.join('\n  - '));
    return 1;
  }
  return 0;
}

run().then(code => process.exit(code)).catch(err => {
  console.error('\nTest run crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
