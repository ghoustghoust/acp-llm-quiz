/**
 * shots_keyboard.js — 真实 Chrome：键盘作答在「选项打乱」下是否点得准
 *
 * jsdom 能证明状态写对了，但证明不了「屏幕上高亮的那一行 = 我按的那个字母」。
 * 这里用真浏览器读渲染结果，把那一次高亮拍下来。
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9912;
const OUT = path.resolve(__dirname, 'screens');
const PROFILE = path.resolve(__dirname, 'kbdprof');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-breakpad', '--disable-crash-reporter', '--disable-extensions',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 100; i++) { await sleep(250); try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch (e) { } }
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
  /* 派发按键注意：
     普通字符键用 keyDown + text 就行；
     但方向键这类「不产生字符」的特殊键必须用 rawKeyDown + windowsVirtualKeyCode，
     否则 Chrome 只在渲染进程里合成一个事件、页面监听器根本收不到 ——
     第一版就是这么写的，结果真浏览器里方向键「没反应」，
     差点被误判成产品 bug（jsdom 直接 dispatchEvent，所以那边一直是过的）。 */
  const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13 };
  const keyPress = async k => {
    const vk = VK[k];
    if (vk) {
      const p = { key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
    } else {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
    }
  };
  const shot = async n => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data, 'base64'));
    console.log('   →', n);
  };

  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2200);

  console.log('\n【A. 顺序刷题：按 A 命中的是不是屏幕上那个 A】');
  const a = await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.mode = 'seq'; b.S.pos.seq = 0; b.S.optRound = 7; b.S.memorizing = false; b.S.reveal = {};
    b.save(); b.render();
    const q = b.QS[0];
    const ord = b.optionView(q).order;
    return {
      letters: [...document.querySelectorAll('.opt .k')].map(x => x.textContent),
      texts: [...document.querySelectorAll('.opt .v')].map(x => x.textContent.trim().slice(0, 18)),
      order: ord,
      correctOrigIdx: q.options.findIndex(o => o.ok),
      correctShownAt: ord.indexOf(q.options.findIndex(o => o.ok)),
      opt0IsCorrect: q.options[ord[0]].ok,
    };
  })()`);
  console.log('   屏幕字母:', a.letters.join(','));
  console.log('   屏幕文本:', JSON.stringify(a.texts));
  console.log('   order:', a.order, '｜正确答案显示在', 'ABCD'[a.correctShownAt], '位');

  await keyPress('a');
  await sleep(400);
  const b = await ev(`(() => {
    const b = window.__bank;
    const q = b.QS[0];
    const rec = b.S.ans[q.gid];
    const rows = [...document.querySelectorAll('.opt')].map(x => x.className);
    const result = document.querySelector('.result');
    return {
      recordedSel: rec && rec.sel, recordedOk: rec && rec.ok,
      wantOrigIdx: b.optionView(q).order[0],
      rowClasses: rows,
      verdict: result ? result.className : null,
      resultText: result ? result.textContent.replace(/\\s+/g, ' ').slice(0, 60) : null,
    };
  })()`);
  console.log('   记录的下标:', JSON.stringify(b.recordedSel), '｜期望（屏幕上 A 的原下标）:', b.wantOrigIdx);
  console.log('   判分:', b.recordedOk ? '对' : '错', '｜结果块:', b.verdict);
  console.log('   各行样式:', JSON.stringify(b.rowClasses));
  console.log('   屏幕上 A 那一行是正确答案？', a.opt0IsCorrect);
  console.log('   ★ 记录 → 屏幕 A 一致:', b.recordedSel && b.recordedSel[0] === b.wantOrigIdx ? '✅' : '❌');
  console.log('   ★ 判分与显示一致:',
    (b.recordedOk === a.opt0IsCorrect) ? '✅' : '❌ 不一致');
  await shot('kbd_1_seq_letter_a.png');

  console.log('\n【B. 单选专项：方向键 + 字母键是否认专项进度】');
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.wrong = []; b.S.wcnt = {}; b.S.streak = {}; b.S.reveal = {};
    b.S.mode = 'single'; b.S.drill.single.pos = 9; b.save(); b.render(); return 1;
  })()`);
  await sleep(500);
  const c = await ev(`(() => {
    const b = window.__bank;
    const idx = [...document.querySelectorAll('.qidx')].find(x => x.textContent.includes('第'));
    return { ui: idx ? idx.textContent.replace(/\\s+/g, ' ') : null, pos: b.S.drill.single.pos };
  })()`);
  console.log('   起始:', c.ui, '｜进度:', c.pos);

  await keyPress('ArrowRight');
  await sleep(400);
  const d = await ev(`(() => {
    const b = window.__bank;
    const idx = [...document.querySelectorAll('.qidx')].find(x => x.textContent.includes('第'));
    return { ui: idx ? idx.textContent.replace(/\\s+/g, ' ') : null, pos: b.S.drill.single.pos };
  })()`);
  console.log('   按 → 后:', d.ui, '｜进度:', d.pos,
    /11\s*\/\s*273/.test((d.ui || '').replace(/\s/g, '')) ? '✅' : '❌');
  await shot('kbd_2_drill_arrow.png');

  await keyPress('a');
  await sleep(500);
  const e = await ev(`(() => {
    const b = window.__bank;
    const pos = b.S.drill.single.pos;
    const cur = b.drillList('single')[pos];
    const first = b.drillList('single')[0];
    return {
      curAnswered: !!b.S.ans[cur.gid],
      firstAnswered: !!b.S.ans[first.gid],
      sel: b.S.ans[cur.gid] ? b.S.ans[cur.gid].sel : null,
      want: b.optionView(cur).order[0],
      result: !!document.querySelector('.result'),
    };
  })()`);
  console.log('   按 A 后：当前题已答:', e.curAnswered, '｜题池第 1 题已被误答:', e.firstAnswered,
    (!e.firstAnswered && e.curAnswered) ? '✅' : '❌');
  console.log('   记录下标:', JSON.stringify(e.sel), '｜期望:', e.want, e.sel && e.sel[0] === e.want ? '✅' : '❌');
  await shot('kbd_3_drill_answer.png');

  console.log('\n【C. 成绩单页按键不应改作答记录】');
  await ev(`(() => {
    const b = window.__bank; b.S.mode = 'exam'; b.S.exam = null; b.save(); b.render(); return 1;
  })()`);
  await sleep(500);
  await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开始考试'));
    if (btn) btn.click(); return 1;
  })()`);
  await sleep(600);
  await ev(`(() => {
    window.confirm = () => true;
    const b = window.__bank;
    b.S.exam.msAcc = b.S.exam.limitMs + 1000;
    return 1;
  })()`);
  await sleep(1600);
  const f = await ev(`(() => {
    const b = window.__bank;
    return { finished: b.S.exam && b.S.exam.finished, score: !!document.querySelector('.score .big'),
             ansCount: Object.keys(b.S.ans).length };
  })()`);
  console.log('   已交卷:', f.finished, '｜成绩单显示:', f.score, '｜作答记录数:', f.ansCount);
  for (const k of ['a', 'b', 'c']) await keyPress(k);
  await sleep(500);
  const g = await ev(`(() => {
    const b = window.__bank; return { ansCount: Object.keys(b.S.ans).length };
  })()`);
  console.log('   在成绩单上按 a/b/c 后作答记录数:', g.ansCount,
    g.ansCount === f.ansCount ? '✅ 没有偷偷改记录' : '❌ 被改了');
  await shot('kbd_4_score_no_side_effect.png');

  console.log('\n【D. 查看答案后键盘不能作答】');
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.mode = 'seq'; b.S.pos.seq = 0; b.S.reveal = {}; b.S.memorizing = false;
    b.S.exam = null; b.save(); b.render(); return 1;
  })()`);
  await sleep(600);
  await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '查看答案');
    if (btn) btn.click(); return 1;
  })()`);
  await sleep(500);
  await keyPress('a');
  await sleep(500);
  const h = await ev(`(() => {
    const b = window.__bank;
    const q = b.QS[0];
    return { answered: !!b.S.ans[q.gid], reveal: !!b.S.reveal[q.gid], hasResult: !!document.querySelector('.result') };
  })()`);
  console.log('   点过「查看答案」后按 A：作答记录被写入:', h.answered, h.answered ? '❌' : '✅ 键盘已正确挡住');
  await shot('kbd_5_reveal_blocked.png');

  console.log('\nJS 异常:', errs.length ? errs : '无');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (x) { } process.exit(2); });
