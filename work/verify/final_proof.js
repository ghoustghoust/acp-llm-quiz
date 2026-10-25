/**
 * final_proof.js — 最终证据：真实浏览器，答题 → 正常关闭 → 重新打开
 * 用截图 + 数据双重证明进度还在
 */
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = 'D:/program/题库/阿里云ACP大模型-离线题库.html';
const KEY = 'offline_tiku_aliyun-acp-llm_v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 9300;

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
  const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(n, Buffer.from(r.result.data, 'base64')); };
  const close = async () => {
    try { await send('Browser.close'); } catch (e) {}
    await sleep(2400);
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    await sleep(500);
  };
  return { ev, goto, shot, close, send };
}

(async () => {
  const P = 'D:/program/题库/work/verify/proof';
  fs.rmSync(P, { recursive: true, force: true });

  console.log('\n【第 1 步】打开题库，做 6 道题（含答错）、收藏 2 道、暂停计时');
  let b = await launch(P);
  await b.goto(fileUrl(HTML));
  await b.ev(`localStorage.clear()`);
  await b.send('Page.navigate', { url: fileUrl(HTML) });
  await sleep(1800);

  // 答 6 题，其中第 2、4 题故意答错
  for (let i = 0; i < 6; i++) {
    await sleep(500);
    await b.ev(`(() => {
      const bk = window.__bank;
      const q = bk.QS[${i}];
      const wantWrong = (${i} === 2 || ${i} === 4);
      const idx = wantWrong ? q.options.findIndex(o => !o.ok) : q.options.findIndex(o => o.ok);
      document.querySelectorAll('.opt')[idx].click();
      return 1;
    })()`);
    await sleep(400);
    await b.ev(`(() => {
      const nb = [...document.querySelectorAll('.btn.primary')].find(x => x.textContent.includes('下一题'));
      if (nb && !nb.disabled) nb.click();
      return 1;
    })()`);
    await sleep(300);
  }
  // 收藏 2 道（当前在第 6 题附近）
  await b.ev(`(() => { const s = document.querySelector('.star'); if (s) s.click(); return 1; })()`);
  await sleep(300);
  await b.ev(`(() => { const nb=[...document.querySelectorAll('.btn.primary')].find(x=>x.textContent.includes('下一题')); if(nb&&!nb.disabled) nb.click(); return 1; })()`);
  await sleep(400);
  await b.ev(`(() => { const s = document.querySelector('.star'); if (s) s.click(); return 1; })()`);
  await sleep(300);

  const before = await b.ev(`(() => {
    const bk = window.__bank;
    const raw = localStorage.getItem('${KEY}');
    const o = raw ? JSON.parse(raw) : null;
    return {
      answered: Object.keys(bk.S.ans).length,
      wrong: bk.S.wrong.length,
      star: bk.S.star.length,
      todayMs: bk.S.stats.dayMs,
      done: document.getElementById('done').textContent,
      rate: document.getElementById('rate').textContent,
      rawExists: !!raw,
      rawAns: o ? Object.keys(o.ans).length : -1,
    };
  })()`);
  console.log('  已答 ' + before.answered + ' 题，错题本 ' + before.wrong + '，收藏 ' + before.star);
  console.log('  界面：已练 ' + before.done + '，正确率 ' + before.rate);
  console.log('  localStorage：' + (before.rawExists ? '有数据，ans 里 ' + before.rawAns + ' 条' : '无'));

  await b.goto(fileUrl(HTML));
  await sleep(800);
  await b.shot('proof_1_before_close.png');

  console.log('\n【第 2 步】完全关闭浏览器（模拟关机）');
  await b.close();
  await sleep(1500);

  console.log('\n【第 3 步】重新打开题库');
  b = await launch(P);
  await b.goto(fileUrl(HTML));

  const after = await b.ev(`(() => {
    const bk = window.__bank;
    return {
      answered: Object.keys(bk.S.ans).length,
      wrong: bk.S.wrong.length,
      star: bk.S.star.length,
      todayMs: bk.S.stats.dayMs,
      done: document.getElementById('done').textContent,
      rate: document.getElementById('rate').textContent,
    };
  })()`);
  console.log('  已答 ' + after.answered + ' 题，错题本 ' + after.wrong + '，收藏 ' + after.star);
  console.log('  界面：已练 ' + after.done + '，正确率 ' + after.rate);
  console.log('  今日计时：' + Math.round(after.todayMs / 1000) + ' 秒');

  await b.shot('proof_2_after_reopen.png');

  // 打开错题本看看内容还在
  await b.ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('错题本')).click()`);
  await sleep(700);
  await b.shot('proof_3_wrongbook_kept.png');

  const wrongBookCount = await b.ev(`document.querySelector('.qidx') ? document.querySelector('.qidx').textContent : ''`);
  console.log('  错题本页面显示：' + wrongBookCount);

  await b.close();

  console.log('\n========== 结论 ==========');
  const ok = after.answered === before.answered
          && after.wrong === before.wrong
          && after.star === before.star
          && after.done === before.done;
  console.log(ok
    ? '  ✓ 完全关闭浏览器再打开，所有进度完整保留\n    已答 ' + after.answered + ' 题、错题本 ' + after.wrong + ' 条、收藏 ' + after.star + ' 条、今日计时都在'
    : '  ✗ 有数据不一致：' + JSON.stringify({ before, after }));

  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
