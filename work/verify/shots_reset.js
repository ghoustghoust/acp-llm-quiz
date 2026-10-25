/**
 * shots_reset.js — 真实 Chrome：重置本板块后，到底能不能重新做
 *
 * jsdom 能证明状态被清了，但证明不了「用户点上去真的有反应」。
 * 这里走真实点击 + 真实按键，并在重置前后各拍一张。
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9920;
const OUT = path.resolve(__dirname, 'screens');
const PROFILE = path.resolve(__dirname, 'resetprof');
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
  const VK = { ArrowLeft: 37, ArrowRight: 39, Enter: 13 };
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
  /* 点按钮比较可靠的方式：按文本找元素再 click（会触发 onclick） */
  const clickByText = async (txt, exact) => ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => ${exact ? `x.textContent.trim() === ${JSON.stringify(txt)}` : `x.textContent.includes(${JSON.stringify(txt)})`});
    if (!b) return 'NOT_FOUND';
    b.click(); return 'CLICKED';
  })()`);

  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2400);
  await ev(`(() => { window.confirm = () => true; return 1; })()`);

  let bad = 0;
  const report = (ok, msg, extra) => {
    if (!ok) bad++;
    console.log(`   ${ok ? '✅' : '❌'} ${msg}${extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''}`);
  };

  /* ============ 场景 1：单选专项重置后能否重新作答 ============ */
  console.log('\n【1. 单选专项】做 3 题 → 重置本专项 → 重新作答');
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.wrong = []; b.S.wcnt = {}; b.S.streak = {}; b.S.reveal = {}; b.S.memorizing = false;
    b.S.mode = 'single'; b.S.drill.single.pos = 0; b.save(); b.render(); return 1;
  })()`);
  await sleep(600);

  /* 真的点三个选项作答（用键盘更稳，且能同时验证键盘路径） */
  for (let i = 0; i < 3; i++) {
    await keyPress('b');
    await sleep(350);
    await keyPress('ArrowRight');
    await sleep(350);
  }
  const before1 = await ev(`(() => {
    const b = window.__bank;
    return { answered: Object.keys(b.S.ans).length, hasResult: !!document.querySelector('.result'),
             stat: b.drillStats('single'), round: b.S.optRound };
  })()`);
  console.log('   重置前：', JSON.stringify(before1));
  await shot('reset_1_before.png');

  const c1 = await clickByText('重置本专项', true);
  console.log('   点「重置本专项」:', c1);
  await sleep(700);
  const after1 = await ev(`(() => {
    const b = window.__bank;
    const opt = document.querySelector('.opt');
    const idx = [...document.querySelectorAll('.qidx')].find(x => x.textContent.includes('第'));
    return { answered: Object.keys(b.S.ans).length, hasResult: !!document.querySelector('.result'),
             optClass: opt ? opt.className : null,
             optLocked: opt ? opt.classList.contains('locked') : null,
             ui: idx ? idx.textContent.replace(/\\s+/g, ' ') : null,
             stat: b.drillStats('single'), round: b.S.optRound };
  })()`);
  console.log('   重置后：', JSON.stringify(after1));
  report(after1.answered === 0, '本专项作答记录被清空', after1.answered);
  report(!after1.hasResult, '第 1 题不再直接显示答案');
  report(after1.optLocked === false, '选项没有被锁死（点得动）', after1.optClass);
  report(after1.stat.done === 0 && after1.stat.right === 0 && after1.stat.wrong === 0,
         '概览卡「已做/做对/做错」全部归零', after1.stat);
  report(/>?第\s*1\s*\//.test((after1.ui || '').replace(/\s/g, ' ')) || /第1\//.test((after1.ui || '')), '回到第 1 题', after1.ui);
  report(after1.round === before1.round + 1, '换了一套选项排列（轮次+1）', { before: before1.round, after: after1.round });
  await shot('reset_2_after.png');

  /* 真的重新答一题，确认能登记 */
  await keyPress('a');
  await sleep(600);
  const re1 = await ev(`(() => {
    const b = window.__bank;
    return { answered: Object.keys(b.S.ans).length, hasResult: !!document.querySelector('.result'),
             stat: b.drillStats('single') };
  })()`);
  console.log('   重置后按 A 再答：', JSON.stringify(re1));
  report(re1.answered === 1, '重置后能真正重新作答', re1.answered);
  report(re1.stat.done === 1, '概览卡重新计数', re1.stat);
  await shot('reset_3_reanswer.png');

  /* ============ 场景 2：多选专项 ============ */
  console.log('\n【2. 多选专项】');
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.reveal = {}; b.S.mode = 'multi'; b.S.drill.multi.pos = 0;
    b.save(); b.render(); return 1;
  })()`);
  await sleep(600);
  for (let i = 0; i < 2; i++) {
    await keyPress('a'); await sleep(250);
    await keyPress('Enter'); await sleep(350);
    await keyPress('ArrowRight'); await sleep(350);
  }
  const before2 = await ev(`(() => { const b = window.__bank; return { answered: Object.keys(b.S.ans).length }; })()`);
  console.log('   重置前已答:', before2.answered);
  await clickByText('重置本专项', true);
  await sleep(700);
  const after2 = await ev(`(() => {
    const b = window.__bank;
    const opt = document.querySelector('.opt');
    return { answered: Object.keys(b.S.ans).length, hasResult: !!document.querySelector('.result'),
             optLocked: opt ? opt.classList.contains('locked') : null, stat: b.drillStats('multi') };
  })()`);
  console.log('   重置后:', JSON.stringify(after2));
  report(after2.answered === 0, '多选专项作答记录清空', after2.answered);
  report(!after2.hasResult, '多选第 1 题不再显示答案');
  report(after2.optLocked === false, '多选选项解锁', after2.optLocked);
  report(after2.stat.done === 0, '多选概览卡归零', after2.stat);
  await shot('reset_4_multi.png');

  /* ============ 场景 3：顺序刷题（原来完全没有本板块重置） ============ */
  console.log('\n【3. 顺序刷题】做 4 题 → 重置本轮 → 重新作答');
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.wrong = []; b.S.wcnt = {}; b.S.streak = {};
    b.S.mode = 'seq'; b.S.pos.seq = 0; b.S.memorizing = false; b.S.reveal = {};
    b.save(); b.render(); return 1;
  })()`);
  await sleep(600);
  for (let i = 0; i < 4; i++) {
    await keyPress('a'); await sleep(300);
    await keyPress('ArrowRight'); await sleep(300);
  }
  const before3 = await ev(`(() => {
    const b = window.__bank;
    return { answered: Object.keys(b.S.ans).length, wrong: b.S.wrong.length, round: b.S.optRound,
             hasResetBtn: [...document.querySelectorAll('button')].some(x => /^重置(本板块|本轮)$/.test(x.textContent.trim())) };
  })()`);
  console.log('   重置前:', JSON.stringify(before3));
  report(before3.hasResetBtn, '顺序刷题页出现「重置本轮」按钮（原来没有）');
  await shot('reset_5_seq_before.png');

  const c3 = await clickByText('重置本轮', true);
  console.log('   点「重置本轮」:', c3);
  await sleep(700);
  const after3 = await ev(`(() => {
    const b = window.__bank;
    const opt = document.querySelector('.opt');
    const idx = [...document.querySelectorAll('.qidx')].find(x => x.textContent.includes('第'));
    return { answered: Object.keys(b.S.ans).length, wrong: b.S.wrong.length,
             hasResult: !!document.querySelector('.result'), optLocked: opt ? opt.classList.contains('locked') : null,
             ui: idx ? idx.textContent.replace(/\\s+/g, ' ') : null, round: b.S.optRound,
             hasRate: !!document.querySelector('.qrate') };
  })()`);
  console.log('   重置后:', JSON.stringify(after3));
  report(after3.answered === 0, '顺序刷题作答记录清空', after3.answered);
  report(!after3.hasResult, '第 1 题不再显示答案');
  report(after3.optLocked === false, '选项解锁', after3.optLocked);
  report(!after3.hasRate, '正确率徽标消失（一道没做不显示）', after3.hasRate);
  report(after3.round === before3.round + 1, '换了一套选项排列', { before: before3.round, after: after3.round });
  report(after3.wrong === before3.wrong, '错题本没有被清', { before: before3.wrong, after: after3.wrong });
  await shot('reset_6_seq_after.png');

  await keyPress('b');
  await sleep(600);
  const re3 = await ev(`(() => { const b = window.__bank; return { answered: Object.keys(b.S.ans).length, hasResult: !!document.querySelector('.result') }; })()`);
  console.log('   重置后按 B 再答:', JSON.stringify(re3));
  report(re3.answered === 1 && re3.hasResult, '顺序刷题重置后能重新作答', re3);
  await shot('reset_7_seq_reanswer.png');

  /* ============ 场景 4：随机刷题 ============ */
  console.log('\n【4. 随机刷题】');
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.mode = 'random'; b.S.pos.random = 0; b.S.order = []; b.save(); b.render(); return 1;
  })()`);
  await sleep(700);
  for (let i = 0; i < 2; i++) { await keyPress('a'); await sleep(300); await keyPress('ArrowRight'); await sleep(300); }
  const before4 = await ev(`(() => {
    const b = window.__bank;
    return { answered: Object.keys(b.S.ans).length, order: (b.S.order || []).slice(0, 5).join(','),
             hasBtn: [...document.querySelectorAll('button')].some(x => /^重置本板块$/.test(x.textContent.trim())) };
  })()`);
  console.log('   重置前:', JSON.stringify(before4));
  report(before4.hasBtn, '随机刷题页出现「重置本板块」按钮（原来没有）');
  await clickByText('重置本板块', true);
  await sleep(700);
  const after4 = await ev(`(() => {
    const b = window.__bank;
    const opt = document.querySelector('.opt');
    return { answered: Object.keys(b.S.ans).length, order: (b.S.order || []).slice(0, 5).join(','),
             hasResult: !!document.querySelector('.result'), optLocked: opt ? opt.classList.contains('locked') : null };
  })()`);
  console.log('   重置后:', JSON.stringify(after4));
  report(after4.answered === 0, '随机刷题作答记录清空', after4.answered);
  report(!after4.hasResult, '不再显示答案');
  report(after4.optLocked === false, '选项解锁', after4.optLocked);
  report(after4.order !== before4.order, '换了一套题目顺序', { before: before4.order, after: after4.order });
  await shot('reset_8_random.png');

  /* ============ 场景 5：错题本（名单必须保留） ============ */
  console.log('\n【5. 错题本】重置后名单必须还在');
  await ev(`(() => {
    const b = window.__bank;
    b.S.ans = {}; b.S.wrong = []; b.S.wcnt = {}; b.S.streak = {};
    const singles = b.QS.filter(x => x.type === '单选题');
    singles.slice(20, 24).forEach(q => { b.S.wrong.push(q.gid); b.S.wcnt[q.gid] = 1; });
    b.S.mode = 'wrong'; b.S.pos.wrong = 0; b.save(); b.render(); return 1;
  })()`);
  await sleep(700);
  for (let i = 0; i < 2; i++) {
    await keyPress('a'); await sleep(300);
    await keyPress('ArrowRight'); await sleep(300);
  }
  const before5 = await ev(`(() => {
    const b = window.__bank;
    return { answered: Object.keys(b.S.ans).length, wrong: b.S.wrong.length,
             hasBtn: [...document.querySelectorAll('button')].some(x => /^重置本板块$/.test(x.textContent.trim())) };
  })()`);
  console.log('   重置前:', JSON.stringify(before5));
  report(before5.hasBtn, '错题本页出现「重置本板块」按钮（原来没有）');
  await shot('reset_9_wrong_before.png');
  await clickByText('重置本板块', true);
  await sleep(700);
  const after5 = await ev(`(() => {
    const b = window.__bank;
    const opt = document.querySelector('.opt');
    return { answered: Object.keys(b.S.ans).length, wrong: b.S.wrong.length,
             hasResult: !!document.querySelector('.result'), optLocked: opt ? opt.classList.contains('locked') : null,
             stillHasQs: document.querySelectorAll('.opt').length > 0 };
  })()`);
  console.log('   重置后:', JSON.stringify(after5));
  report(after5.answered === 0, '错题本作答记录清空', after5.answered);
  report(after5.wrong === before5.wrong, '★ 错题本名单保留（清了就空了）', { before: before5.wrong, after: after5.wrong });
  report(after5.stillHasQs, '重置后页面上仍有题可刷', after5.stillHasQs);
  report(!after5.hasResult && after5.optLocked === false, '可以重新作答');
  await shot('reset_10_wrong_after.png');

  /* ============ 场景 6：总重置仍然是全清 ============ */
  console.log('\n【6. 总重置：仍然全部清空】');
  const before6 = await ev(`(() => { const b = window.__bank; return { wrong: b.S.wrong.length, wcnt: Object.keys(b.S.wcnt).length }; })()`);
  await ev(`(() => document.getElementById('btReset').click())()`);
  await sleep(700);
  const after6 = await ev(`(() => {
    const b = window.__bank;
    return { answered: Object.keys(b.S.ans).length, wrong: b.S.wrong.length, star: b.S.star.length,
             wcnt: Object.keys(b.S.wcnt).length, streak: Object.keys(b.S.streak).length };
  })()`);
  console.log('   总重置前:', JSON.stringify(before6), '→ 后:', JSON.stringify(after6));
  report(after6.answered === 0 && after6.wrong === 0 && after6.star === 0 && after6.wcnt === 0 && after6.streak === 0,
         '总重置仍然是「全部清空」', after6);
  await shot('reset_11_global.png');

  console.log('\nJS 异常:', errs.length ? errs : '无');
  console.log(bad ? `\n❌ ${bad} 项不符` : '\n✅ 全部符合预期');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { }
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (x) { } process.exit(2); });
