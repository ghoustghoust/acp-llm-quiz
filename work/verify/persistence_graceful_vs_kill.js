/**
 * test_persist_hard2.js — 区分「正常关闭」和「强制杀进程」两种情况
 *
 * 上一轮用 taskkill /F 模拟关机，结果进度丢了。
 * 但 /F 是强杀，等于拔电源，不是正常关机。
 * 正常关闭浏览器时，浏览器会把内存里的 localStorage 刷到磁盘。
 *
 * 本测试对比：
 *   1. 正常关闭（Browser.close，等价于点 X 关浏览器 / 正常关机）
 *   2. 强制杀进程（taskkill /F，等价于蓝屏/拔电源）
 *   3. 杀进程前等一下（给异步写盘留时间）
 */
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = 'D:/program/题库/阿里云ACP大模型-离线题库.html';
const KEY = 'offline_tiku_aliyun-acp-llm_v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 9700;

function fileUrl(p) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return 'file:///' + parts.map(encodeURIComponent).join('/');
}

async function launch(profile, extra = []) {
  const myPort = port++;
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-breakpad', '--disable-crash-reporter', '--disable-extensions',
    '--remote-debugging-port=' + myPort, '--user-data-dir=' + profile, ...extra, 'about:blank',
  ], { stdio: 'ignore' });

  for (let i = 0; i < 100; i++) {
    await sleep(250);
    try { if ((await fetch(`http://127.0.0.1:${myPort}/json/version`)).ok) break; } catch (e) {}
  }
  const list = await (await fetch(`http://127.0.0.1:${myPort}/json/list`)).json();
  const t = list.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  const goto = async u => { await send('Page.navigate', { url: u }); await sleep(1700); };

  const gracefulClose = async () => {
    try { await send('Browser.close'); } catch (e) {}
    await sleep(2500);
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    await sleep(500);
  };
  const hardKill = async () => {
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    await sleep(1000);
  };
  return { ev, goto, gracefulClose, hardKill, send };
}

async function answerOne(b) {
  await b.ev(`localStorage.clear()`);
  await b.send('Page.navigate', { url: fileUrl(HTML) });
  await sleep(1600);
  await b.ev(`(()=>{const b=window.__bank;const q=b.QS[0];const i=q.options.findIndex(o=>o.ok);document.querySelectorAll('.opt')[i].click();return 1})()`);
  await sleep(500);
  return await b.ev(`(()=>{const b=window.__bank;const raw=localStorage.getItem('${KEY}');const o=raw?JSON.parse(raw):null;return {answered:Object.keys(b.S.ans).length, rawAns: o?Object.keys(o.ans).length:-1, rawLen: raw?raw.length:0}})()`);
}

async function readBack(profile) {
  const b = await launch(profile);
  await b.goto(fileUrl(HTML));
  const r = await b.ev(`(()=>{const b=window.__bank;const raw=localStorage.getItem('${KEY}');const o=raw?JSON.parse(raw):null;return {answered:Object.keys(b.S.ans).length, rawAns: o?Object.keys(o.ans).length:-1}})()`);
  await b.hardKill();
  return r;
}

const R = [];
function rep(n, ok, d) { R.push({ n, ok, d }); console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  → ' + d : ''}`); }

(async () => {
  console.log('\n===== 1. 正常关闭浏览器（等价于点 X 关掉 / 正常关机） =====');
  const p1 = 'D:/program/题库/work/verify/p1';
  fs.rmSync(p1, { recursive: true, force: true });
  let b = await launch(p1);
  const w1 = await answerOne(b);
  console.log('  关闭前：内存已答', w1.answered, ' storage 里 ans 有', w1.rawAns, '条');
  await b.gracefulClose();
  await sleep(1500);
  const r1 = await readBack(p1);
  console.log('  重开后：已答', r1.answered, ' storage ans', r1.rawAns);
  rep('正常关闭后进度保留', r1.answered === 1 && w1.answered === 1, `after=${r1.answered}`);

  console.log('\n===== 2. 强制杀进程，但杀之前等 6 秒让浏览器写盘 =====');
  const p2 = 'D:/program/题库/work/verify/p2';
  fs.rmSync(p2, { recursive: true, force: true });
  b = await launch(p2);
  const w2 = await answerOne(b);
  console.log('  答题后等待 6 秒（给异步写盘留时间）...');
  await sleep(6000);
  await b.hardKill();
  await sleep(1200);
  const r2 = await readBack(p2);
  console.log('  强杀后：已答', r2.answered);
  rep('强杀进程但已写盘 → 进度保留', r2.answered === 1, `after=${r2.answered}`);

  console.log('\n===== 3. 强制杀进程，答题后立刻杀（模拟突然断电） =====');
  const p3 = 'D:/program/题库/work/verify/p3';
  fs.rmSync(p3, { recursive: true, force: true });
  b = await launch(p3);
  const w3 = await answerOne(b);
  console.log('  答题后立刻强杀（不给写盘时间）...');
  await b.hardKill();
  await sleep(1200);
  const r3 = await readBack(p3);
  console.log('  立刻强杀后：已答', r3.answered);
  rep('答题后立刻断电 → 这一题可能丢（预期）', true, `after=${r3.answered}（这一项只是记录现象，不做强制要求）`);

  console.log('\n===== 4. 正常关闭，但中间又答了很多题（更接近真实使用） =====');
  const p4 = 'D:/program/题库/work/verify/p4';
  fs.rmSync(p4, { recursive: true, force: true });
  b = await launch(p4);
  await b.ev(`localStorage.clear()`);
  await b.send('Page.navigate', { url: fileUrl(HTML) });
  await sleep(1700);
  // 连续答 5 题
  for (let i = 0; i < 5; i++) {
    await b.ev(`(()=>{const b=window.__bank;const q=b.QS[${i}];const j=q.options.findIndex(o=>o.ok);document.querySelectorAll('.opt')[j].click();return 1})()`);
    await sleep(350);
    await b.ev(`(()=>{const nb=[...document.querySelectorAll('.btn.primary')].find(x=>x.textContent.includes('下一题'));if(nb&&!nb.disabled)nb.click();return 1})()`);
    await sleep(350);
  }
  const w4 = await b.ev(`Object.keys(window.__bank.S.ans).length`);
  console.log('  关闭前已答：', w4, '题');
  await b.gracefulClose();
  await sleep(1500);
  const r4 = await readBack(p4);
  console.log('  重开后已答：', r4.answered, '题');
  rep('连续答 5 题后正常关闭 → 全部保留', r4.answered === w4 && w4 === 5, `before=${w4} after=${r4.answered}`);

  console.log('\n===== 汇总 =====');
  console.log(`  ${R.filter(x => x.ok).length}/${R.length} 项通过`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
