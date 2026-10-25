/**
 * test_persist_final.js — 用「正常关闭」重测所有真实场景
 */
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const HTML = 'D:/program/题库/阿里云ACP大模型-离线题库.html';
const KEY = 'offline_tiku_aliyun-acp-llm_v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 9900;

function fileUrl(p) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return 'file:///' + parts.map(encodeURIComponent).join('/');
}

async function launch(exe, profile, extra = []) {
  const myPort = port++;
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(exe, [
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
  const close = async () => {
    try { await send('Browser.close'); } catch (e) {}
    await sleep(2200);
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    await sleep(400);
  };
  return { ev, goto, close, send };
}

const R = [];
function rep(n, ok, d) { R.push({ n, ok, d }); console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  → ' + d : ''}`); }

async function seedAndClose(profile, htmlPath) {
  const b = await launch(CHROME, profile);
  await b.goto(fileUrl(htmlPath));
  await b.ev(`localStorage.clear()`);
  await b.send('Page.navigate', { url: fileUrl(htmlPath) });
  await sleep(1600);
  await b.ev(`(()=>{const b=window.__bank;const q=b.QS[0];const i=q.options.findIndex(o=>o.ok);document.querySelectorAll('.opt')[i].click();return 1})()`);
  await sleep(600);
  const n = await b.ev(`Object.keys(window.__bank.S.ans).length`);
  await b.close();
  return n;
}

async function readCount(profile, htmlPath) {
  const b = await launch(CHROME, profile);
  await b.goto(fileUrl(htmlPath));
  const r = await b.ev(`(()=>{const b=window.__bank;return {answered:Object.keys(b.S.ans).length, done:document.getElementById('done').textContent, origin:location.origin}})()`);
  await b.close();
  return r;
}

(async () => {
  const BASE = 'D:/program/题库/work/verify/pf';
  fs.rmSync(BASE, { recursive: true, force: true });

  console.log('\n===== B. 原文件位置：正常关闭再开 =====');
  const profB = BASE + '-B';
  const nB = await seedAndClose(profB, HTML);
  console.log('  关闭前已答：', nB);
  const rB = await readCount(profB, HTML);
  console.log('  重开后已答：', rB.answered, ' 界面 done =', rB.done);
  rep('B. 原位置正常关闭重启，进度保留', rB.answered === 1 && rB.done === '1', `after=${rB.answered}`);

  console.log('\n===== B2. 把 HTML 复制到别的目录再打开（同一浏览器） =====');
  const movedPath = BASE + '-moved.html';
  fs.copyFileSync(HTML, movedPath);
  const rB2 = await readCount(profB, movedPath);
  console.log('  换目录后已答：', rB2.answered, ' origin =', rB2.origin);
  rep('B2. 文件换目录后进度仍在（file:// 按 origin 共享）', rB2.answered === 1, `after=${rB2.answered}`);

  console.log('\n===== B3. 改文件名（同目录） =====');
  const renamed = BASE + '-改名.html';
  fs.copyFileSync(HTML, renamed);
  const rB3 = await readCount(profB, renamed);
  console.log('  改名后已答：', rB3.answered);
  rep('B3. 改文件名后进度仍在', rB3.answered === 1, `after=${rB3.answered}`);

  console.log('\n===== C. 换浏览器 Chrome → Edge =====');
  let edgeR = null;
  try {
    const profE = BASE + '-E';
    const seedB = await launch(CHROME, profB);   // 确保 Chrome 那边有 1 题
    await seedB.goto(fileUrl(HTML));
    await seedB.close();
    const e = await launch(EDGE, profE);
    await e.goto(fileUrl(HTML));
    edgeR = await e.ev(`Object.keys(window.__bank.S.ans).length`);
    await e.close();
    console.log('  Edge 中已答：', edgeR);
    rep('C. 换浏览器 progress 独立（不会串）', edgeR === 0, `Edge=${edgeR}`);
  } catch (err) {
    console.log('  （Edge 启动失败，跳过）', err.message);
  }

  console.log('\n===== D. 无痕模式 =====');
  const profI = BASE + '-I';
  fs.rmSync(profI, { recursive: true, force: true });
  let inc = await launch(CHROME, profI, ['--incognito']);
  await inc.goto(fileUrl(HTML));
  await inc.ev(`localStorage.clear()`);
  await inc.send('Page.navigate', { url: fileUrl(HTML) });
  await sleep(1600);
  await inc.ev(`(()=>{const b=window.__bank;const q=b.QS[0];const i=q.options.findIndex(o=>o.ok);document.querySelectorAll('.opt')[i].click();return 1})()`);
  await sleep(500);
  const incBefore = await inc.ev(`Object.keys(window.__bank.S.ans).length`);
  await inc.close();
  await sleep(600);
  inc = await launch(CHROME, profI, ['--incognito']);
  await inc.goto(fileUrl(HTML));
  const incAfter = await inc.ev(`Object.keys(window.__bank.S.ans).length`);
  await inc.close();
  console.log(`  无痕：关前 ${incBefore} 题，重开 ${incAfter} 题`);
  rep('D. 无痕模式关闭即丢（预期行为，非 bug）', incAfter === 0, `after=${incAfter}`);

  console.log('\n===== E. 清浏览器数据会怎样 =====');
  const profC = BASE + '-C';
  await seedAndClose(profC, HTML);
  let b = await launch(CHROME, profC);
  await b.goto(fileUrl(HTML));
  const pre = await b.ev(`Object.keys(window.__bank.S.ans).length`);
  // 模拟用户清空站点数据
  await b.ev(`localStorage.clear()`);
  await b.send('Page.navigate', { url: fileUrl(HTML) });
  await sleep(1600);
  const post = await b.ev(`Object.keys(window.__bank.S.ans).length`);
  await b.close();
  console.log(`  清数据前 ${pre} 题，清后 ${post} 题`);
  rep('E. 手动清浏览器站点数据 → 进度消失（这是 localStorage 的固有特性）', post === 0, `after=${post}`);

  console.log('\n===== 汇总 =====');
  console.log(`  ${R.filter(x => x.ok).length}/${R.length} 项符合预期`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
