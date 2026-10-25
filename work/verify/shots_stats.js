/**
 * shots_stats.js — 截图新增的「统计」和「错题排行」页
 */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9533;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-breakpad','--disable-crash-reporter','--disable-extensions',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=D:/program/题库/work/verify/statsprof','about:blank'], { stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch (e) {} }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails).slice(0,200));
  };
  const send = (m, p) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  const shot = async (n, full) => {
    const r = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport: !!full });
    fs.writeFileSync(n, Buffer.from(r.result.data,'base64'));
    console.log('  ', n);
  };

  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1000, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: FILE });
  await sleep(2000);

  /* 制造一批真实数据：答一些题，其中几道故意答错多次 */
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.wrong = []; b.S.wcnt = {}; b.S.wlast = {};
    const t0 = Date.now();
    // 前 60 题：模拟不同作答表现
    for (let i = 0; i < 60; i++) {
      const q = b.QS[i];
      const ok = i % 3 !== 0;                       // 每 3 题错 1 题
      b.S.ans[q.gid] = { sel: [0], ok: ok, t: 1200 + (i % 7) * 900 };
      if (!ok) {
        b.S.wrong.push(q.gid);
        b.S.wcnt[q.gid] = 1;
        b.S.wlast[q.gid] = t0 - i * 60000;
      }
    }
    // 造几道反复错的题，让排行有层次
    const hot = [7, 19, 31, 2, 44];
    const times = [9, 7, 5, 4, 3];
    hot.forEach((idx, k) => {
      const gid = b.QS[idx].gid;
      b.S.wcnt[gid] = times[k];
      b.S.wlast[gid] = t0 - k * 3600000;
      b.S.ans[gid] = { sel: [0], ok: false, t: 6000 + k * 1000 };
      if (b.S.wrong.indexOf(gid) < 0) b.S.wrong.push(gid);
    });
    b.S.stats.dayMs = 1000 * 60 * 43;
    b.S.stats.totalMs = 1000 * 60 * 60 * 3.2;
    b.save(); b.render();
    return 1;
  })()`);
  await sleep(600);

  /* 统计页 — 按题型 */
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('统计')).click()`);
  await sleep(700);
  await shot('stats_1_by_type.png', true);

  /* 统计页 — 按难度 */
  await ev(`[...document.querySelectorAll('.seg button')].find(b=>b.textContent==='按难度').click()`);
  await sleep(700);
  await shot('stats_2_by_difficulty.png', true);

  /* 错题排行 */
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('错题排行')).click()`);
  await sleep(800);
  await shot('stats_3_rank.png', true);

  /* 排行页「全部」展开 */
  await ev(`[...document.querySelectorAll('.seg button')].find(b=>b.textContent==='全部').click()`);
  await sleep(700);
  await shot('stats_4_rank_all.png', true);

  /* 桌面端排行 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2000);
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.wrong = []; b.S.wcnt = {}; b.S.wlast = {};
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const q = b.QS[i];
      const ok = i % 3 !== 0;
      b.S.ans[q.gid] = { sel: [0], ok: ok, t: 1200 + (i % 7) * 900 };
      if (!ok) { b.S.wrong.push(q.gid); b.S.wcnt[q.gid] = 1; b.S.wlast[q.gid] = t0 - i * 60000; }
    }
    [[7,9],[19,7],[31,5],[2,4],[44,3]].forEach(([idx, n]) => {
      const gid = b.QS[idx].gid;
      b.S.wcnt[gid] = n; b.S.wlast[gid] = t0 - idx * 60000;
    });
    b.S.stats.totalMs = 1000*60*60*3.2;
    b.save(); b.render(); return 1;
  })()`);
  await sleep(700);
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('统计')).click()`);
  await sleep(700);
  await shot('stats_5_desktop_type.png');

  console.log('errors:', errs.length ? errs : 'none');
  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
