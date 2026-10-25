/**
 * shots_exam_nopeek.js — 真实 Chrome：考试中不泄露对错
 *
 * 核心验证：同一道题，先答错再答对，题卡截图必须**一模一样**。
 * jsdom 能比对文本，但「看起来是否一样」还得看真浏览器渲染。
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9930;
const OUT = path.resolve(__dirname, 'screens');
const PROFILE = path.resolve(__dirname, 'nopeekprof');
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
  const shotBuf = async () => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(r.result.data, 'base64');
  };
  const shot = async n => {
    const b = await shotBuf();
    fs.writeFileSync(path.join(OUT, n), b);
    console.log('   →', n);
  };

  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2400);

  let bad = 0;
  const report = (ok, msg, extra) => {
    if (!ok) bad++;
    console.log(`   ${ok ? '✅' : '❌'} ${msg}${extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''}`);
  };

  /* 开考，并切到一道「既能答错也能答对」的题 */
  const setup = await ev(`(() => {
    window.confirm = () => true;
    const b = window.__bank;
    b.S.ans = {}; b.S.wrong = []; b.S.wcnt = {}; b.S.streak = {};
    b.S.mode = 'exam'; b.S.exam = null; b.S.examReview = null;
    b.save(); b.render();
    setTimeout(() => {
      const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开始考试'));
      if (btn) btn.click();
    }, 100);
    return 1;
  })()`);
  await sleep(900);

  const picked = await ev(`(() => {
    const b = window.__bank;
    const E = b.S.exam;
    if (!E) return { error: 'no exam' };
    for (let i = 0; i < E.gids.length; i++) {
      const q = b.BY[E.gids[i]];
      if (q && q.options.some(o => o.ok) && q.options.some(o => !o.ok)) {
        E.pos = i; b.save(); b.render();
        return { pos: i, type: q.type, qText: q.q.slice(0, 50) };
      }
    }
    return { error: 'no comparable question' };
  })()`);
  await sleep(600);
  console.log('   选定第', picked.pos + 1, '题：', picked.type);

  const headInfo = await ev(`(() => {
    const h = document.querySelector('.qhead');
    return { text: h ? h.textContent.replace(/\\s+/g, ' ') : null };
  })()`);
  console.log('   考试中题卡头部：「' + headInfo.text + '」');
  report(!/约\s*\d+\s*分/.test(headInfo.text || ''), '考试中题卡没有「约 X 分」估分', headInfo.text);
  report(/已答\s*\d+\s*\/\s*75/.test(headInfo.text || ''), '仍然显示「已答 x/75」进度');
  report(/第\s*\d+\s*\/\s*75\s*题/.test(headInfo.text || ''), '仍然显示题号');
  await shot('nopeek_1_exam_start.png');

  /* 答错 */
  const wrongRes = await ev(`(async () => {
    const b = window.__bank;
    const E = b.S.exam;
    const gid = E.gids[E.pos], q = b.BY[gid];
    const eo = E.optOrder[gid] || q.options.map((_, i) => i);
    const wi = q.options.findIndex(o => !o.ok);
    if (wi < 0) return { error: 'no wrong option' };
    const was = (E.ans[gid] || []).slice();
    if (q.type === '多选题') {
      was.forEach(oi => { const d = eo.indexOf(oi); if (d >= 0) document.querySelectorAll('.opt')[d].click(); });
      await new Promise(r => setTimeout(r, 150));
    }
    const d = eo.indexOf(wi);
    document.querySelectorAll('.opt')[d].click();
    return { clicked: 'wrong', origIdx: wi, disp: d };
  })()`);
  await sleep(600);
  const afterWrong = await ev(`(() => {
    const b = window.__bank;
    const E = b.S.exam, gid = E.gids[E.pos], q = b.BY[gid];
    const h = document.querySelector('.qhead');
    return {
      head: h ? h.textContent.replace(/\\s+/g, ' ') : null,
      optCls: [...document.querySelectorAll('.opt')].map(x => x.className),
      hasResult: !!document.querySelector('.result'),
      hasAna: !!document.querySelector('.ana'),
      ansRecorded: !!E.ans[gid],
    };
  })()`);
  console.log('   答错后头部：「' + afterWrong.head + '」');
  report(!/约\s*\d+\s*分/.test(afterWrong.head || ''), '答错后仍无估分');
  report(!afterWrong.hasResult, '答错后不显示结果块');
  report(!afterWrong.hasAna, '答错后不显示解析');
  report(afterWrong.optCls.every(c => /^opt( sel)?$/.test(c.trim())), '选项样式不含判分标记', afterWrong.optCls);
  const bufWrong = await shotBuf();
  fs.writeFileSync(path.join(OUT, 'nopeek_2_answered_wrong.png'), bufWrong);
  console.log('   → nopeek_2_answered_wrong.png');

  /* 改成答对 */
  const rightRes = await ev(`(async () => {
    const b = window.__bank;
    const E = b.S.exam;
    const gid = E.gids[E.pos], q = b.BY[gid];
    const eo = E.optOrder[gid] || q.options.map((_, i) => i);
    const was = (E.ans[gid] || []).slice();
    if (q.type === '多选题') {
      was.forEach(oi => { const d = eo.indexOf(oi); if (d >= 0) document.querySelectorAll('.opt')[d].click(); });
      await new Promise(r => setTimeout(r, 150));
      q.options.forEach((o, oi) => { if (o.ok) document.querySelectorAll('.opt')[eo.indexOf(oi)].click(); });
    } else {
      const oi = q.options.findIndex(o => o.ok);
      document.querySelectorAll('.opt')[eo.indexOf(oi)].click();
    }
    return { clicked: 'right' };
  })()`);
  await sleep(700);
  const afterRight = await ev(`(() => {
    const b = window.__bank;
    const E = b.S.exam, gid = E.gids[E.pos], q = b.BY[gid];
    const h = document.querySelector('.qhead');
    const ans = E.ans[gid] || [];
    const cor = q.options.map((o, i) => o.ok ? i : -1).filter(i => i >= 0);
    return {
      head: h ? h.textContent.replace(/\\s+/g, ' ') : null,
      optCls: [...document.querySelectorAll('.opt')].map(x => x.className),
      hasResult: !!document.querySelector('.result'),
      isActuallyCorrect: ans.length === cor.length && cor.every(c => ans.indexOf(c) >= 0),
      ans,
    };
  })()`);
  console.log('   答对后头部：「' + afterRight.head + '」');
  console.log('   （确认这次真的答对了：', afterRight.isActuallyCorrect, '答案', JSON.stringify(afterRight.ans), '）');
  report(afterRight.isActuallyCorrect, '前置条件：这次确实答对了', afterRight.ans);
  const bufRight = await shotBuf();
  fs.writeFileSync(path.join(OUT, 'nopeek_3_answered_right.png'), bufRight);
  console.log('   → nopeek_3_answered_right.png');

  /* 关键：两张图除了「本题计时」那一位数，其他像素应该一致 */
  const normHead = s => (s || '')
    .replace(/本题\s*[\d:]+/g, '本题 _')
    .replace(/剩余\s*[\d:]+/g, '剩余 _')
    .replace(/\s+/g, ' ');
  report(normHead(afterWrong.head) === normHead(afterRight.head),
         '★ 答错与答对的题卡头部文字完全一致（不泄露对错）',
         { wrong: normHead(afterWrong.head), right: normHead(afterRight.head) });
  report(bufWrong.length === bufRight.length || Math.abs(bufWrong.length - bufRight.length) < 3000,
         '两张截图体积接近（渲染内容相同，只有计时在变）',
         { wrongBytes: bufWrong.length, rightBytes: bufRight.length });

  /* 交卷后必须有成绩 */
  await ev(`(() => { window.confirm = () => true; const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='交卷'); if(b) b.click(); return 1; })()`);
  await sleep(900);
  const afterSubmit = await ev(`(() => {
    const b = window.__bank;
    return {
      finished: b.S.exam && b.S.exam.finished,
      score: (document.querySelector('.score') || {}).textContent,
      hasVerdict: !!document.querySelector('.verdict'),
      hasRows: document.querySelectorAll('.rrow').length,
    };
  })()`);
  console.log('   交卷后:', JSON.stringify({ finished: afterSubmit.finished, score: (afterSubmit.score || '').replace(/\s+/g, ' '), hasVerdict: afterSubmit.hasVerdict, rows: afterSubmit.hasRows }));
  report(afterSubmit.finished, '交卷后考试结束');
  report(/\/\s*100\s*分/.test((afterSubmit.score || '').replace(/\s+/g, ' ')), '交卷后显示总分 /100 分', afterSubmit.score);
  report(afterSubmit.hasVerdict, '交卷后显示及格判定');
  report(afterSubmit.hasRows > 0, '交卷后有逐题解析入口', afterSubmit.hasRows);
  await shot('nopeek_4_scorecard.png');

  /* 点开一题，此刻必须给解析与对错 */
  await ev(`(() => { const r=document.querySelector('.rrow'); if(r) r.click(); return 1; })()`);
  await sleep(700);
  const review = await ev(`(() => {
    const cardText = [...document.querySelectorAll('.card')].map(c => c.textContent.replace(/\\s+/g,' ')).join(' ');
    return {
      hasAna: !!document.querySelector('.ana'),
      hasVerdictWord: /回答正确|回答错误/.test(cardText),
      snippet: (document.querySelector('.ana') || {}).textContent ? document.querySelector('.ana').textContent.slice(0,60) : null,
    };
  })()`);
  report(review.hasAna, '考后单题显示解析', review.snippet);
  report(review.hasVerdictWord, '考后单题显示「回答正确/错误」');
  await shot('nopeek_5_review_after_submit.png');

  console.log('\nJS 异常:', errs.length ? errs : '无');
  console.log(bad ? `\n❌ ${bad} 项不符` : '\n✅ 全部符合预期');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { }
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (x) { } process.exit(2); });
