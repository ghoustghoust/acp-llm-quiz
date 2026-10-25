const fs = require('fs');
const { spawn, execSync } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9850;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-breakpad','--disable-crash-reporter','--disable-extensions',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=D:/program/题库/work/verify/rdprof','about:blank'], { stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch (e) {} }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  const shot = async (n) => {
    const r = await send('Page.captureScreenshot', { format:'png' });
    fs.writeFileSync(n, Buffer.from(r.result.data,'base64'));
    console.log('  ', n);
  };

  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 950, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: FILE });
  await sleep(2200);

  // 清空到第 1 轮
  await ev(`(() => { const b = window.__bank; b.S.optRound = 0; b.S.mode='seq'; b.S.pos.seq=0; b.save(); b.render(); return 1; })()`);
  await sleep(700);

  const round1 = await ev(`(() => {
    const b = window.__bank;
    return {
      round: b.S.optRound + 1,
      opts: [...document.querySelectorAll('.opt')].map(o => o.querySelector('.v').textContent.trim().slice(0,14)),
      q: document.querySelector('.qtext').textContent.slice(0, 30)
    };
  })()`);
  console.log('第 1 轮:', JSON.stringify(round1, null, 1));
  await shot('round_1.png');

  // 重置
  await ev(`(() => { window.confirm = () => true; document.getElementById('btReset').click(); return 1; })()`);
  await sleep(900);

  const round2 = await ev(`(() => {
    const b = window.__bank;
    return {
      round: b.S.optRound + 1,
      opts: [...document.querySelectorAll('.opt')].map(o => o.querySelector('.v').textContent.trim().slice(0,14)),
      q: document.querySelector('.qtext').textContent.slice(0, 30)
    };
  })()`);
  console.log('第 2 轮:', JSON.stringify(round2, null, 1));
  await shot('round_2.png');

  // 再重置两次
  await ev(`document.getElementById('btReset').click()`);
  await sleep(800);
  const round3 = await ev(`(() => ({
    round: window.__bank.S.optRound + 1,
    opts: [...document.querySelectorAll('.opt')].map(o => o.querySelector('.v').textContent.trim().slice(0,14))
  }))()`);
  console.log('第 3 轮:', JSON.stringify(round3));

  await ev(`document.getElementById('btReset').click()`);
  await sleep(800);
  const round4 = await ev(`(() => ({
    round: window.__bank.S.optRound + 1,
    opts: [...document.querySelectorAll('.opt')].map(o => o.querySelector('.v').textContent.trim().slice(0,14))
  }))()`);
  console.log('第 4 轮:', JSON.stringify(round4));

  console.log('');
  console.log('=== 各轮排列（同一道题） ===');
  const sigs = [round1.opts, round2.opts, round3.opts, round4.opts].map(a => JSON.stringify(a));
  [round1, round2, round3, round4].forEach((r, i) => {
    console.log(`第 ${i+1} 轮: ${JSON.stringify(r.opts)}`);
  });
  const uniq = new Set(sigs);
  console.log('');
  console.log(`不同排列数量: ${uniq.size} / 4`);

  await shot('round_4.png');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio:'ignore' }); } catch(e) {}
  process.exit(uniq.size === 4 ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio:'ignore' }); } catch (x) {} process.exit(1); });
