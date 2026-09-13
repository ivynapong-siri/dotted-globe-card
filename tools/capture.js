/**
 * Drive the page over CDP and capture frames of a real interaction.
 *
 * Chrome's --screenshot flag takes one picture per process launch, which is
 * no use for an animation. The devtools protocol lets one browser stay open
 * while we click things and photograph the result, which is the only way to
 * film an interaction rather than a pose.
 *
 * Capture cadence is not constant — captureScreenshot costs whatever the
 * frame costs to render, and eighteen thousand dots in software is not
 * nothing. So every frame's wall-clock time is recorded and written into an
 * ffmpeg concat list as a per-frame duration. The GIF then plays back at the
 * speed the interaction actually happened, rather than at whatever average
 * the capture loop managed.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* CHROME=/path/to/chrome overrides; the defaults cover the usual places on
   each platform, because a hard-coded path to one person's machine is no use
   to anyone who clones this */
const CHROME =
  process.env.CHROME ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(function (p) {
    return fs.existsSync(p);
  });
const PORT = 9333;
const [, , URL, OUT, WS, HS] = process.argv;
const W = +(WS || 1000);
const H = +(HS || 525);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* what happens, in milliseconds from the first frame */
const SCRIPT = [
  { at: 2300, do: 'click', country: 'Brazil' },
  { at: 4100, do: 'click', country: 'Argentina' },
  { at: 5700, do: 'click', country: 'Peru' },
  { at: 10500, do: 'stop' },   /* hold on the finished comparison — it loops */
];

const CLICK = (name) => `
  (function () {
    var r = [].slice.call(document.querySelectorAll('.country-row'))
      .find(function (x) { return x.textContent.trim().indexOf(${JSON.stringify(name)}) === 0; });
    if (r) r.click();
    return !!r;
  })()`;

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--mute-audio',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      `--window-size=${W},${H}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let list = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      list = await r.json();
      if (list.some((t) => t.type === 'page')) break;
    } catch (e) {
      /* not up yet */
    }
    await sleep(250);
  }
  const page = list && list.find((t) => t.type === 'page');
  if (!page) {
    chrome.kill();
    throw new Error('no debuggable page — chrome did not come up');
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) events.push(msg.method);
  };
  const send = (method, params) =>
    new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params: params || {} }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  /* a real phone-sized DPR would quadruple the cost per frame for a GIF that
     gets scaled down anyway */
  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send('Page.navigate', { url: URL });
  /* the entrance is part of the show, so capture starts at load, not after */
  for (let i = 0; i < 60 && !events.includes('Page.loadEventFired'); i++) await sleep(100);

  const t0 = Date.now();
  const frames = [];
  let step = 0;
  for (;;) {
    const now = Date.now() - t0;
    while (step < SCRIPT.length && SCRIPT[step].at <= now) {
      const s = SCRIPT[step++];
      if (s.do === 'stop') {
        step = SCRIPT.length + 1;
        break;
      }
      await send('Runtime.evaluate', { expression: CLICK(s.country), returnByValue: true });
    }
    if (step > SCRIPT.length) break;

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, 'f' + String(frames.length).padStart(4, '0') + '.png');
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    frames.push({ file: f, t: Date.now() - t0 });
  }

  /* per-frame durations, so playback matches what actually happened */
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + 80;
    lines.push("file '" + path.basename(frames[i].file) + "'");
    lines.push('duration ' + ((next - frames[i].t) / 1000).toFixed(4));
  }
  /* concat drops the last entry's duration unless the file is repeated */
  lines.push("file '" + path.basename(frames[frames.length - 1].file) + "'");
  fs.writeFileSync(path.join(OUT, 'list.txt'), lines.join('\n') + '\n');

  const span = frames[frames.length - 1].t;
  console.log(
    JSON.stringify({
      frames: frames.length,
      seconds: (span / 1000).toFixed(2),
      fps: (frames.length / (span / 1000)).toFixed(1),
      size: W + 'x' + H,
    }),
  );

  ws.close();
  chrome.kill();
  await sleep(400);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
