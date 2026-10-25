/**
 * test_new_pc.js — 模拟「拿到一台全新电脑」会发生什么
 *
 * 新电脑 = 全新浏览器 profile（没有任何历史 localStorage）
 * 三种拿到文件的方式都测：
 *   1. 直接拷贝 HTML 过去（最可能的方式）
 *   2. 用 U 盘放别的路径
 *   3. 从备份恢复进度
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 9200;

function fileUrl(p) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return 'file:///' + parts.map(encodeURIComponent).join('/');
}

async function launch(exe, profile) {
  const myPort = port++;
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(exe, [
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
  const goto = async u => { await send('Page.navigate', { url: u }); await sleep(1900); };
  const close = async () => {
    try { await send('Browser.close'); } catch (e) {}
    await sleep(2100);
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    await sleep(400);
  };
  return { ev, goto, close, send };
}

const HTML = 'D:/program/题库/阿里云ACP大模型-离线题库.html';
const KEY = 'offline_tiku_aliyun-acp-llm_v1';
const BASE = 'D:/program/题库/work/verify/newpc';
const R = [];
function rep(n, ok, d) { R.push({ n, ok, d }); console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  → ' + d : ''}`); }

(async () => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(BASE, { recursive: true });

  console.log('\n========== 1. 老电脑：做点进度，导出备份 ==========');
  const oldProf = BASE + '/old-pc';
  let b = await launch(CHROME, oldProf);
  await b.goto(fileUrl(HTML));
  await b.ev(`localStorage.clear()`);
  await b.send('Page.navigate', { url: fileUrl(HTML) });
  await sleep(1800);

  // 答 8 题
  for (let i = 0; i < 8; i++) {
    await sleep(400);
    await b.ev(`(()=>{const bk=window.__bank;const q=bk.QS[${i}];const idx=((${i}%3)===0)?q.options.findIndex(o=>!o.ok):q.options.findIndex(o=>o.ok);document.querySelectorAll('.opt')[idx].click();return 1})()`);
    await sleep(350);
    await b.ev(`(()=>{const nb=[...document.querySelectorAll('.btn.primary')].find(x=>x.textContent.includes('下一题'));if(nb&&!nb.disabled)nb.click();return 1})()`);
    await sleep(250);
  }
  const oldData = await b.ev(`(()=>{const bk=window.__bank;return {answered:Object.keys(bk.S.ans).length,wrong:bk.S.wrong.length,star:bk.S.star.length}})()`);
  console.log('  老电脑：已答 ' + oldData.answered + ' 题，错题本 ' + oldData.wrong);

  // 导出备份
  const backupJson = await b.ev(`JSON.stringify(window.__bank.buildBackup(), null, 1)`);
  const backupPath = BASE + '/进度备份.json';
  fs.writeFileSync(backupPath, backupJson, 'utf8');
  console.log('  已导出备份 → ' + path.basename(backupPath) + '（' + (backupJson.length / 1024).toFixed(1) + ' KB）');
  await b.close();

  console.log('\n========== 2. 新电脑：全新 profile（等价于刚买的电脑）==========');
  const newProf = BASE + '/new-pc';
  const newHtml = BASE + '/题库.html';        // 假设用户把 HTML 拷到新电脑某处
  fs.copyFileSync(HTML, newHtml);

  b = await launch(CHROME, newProf);
  await b.goto(fileUrl(newHtml));

  const freshState = await b.ev(`(()=>{
    const bk = window.__bank;
    return {
      answered: Object.keys(bk.S.ans).length,
      wrong: bk.S.wrong.length,
      star: bk.S.star.length,
      total: document.getElementById('total').textContent,
      title: document.getElementById('ttl').textContent,
      hasBank: !!bk,
    };
  })()`);
  console.log('  新电脑打开 HTML：');
  console.log('    题库标题：' + freshState.title);
  console.log('    总题量：' + freshState.total);
  console.log('    已答：' + freshState.answered + ' 题');
  console.log('    错题本：' + freshState.wrong + ' 条（预置的 57 条）');
  console.log('    收藏：' + freshState.star + ' 条（预置的 50 条）');

  rep('新电脑只拷 HTML 就能打开、题库完整', freshState.hasBank && freshState.total === '395', `total=${freshState.total}`);
  rep('新电脑上「自己的作答进度」是空的（符合预期）', freshState.answered === 0, `answered=${freshState.answered}`);
  rep('新电脑仍带着题库自带的预置错题/收藏', freshState.wrong === 57 && freshState.star === 50, `${freshState.wrong}/${freshState.star}`);

  console.log('\n========== 3. 在新电脑上导入备份 ==========');
  const imported = await b.ev(`(() => {
    return new Promise(resolve => {
      const json = ${JSON.stringify(backupJson)};
      const file = new File([json], 'progress.json', { type: 'application/json' });
      window.confirm = () => true;
      window.__bank.importBackup(file);
      setTimeout(() => {
        const bk = window.__bank;
        resolve({
          answered: Object.keys(bk.S.ans).length,
          wrong: bk.S.wrong.length,
          star: bk.S.star.length,
          done: document.getElementById('done').textContent,
          rate: document.getElementById('rate').textContent,
        });
      }, 900);
    });
  })()`, true);

  console.log('  导入后：已答 ' + imported.answered + '，错题本 ' + imported.wrong + '，收藏 ' + imported.star);
  console.log('  界面：已练 ' + imported.done + '，正确率 ' + imported.rate);

  rep('导入备份后进度完整恢复', imported.answered === oldData.answered, `old=${oldData.answered} new=${imported.answered}`);
  rep('导入后界面同步更新', imported.done === String(oldData.answered), `done=${imported.done}`);

  console.log('\n========== 4. 关掉新电脑浏览器再开，确认导入的进度留住了 ==========');
  await b.close();
  await sleep(1200);
  b = await launch(CHROME, newProf);
  await b.goto(fileUrl(newHtml));
  const afterReopen = await b.ev(`(()=>{const bk=window.__bank;return {answered:Object.keys(bk.S.ans).length,done:document.getElementById('done').textContent}})()`);
  console.log('  重开后已答：' + afterReopen.answered + ' 题');
  rep('新电脑上导入的进度能持久保存', afterReopen.answered === oldData.answered, `after=${afterReopen.answered}`);
  await b.close();

  console.log('\n========== 5. U 盘 / 别的路径 ==========');
  const usbPath = BASE + '/U盘/题库.html';
  fs.mkdirSync(path.dirname(usbPath), { recursive: true });
  fs.copyFileSync(HTML, usbPath);
  b = await launch(CHROME, newProf);
  await b.goto(fileUrl(usbPath));
  const usbState = await b.ev(`(()=>{const bk=window.__bank;return {answered:Object.keys(bk.S.ans).length,total:document.getElementById('total').textContent}})()`);
  console.log('  从「U盘」路径打开：已答 ' + usbState.answered + ' 题，总题量 ' + usbState.total);
  rep('换到任意路径都能打开', usbState.total === '395');
  rep('同源下进度跟随（file:// 共享存储）', usbState.answered === oldData.answered, `answered=${usbState.answered}`);
  await b.close();

  console.log('\n========== 6. 如果新电脑没装 Chrome，用 Edge 呢？==========');
  try {
    const edgeProf = BASE + '/edge-pc';
    const e = await launch(EDGE, edgeProf);
    await e.goto(fileUrl(newHtml));
    const es = await e.ev(`(()=>{const bk=window.__bank;return {total:document.getElementById('total').textContent,answered:Object.keys(bk.S.ans).length}})()`);
    console.log('  Edge 打开：题量 ' + es.total + '，已答 ' + es.answered);
    rep('Edge 也能正常打开（Windows 自带，无需装 Chrome）', es.total === '395', `total=${es.total}`);
    rep('Edge 是独立存储，需要单独导入备份', es.answered === 0, `answered=${es.answered}`);
    await e.close();
  } catch (err) {
    console.log('  （Edge 启动失败，跳过）', err.message);
  }

  console.log('\n========== 汇总 ==========');
  console.log(`  ${R.filter(x => x.ok).length}/${R.length} 项通过`);
  R.forEach(x => { if (!x.ok) console.log('  ✗ ' + x.n + ' → ' + x.d); });
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
