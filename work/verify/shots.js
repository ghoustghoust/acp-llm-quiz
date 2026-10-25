/**
 * shots.js — 用真实 Chrome 截图，检查版面实际观感
 */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9477;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-breakpad', '--disable-crash-reporter', '--disable-extensions',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=D:/program/题库/work/verify/shotprof',
  'about:blank',
], { stdio: 'ignore' });

(async () => {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) { ready = true; break; } } catch (e) {}
  }
  if (!ready) throw new Error('chrome not ready');

  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails).slice(0, 200));
  };
  const send = (method, params) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  const shot = async (name, full) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full });
    fs.writeFileSync(name, Buffer.from(r.result.data, 'base64'));
    console.log('  ', name);
  };

  await send('Runtime.enable', {});
  await send('Page.enable', {});

  /* ---- 手机 390x844 ---- */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: FILE });
  await sleep(2000);
  await ev(`localStorage.clear()`);
  await send('Page.navigate', { url: FILE });
  await sleep(2200);
  await shot('shot_a_mobile_unanswered.png');

  // 等几秒让计时走动，然后答错一题看解析
  await sleep(3200);
  await ev(`(()=>{const b=window.__bank;const q=b.QS[0];const i=q.options.findIndex(o=>!o.ok);document.querySelectorAll('.opt')[i].click();return 1})()`);
  await sleep(800);
  await shot('shot_b_mobile_answered.png', true);

  /* ---- 桌面 1280 ---- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev(`localStorage.clear()`);
  await send('Page.navigate', { url: FILE });
  await sleep(2200);
  await sleep(2500);
  await ev(`(()=>{const b=window.__bank;const q=b.QS[0];const i=q.options.findIndex(o=>o.ok);document.querySelectorAll('.opt')[i].click();return 1})()`);
  await sleep(700);
  await shot('shot_c_desktop_answered.png');

  /* ---- 考试设置页 ---- */
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('模拟')).click()`);
  await sleep(700);
  await shot('shot_d_exam_setup.png');

  /* ---- 考试中（限时） ---- */
  await ev(`(()=>{const chips=[...document.querySelectorAll('.chip')];const c=chips.find(x=>x.textContent.trim()==='限时 60 秒/题');c.click();return 1})()`);
  await sleep(500);
  await ev(`[...document.querySelectorAll('.btn.primary')].find(b=>b.textContent.includes('开始考试')).click()`);
  await sleep(3200);
  await shot('shot_e_exam_running.png');

  /* ---- 成绩单 ---- */
  await ev(`(()=>{const E=window.__bank.S.exam;E.msAcc=E.limitMs+2000;return 1})()`);
  await sleep(1600);
  await shot('shot_f_exam_result.png', true);

  console.log('errors:', errs.length ? errs : 'none');
  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
