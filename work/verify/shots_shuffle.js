const fs = require('fs');
const { spawn, execSync } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9700;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-breakpad','--disable-crash-reporter','--disable-extensions',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=D:/program/题库/work/verify/shufprof','about:blank'], { stdio: 'ignore' });

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

  // 找一道选项比较长、会被明显打乱的题
  await ev(`(() => {
    const b = window.__bank;
    b.S.mode = 'random';
    b.S.shuffleOpt = true;
    b.S.pos.random = 0;
    // 修正 order
    b.S.order = b.QS.map(x => x.gid);
    b.save(); b.render();
    return 1;
  })()`);
  await sleep(800);
  await shot('shuffle_1_random_with_toggle.png');

  // 找一道确实被打乱、且解析里引用字母的题
  const picked = await ev(`(async () => {
    const b = window.__bank;
    for (let i = 0; i < b.QS.length; i++) {
      const q = b.QS[i];
      if (!b.canShuffleOptions(q)) continue;
      const v = b.optionView(q);
      const isIdentity = v.order.every((x,k)=>x===k);
      if (isIdentity) continue;
      if (!/选项\\s*[A-F]|[A-F]\\s*对|[A-F]\\s*错/.test(q.analysis || '')) continue;
      b.S.pos.random = i;
      b.save(); b.render();
      return { i, gid: q.gid, order: v.order, q: q.q.slice(0, 40) };
    }
    return null;
  })()`, true);
  await sleep(900);
  console.log('  选中题目:', JSON.stringify(picked));

  // 点正确选项
  const clickInfo = await ev(`(() => {
    const b = window.__bank;
    const list = b.S.order.map(g => b.BY[g]).filter(Boolean);
    const q = list[b.S.pos.random];
    const v = b.optionView(q);
    const cOrig = q.options.findIndex(o => o.ok);
    const dPos = v.order.indexOf(cOrig);
    document.querySelectorAll('.opt')[dPos].click();
    return { dPos, cOrig, order: v.order };
  })()`);
  await sleep(900);
  console.log('  点击信息:', JSON.stringify(clickInfo));
  await shot('shuffle_2_answered_shuffled.png', true);

  // 对照：顺序模式同一道题
  await ev(`(() => {
    const b = window.__bank;
    const gid = '${'PLACEHOLDER'}';
    b.S.mode = 'seq';
    b.S.shuffleOpt = false;
    b.save(); b.render();
    return 1;
  })()`);
  await sleep(600);

  // 切到随机页看开关
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('随机')).click()`);
  await sleep(700);
  await shot('shuffle_3_toggle.png');

  console.log('errors:', errs.length ? errs : 'none');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio:'ignore' }); } catch(e) {}
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio:'ignore' }); } catch (x) {} process.exit(1); });
