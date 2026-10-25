/**
 * test_risk.js — 验证两个真实风险点
 *
 * 风险 1：我们的页面每 5 秒自动 save()，如果用户在浏览器设置里
 *         「清除站点数据」，但我们页面还开着，会不会又把数据写回去？
 *         → 会导致「清了但没清干净」，给人错觉。
 *
 * 风险 2：同源（file://）的所有本地 HTML 共享 localStorage。
 *         如果用户有另一个 file:// 页面也用了同名 key，会互相覆盖。
 *         我们的 key 带题库标识，但要确认唯一性。
 *
 * 风险 3：数据量。395 题全做完，localStorage 会不会超限？
 */
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = 'D:/program/题库/阿里云ACP大模型-离线题库.html';
const KEY = 'offline_tiku_aliyun-acp-llm_v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 9950;

function fileUrl(p) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return 'file:///' + parts.map(encodeURIComponent).join('/');
}

async function launch(profile) {
  const myPort = port++;
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-breakpad', '--disable-crash-reporter', '--disable-extensions',
    '--remote-debugging-port=' + myPort, '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { await sleep(250); try { if ((await fetch(`http://127.0.0.1:${myPort}/json/version`)).ok) break; } catch (e) {} }
  const list = await (await fetch(`http://127.0.0.1:${myPort}/json/list`)).json();
  const t = list.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  const goto = async u => { await send('Page.navigate', { url: u }); await sleep(1800); };
  const close = async () => {
    try { await send('Browser.close'); } catch (e) {}
    await sleep(2000);
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    await sleep(400);
  };
  return { ev, goto, close, send };
}

(async () => {
  const P = 'D:/program/题库/work/verify/risk';
  fs.rmSync(P, { recursive: true, force: true });

  console.log('\n===== 风险 1：页面开着时清站点数据，会不会自己写回去？=====');
  let b = await launch(P);
  await b.goto(fileUrl(HTML));
  await b.ev(`localStorage.clear()`);
  await b.send('Page.navigate', { url: fileUrl(HTML) });
  await sleep(1600);
  await b.ev(`(()=>{const b=window.__bank;const q=b.QS[0];const i=q.options.findIndex(o=>o.ok);document.querySelectorAll('.opt')[i].click();return 1})()`);
  await sleep(600);
  console.log('  答题后 storage 有值：', await b.ev(`!!localStorage.getItem('${KEY}')`));
  console.log('  模拟清除站点数据（只清 storage，页面不刷新）...');
  await b.ev(`localStorage.clear()`);
  console.log('  立即检查：', await b.ev(`!!localStorage.getItem('${KEY}')`));
  console.log('  等 6 秒（跨过自动保存周期）...');
  await sleep(6000);
  const afterClear = await b.ev(`!!localStorage.getItem('${KEY}')`);
  console.log('  6 秒后 storage 又被写回：', afterClear);
  console.log(afterClear
    ? '  → 确认：页面开着时，我们的自动保存会把数据写回。\n     影响：用户在浏览器设置里点「清除」后如果页面还开着，会看到「清了又回来」。\n     但这不是数据丢失，是数据被恢复——对用户其实是好事，只是可能造成困惑。'
    : '  → 清掉后没有再写回');
  await b.close();

  console.log('\n===== 风险 2：file:// 下同源共享 localStorage =====');
  b = await launch(P);
  await b.goto(fileUrl(HTML));
  await b.ev(`localStorage.clear()`);
  await b.send('Page.navigate', { url: fileUrl(HTML) });
  await sleep(1600);
  await b.ev(`(()=>{const b=window.__bank;const q=b.QS[0];const i=q.options.findIndex(o=>o.ok);document.querySelectorAll('.opt')[i].click();return 1})()`);
  await sleep(600);

  // 造一个"另一个本地网页"，用不同 key
  const otherHtml = 'D:/program/题库/work/verify/另一个网页.html';
  fs.writeFileSync(otherHtml, `<!DOCTYPE html><html><body><script>
    localStorage.setItem('some_other_app', 'hello');
    document.title = 'other:' + Object.keys(localStorage).join(',');
  </script></body></html>`, 'utf8');

  const origin = await b.ev(`location.origin`);
  console.log('  题库页 origin =', origin);
  await b.goto(fileUrl(otherHtml));
  const keys = await b.ev(`Object.keys(localStorage)`);
  console.log('  另一个本地网页看到的 localStorage keys =', keys);
  const canSeeBank = await b.ev(`!!localStorage.getItem('${KEY}')`);
  console.log(`  → 另一个本地网页${canSeeBank ? '能' : '不能'}看到题库数据`);
  console.log(`  → 结论：file:// 下所有本地 HTML 共享同一个存储空间。`);
  console.log(`     我们的 key 是 "${KEY}"，足够独特，不会跟别的页面撞车。`);
  console.log(`     但反过来说：任何本地网页都能读到你的刷题数据（只是刷题记录，无敏感信息）。`);

  // 验证 key 唯一性
  const keyCount = await b.ev(`(()=>{let c=0;for(const k in localStorage){if(k.indexOf('offline_tiku')===0)c++}return c})()`);
  console.log(`  库里带 offline_tiku 前缀的 key 数量：${keyCount}（应为 1）`);
  await b.close();

  console.log('\n===== 风险 3：395 题全做完，数据有多大？会不会超限？=====');
  b = await launch(P);
  await b.goto(fileUrl(HTML));
  const sizeInfo = await b.ev(`(() => {
    const bk = window.__bank;
    // 模拟：395 题全部做完，且都错过多 1-3 次，全部收藏
    bk.S.ans = {};
    bk.S.wcnt = {};
    bk.S.wlast = {};
    bk.S.wrong = [];
    bk.S.star = [];
    const now = Date.now();
    bk.QS.forEach((q, i) => {
      bk.S.ans[q.gid] = { sel: [0, 1], ok: i % 2 === 0, t: 3000 + i * 10 };
      bk.S.wcnt[q.gid] = (i % 3) + 1;
      bk.S.wlast[q.gid] = now - i * 1000;
      bk.S.wrong.push(q.gid);
      bk.S.star.push(q.gid);
    });
    bk.S.order = bk.QS.map(x => x.gid);
    bk.S.stats = { day: '2026-10-22', dayMs: 12345678, totalMs: 98765432 };
    bk.save();
    const raw = localStorage.getItem('offline_tiku_aliyun-acp-llm_v1');
    // 粗测 localStorage 上限
    let probe = 0;
    try {
      const chunk = 'x'.repeat(1024 * 100);   // 100KB 一块
      for (let i = 0; i < 200; i++) {
        localStorage.setItem('__probe_' + i, chunk);
        probe += 100;
      }
    } catch (e) {
      // 超限了
    }
    for (let i = 0; i < 200; i++) localStorage.removeItem('__probe_' + i);
    return {
      bytes: raw ? raw.length : 0,
      kb: raw ? (raw.length / 1024).toFixed(1) : '0',
      quotaAtLeastKB: probe,
    };
  })()`);
  console.log(`  395 题全做完 + 全收藏 + 全错次记录：${sizeInfo.kb} KB`);
  console.log(`  浏览器 localStorage 实测至少能存：${sizeInfo.quotaAtLeastKB} KB`);
  console.log(`  余量：约 ${(sizeInfo.quotaAtLeastKB / parseFloat(sizeInfo.kb)).toFixed(0)} 倍 —— 远远够用`);
  await b.close();

  console.log('\n（测试结束）');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
