/**
 * shots_tabs.js — 真实浏览器验证「标签栏换行」效果
 *
 * 为什么要单独跑：jsdom 不做布局，offsetWidth/getBoundingClientRect 全是 0，
 * 所以「12 个标签是不是真的都露出来了」只能在真浏览器里量。
 *
 * 输出：
 *   verify/screens/tabs_<宽度>.png   截图
 *   stdout                           每个宽度下的「行数 / 是否溢出 / 能否点全」
 *
 * 用法：
 *   cd work && node verify/shots_tabs.js
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9902;
const OUT = path.resolve(__dirname, 'screens');
const PROFILE = path.resolve(__dirname, 'tabprof');
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--disable-breakpad', '--disable-crash-reporter',
  '--disable-extensions', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });

const CASES = [
  { name: '390 手机', w: 390, h: 900, mobile: true },
  { name: '360 小屏手机', w: 360, h: 800, mobile: true },
  { name: '320 极窄屏', w: 320, h: 700, mobile: true },
  { name: '768 平板', w: 768, h: 900, mobile: false },
  { name: '1280 桌面', w: 1280, h: 900, mobile: false },
];

(async () => {
  for (let i = 0; i < 100; i++) {
    await sleep(250);
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch (e) {}
  }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails).slice(0, 200));
  };
  const send = (m, p) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable', {});
  await send('Page.enable', {});

  let allOk = true;
  for (const c of CASES) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: c.w, height: c.h, deviceScaleFactor: 2, mobile: c.mobile,
    });
    await send('Page.navigate', { url: FILE });
    await sleep(2200);

    /* 量布局：行数、是否被裁、每个标签是否完整落在容器内 */
    const m = await ev(`(() => {
      const box = document.getElementById('tabs');
      const tabs = [...box.querySelectorAll('.tab')];
      const bb = box.getBoundingClientRect();
      const rows = new Set();
      let clipped = 0;
      const rects = tabs.map(t => {
        const r = t.getBoundingClientRect();
        rows.add(Math.round(r.top));
        // 标签右边界超出容器可视宽度 = 被裁
        if (r.right > bb.right + 1 || r.left < bb.left - 1) clipped++;
        return { txt: t.textContent.replace(/\\d+$/,''), l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) };
      });
      const cs = getComputedStyle(box);
      return {
        count: tabs.length,
        rows: rows.size,
        rowTops: [...rows].sort((a,b)=>a-b),
        clipped,
        wrap: cs.flexWrap,
        overflowX: cs.overflowX,
        boxH: Math.round(bb.height),
        headerH: Math.round(document.querySelector('header').getBoundingClientRect().height),
        docScrollW: document.documentElement.scrollWidth,
        viewW: window.innerWidth,
        perRow: rects.reduce((acc, r) => { (acc[r.t] = acc[r.t] || []).push(r.txt); return acc; }, {}),
      };
    })()`);

    if (m && m.__err) { console.log(`\n${c.name}: 测量失败 ${m.__err}`); allOk = false; continue; }

    const noHScroll = m.docScrollW <= m.viewW + 1;
    const allRows = Object.keys(m.perRow).length;
    const ok = m.count === 12 && m.clipped === 0 && noHScroll && m.wrap === 'wrap';

    console.log(`\n【${c.name}】窗口 ${c.w}px`);
    console.log(`  标签数 ${m.count} · 占 ${m.rows} 行 · 容器高 ${m.boxH}px · 吸顶 header 总高 ${m.headerH}px`);
    console.log(`  每行：${Object.entries(m.perRow).map(([top, arr]) => '(' + arr.length + ') ' + arr.join('/')).join('  |  ')}`);
    console.log(`  flex-wrap=${m.wrap}  overflow-x=${m.overflowX}  被裁标签=${m.clipped}  横向溢出=${!noHScroll}`);
    console.log(`  ${ok ? '✅ 全部标签完整可见、无横向滚动' : '❌ 有问题'}`);
    if (!ok) allOk = false;

    await shot(`tabs_${c.w}.png`);
    console.log(`  截图 → verify/screens/tabs_${c.w}.png`);
  }

  console.log(`\nJS 异常：${errs.length ? errs.join(' | ') : '无'}`);
  console.log(allOk && !errs.length ? '\nALL LAYOUT CHECKS PASSED' : '\nLAYOUT CHECK FAILED');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
  process.exit(allOk && !errs.length ? 0 : 1);
})().catch(e => {
  console.error('FATAL', e.message);
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (x) {}
  process.exit(2);
});
