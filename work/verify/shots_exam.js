const fs = require('fs');
const { spawn, execSync } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9800;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-breakpad','--disable-crash-reporter','--disable-extensions',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=D:/program/题库/work/verify/etprof','about:blank'], { stdio: 'ignore' });

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
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1100, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: FILE });
  await sleep(2200);

  // 造几天数据
  await ev(`(() => {
    const b = window.__bank;
    const dk = b.dailyKey;
    const t = new Date();
    const key = off => { const d = new Date(t.getFullYear(), t.getMonth(), t.getDate()-off);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    b.S.daily = {};
    b.S.daily[key(6)] = { ans: 18, right: 12, ms: 600000, examN: 0 };
    b.S.daily[key(5)] = { ans: 25, right: 18, ms: 700000, examN: 0 };
    b.S.daily[key(4)] = { ans: 0,  right: 0,  ms: 0, examN: 0 };
    b.S.daily[key(3)] = { ans: 30, right: 24, ms: 900000, examN: 1 };
    b.S.daily[key(2)] = { ans: 20, right: 17, ms: 500000, examN: 0 };
    b.S.daily[key(1)] = { ans: 35, right: 31, ms: 1100000, examN: 0 };
    b.S.daily[key(0)] = { ans: 28, right: 26, ms: 800000, examN: 0 };
    b.S.examHistory = [
      { at: Date.now()-6*86400000, score: 62, full: 100, passScore: 80, rate: 62, pass: false, ms: 5000000 },
      { at: Date.now()-4*86400000, score: 71, full: 100, passScore: 80, rate: 71, pass: false, ms: 4600000 },
      { at: Date.now()-2*86400000, score: 84, full: 100, passScore: 80, rate: 84, pass: true, ms: 4200000 },
      { at: Date.now()-1*86400000, score: 91, full: 100, passScore: 80, rate: 91, pass: true, ms: 3900000 }
    ];
    b.save(); b.render();
    return 1;
  })()`);
  await sleep(600);

  // 成绩走势页
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('成绩走势')).click()`);
  await sleep(900);
  await shot('exam_1_trend_top.png');
  await shot('exam_2_trend_full.png', true);

  // 模拟考试设置页
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('模拟考试')).click()`);
  await sleep(700);
  await shot('exam_3_setup.png');

  // 开考
  await ev(`[...document.querySelectorAll('.btn.primary')].find(b=>b.textContent.includes('开始考试')).click()`);
  await sleep(1000);
  await shot('exam_4_running.png');

  // 答几题后交卷，看成绩单
  await ev(`(() => {
    const b = window.__bank;
    const E = b.S.exam;
    E.gids.forEach((g, i) => {
      const q = b.BY[g];
      const cor = q.options.map((o,k)=>o.ok?k:-1).filter(k=>k>=0);
      if (i < 60) {
        E.ans[g] = cor;
      } else {
        const wrong = q.options.map((o,k)=>o.ok?-1:k).filter(k=>k>=0);
        E.ans[g] = wrong.length ? [wrong[0]] : cor;
      }
    });
    E.qMs = {}; E.gids.forEach((g,i) => E.qMs[g] = 60000 + i*500);
    E.msAcc = 68 * 60 * 1000;
    b.save();
    return 1;
  })()`);
  await sleep(400);
  await ev(`(() => { const btn=[...document.querySelectorAll('.btn')].find(b=>b.textContent==='交卷'); if(btn) btn.click(); return 1; })()`);
  await sleep(1200);
  await shot('exam_5_score.png');
  await shot('exam_6_score_full.png', true);

  console.log('errors:', errs.length ? errs : 'none');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio:'ignore' }); } catch(e) {}
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio:'ignore' }); } catch (x) {} process.exit(1); });
