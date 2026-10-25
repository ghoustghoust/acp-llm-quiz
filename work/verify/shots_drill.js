/**
 * shots_drill.js — 真实 Chrome：三个专项练习页截图
 * 输出 verify/screens/drill_*.png
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9900;
const OUT = path.resolve(__dirname, 'screens');
const PROFILE = path.resolve(__dirname, 'drillprof');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-breakpad','--disable-crash-reporter','--disable-extensions',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });

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
  const shot = async n => {
    const r = await send('Page.captureScreenshot', { format:'png' });
    fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data,'base64'));
    console.log('   →', n);
  };

  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1000, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: FILE });
  await sleep(2200);

  // 造一批真实用过的数据
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.wrong = []; b.S.wcnt = {}; b.S.streak = {};
    const singles = b.QS.filter(x => x.type === '单选题');
    const multis  = b.QS.filter(x => x.type === '多选题');
    // 做题：单选 60 道（对 45 错 15），多选 20 道（对 12 错 8）
    let n = 0;
    singles.slice(0, 60).forEach((q, i) => {
      const ok = i % 4 !== 0;
      const cor = q.options.map((o,k)=>o.ok?k:-1).filter(k=>k>=0);
      b.S.ans[q.gid] = { sel: ok ? cor : [0], ok: ok, t: 4000 + i*100 };
      if (!ok) { b.S.wrong.push(q.gid); b.S.wcnt[q.gid] = 1 + (i % 3); b.S.streak[q.gid] = 0; }
      else { b.S.streak[q.gid] = 1 + (i % 3); if (b.S.streak[q.gid] >= 3) {
        const wi = b.S.wrong.indexOf(q.gid); if (wi>=0) b.S.wrong.splice(wi,1); } }
      n++;
    });
    multis.slice(0, 20).forEach((q, i) => {
      const ok = i % 3 !== 0;
      const cor = q.options.map((o,k)=>o.ok?k:-1).filter(k=>k>=0);
      b.S.ans[q.gid] = { sel: ok ? cor : [0], ok: ok, t: 6000 };
      if (!ok) { b.S.wrong.push(q.gid); b.S.wcnt[q.gid] = 2; b.S.streak[q.gid] = 0; }
      else { b.S.streak[q.gid] = 3; }
    });
    b.save(); b.render();
    return 1;
  })()`);
  await sleep(700);

  // 单选专项
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('单选专项')).click()`);
  await sleep(900);
  await shot('drill_1_single.png');

  // 多选专项
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('多选专项')).click()`);
  await sleep(900);
  await shot('drill_2_multi.png');

  // 错题攻坚
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('错题攻坚')).click()`);
  await sleep(900);
  await shot('drill_3_hard.png');

  // 攻坚页滚到下面看题卡
  await ev(`window.scrollTo(0, 520)`);
  await sleep(400);
  await shot('drill_4_hard_card.png');

  const info = await ev(`(() => {
    const b = window.__bank;
    return {
      single: b.drillStats('single'),
      multi: b.drillStats('multi'),
      hard: b.drillStats('hard'),
      hardPool: b.drillPool('hard').length
    };
  })()`);
  console.log('');
  console.log('统计:', JSON.stringify(info, null, 1));

  console.log('errors:', errs.length ? errs : 'none');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio:'ignore' }); } catch(e) {}
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio:'ignore' }); } catch (x) {} process.exit(1); });
