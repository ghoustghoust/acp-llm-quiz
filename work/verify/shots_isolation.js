/**
 * shots_isolation.js — 真实 Chrome：板块隔离（复现用户报的具体场景）
 *
 * 用户原话：「每个板块都在单独刷，但一个板块刷了另一个板块也有记录，
 *             比如我模拟考试考了，多选被选了，单选被选了，错题也有了」
 *
 * 这里走真实点击，把这个场景从头演一遍并截图。
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9940;
const OUT = path.resolve(__dirname, 'screens');
const PROFILE = path.resolve(__dirname, 'isoprof');
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
  const shot = async n => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data, 'base64'));
    console.log('   →', n);
  };

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
  const boardCounts = () => ev(`(() => {
    const b = window.__bank, o = {};
    b.BOARD_KEYS.forEach(k => { o[k] = Object.keys(b.S.ansAll[k] || {}).length; });
    return o;
  })()`);
  const goto = async tab => {
    await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.textContent.includes(${JSON.stringify(tab)})); if(t) t.click(); return 1; })()`);
    await sleep(500);
  };
  const cardState = () => ev(`(() => {
    const opt = document.querySelector('.opt');
    return {
      answered: !!document.querySelector('.result'),
      locked: opt ? opt.classList.contains('locked') : null,
      idx: (() => { const e=[...document.querySelectorAll('.qidx')].find(x=>x.textContent.includes('第')); return e?e.textContent.replace(/\\s+/g,' ').trim():null; })(),
      empty: !opt,
    };
  })()`);

  /* ================== 场景 1：模拟考试（用户报的原场景） ================== */
  console.log('\n【1. 模拟考试 → 交卷后各板块是否被点亮】');
  await ev(`(() => {
    const b = window.__bank;
    b.BOARD_KEYS.forEach(k => { b.S.ansAll[k] = {}; });
    b.S.wrong = []; b.S.star = []; b.S.wcnt = {}; b.S.wlast = {}; b.S.streak = {};
    b.S.exam = null; b.S.examReview = null; b.S.mode = 'exam';
    b.save(); b.render(); return 1;
  })()`);
  await sleep(600);
  await ev(`(() => { const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('开始考试')); if(btn) btn.click(); return 1; })()`);
  await sleep(800);

  /* 答 10 题：前 5 对、后 5 错（避开全对题） */
  const examAns = await ev(`(async () => {
    const b = window.__bank, E = b.S.exam;
    let done = 0;
    for (let i = 0; i < E.gids.length && done < 10; i++) {
      const q = b.BY[E.gids[i]];
      const hasBad = q.options.some(o => !o.ok);
      if (!hasBad) continue;
      E.pos = i; b.save(); b.render();
      await new Promise(r => setTimeout(r, 120));
      const eo = E.optOrder[E.gids[i]] || q.options.map((_, k) => k);
      if (q.type === '多选题') {
        /* 多选：前 5 题全选对，后 5 题只选一个错的 */
        const wantRight = done < 5;
        const picks = wantRight
          ? q.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0)
          : [q.options.findIndex(o => !o.ok)];
        picks.forEach(oi => { const d = eo.indexOf(oi); if (d >= 0) document.querySelectorAll('.opt')[d].click(); });
      } else {
        const oi = done < 5 ? q.options.findIndex(o => o.ok) : q.options.findIndex(o => !o.ok);
        document.querySelectorAll('.opt')[eo.indexOf(oi)].click();
      }
      await new Promise(r => setTimeout(r, 100));
      done++;
    }
    return { done, gids: E.gids.length };
  })()`);
  console.log('   已答', examAns.done, '题 /', examAns.gids);

  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='交卷'); if(b) b.click(); return 1; })()`);
  await sleep(900);

  const afterExam = await boardCounts();
  const examInfo = await ev(`(() => {
    const E = window.__bank.S.exam;
    return { finished: E.finished, score: E.score, right: E.rightCount,
             wrongBook: window.__bank.S.wrong.length,
             gaveUp: window.__bank.S.wcnt && Object.keys(window.__bank.S.wcnt).length };
  })()`);
  console.log('   交卷后:', JSON.stringify(examInfo));
  console.log('   各板块记录:', JSON.stringify(afterExam));
  report(examInfo.finished, '考试已交卷');
  report(Object.values(afterExam).every(v => v === 0),
         '★ 考试后 8 个练习板块全为 0（考试不再污染练习记录）', afterExam);
  report(examInfo.wrongBook > 0, '★ 考试答错的题进了错题本（用户要求的）', examInfo.wrongBook);
  await shot('iso_1_after_exam.png');

  /* 逐个板块确认都是干净的可作答状态 */
  console.log('   逐个板块确认状态：');
  for (const tab of ['顺序刷题', '单选专项', '多选专项', '错题攻坚']) {
    await goto(tab);
    const st = await cardState();
    const clean = st.empty || (!st.answered && st.locked === false);
    report(clean, `考试后「${tab}」没有题显示已作答`, st);
  }
  await goto('错题本');
  const wbState = await cardState();
  report(wbState.empty || (!wbState.answered && wbState.locked === false),
         '★ 错题本里考试错的题是「未作答」状态（可重新做）', wbState);
  await shot('iso_2_wrongbook_after_exam.png');

  /* ================== 场景 2：顺序刷题 → 专项不受影响 ================== */
  console.log('\n【2. 顺序刷题答 3 题 → 各专项是否被点亮】');
  await ev(`(() => {
    const b = window.__bank;
    b.BOARD_KEYS.forEach(k => { b.S.ansAll[k] = {}; });
    b.S.wrong = []; b.S.wcnt = {}; b.S.streak = {};
    b.S.mode = 'seq'; b.S.pos = { seq:0, random:0, wrong:0, star:0, search:0 };
    b.save(); b.render(); return 1;
  })()`);
  await sleep(600);

  for (let i = 0; i < 3; i++) {
    await ev(`(() => {
      const b = window.__bank;
      const q = b.QS[b.S.pos.seq];
      const ord = b.optionView(q).order;
      const bad = q.options.findIndex(o => !o.ok);
      document.querySelectorAll('.opt')[ord.indexOf(bad < 0 ? 0 : bad)].click();
      return 1;
    })()`);
    await sleep(350);
    await ev(`(() => { const nb=[...document.querySelectorAll('button')].find(x=>/下一题/.test(x.textContent)); if(nb) nb.click(); return 1; })()`);
    await sleep(350);
  }
  const afterSeq = await boardCounts();
  console.log('   各板块记录:', JSON.stringify(afterSeq));
  report(afterSeq.seq === 3, '顺序刷题记了 3 题', afterSeq.seq);
  report(Object.keys(afterSeq).filter(k => k !== 'seq').every(k => afterSeq[k] === 0),
         '★ 其他板块一条记录都没有', afterSeq);

  for (const tab of ['单选专项', '多选专项', '随机刷题']) {
    await goto(tab);
    const st = await cardState();
    report(st.empty || (!st.answered && st.locked === false),
           `顺序刷题答过的题，在「${tab}」里仍可作答`, st);
  }
  await goto('顺序刷题');
  /* 注意：上面答完 3 题后都点了「下一题」，所以现在停在第 4 题（未作答）。
     要看「自己仍然记得」，得先回到第 1 题 —— 这是我上一版测试写错的地方。 */
  await ev(`(() => { const b = window.__bank; b.S.pos.seq = 0; b.save(); b.render(); return 1; })()`);
  await sleep(450);
  const seqState = await cardState();
  report(seqState.answered, '顺序刷题自己仍然记得（回到第 1 题显示答案）', seqState);
  await shot('iso_3_seq_isolated.png');

  /* ================== 场景 3：专项作答 → 顺序刷题不受影响 ================== */
  console.log('\n【3. 单选专项作答 → 顺序刷题是否被点亮】');
  await goto('单选专项');
  /* 在单选专项里挑一道「顺序刷题从没做过」的题来答 ——
     直接在题池里找，别盲点第 1 题：题库顺序里第 1 题顺序刷题刚做过，
     拿它验证反而证明不了隔离。 */
  const pickedDrill = await ev(`(() => {
    const b = window.__bank;
    const seqSet = Object.keys(b.S.ansAll.seq || {});
    const pool = b.drillList('single');
    const idx = pool.findIndex(q => seqSet.indexOf(q.gid) < 0 && q.options.some(o => o.ok));
    if (idx < 0) return { error: 'no clean question' };
    b.S.drill.single.pos = idx;
    b.save(); b.render();
    return { idx, gid: pool[idx].gid.slice(0, 8) };
  })()`);
  await sleep(500);
  console.log('   选了一道顺序刷题没做过的题：', JSON.stringify(pickedDrill));
  await ev(`(() => {
    const b = window.__bank;
    const q = b.drillList('single')[b.S.drill.single.pos];
    const ord = b.optionView(q).order;
    const ok = q.options.findIndex(o => o.ok);
    document.querySelectorAll('.opt')[ord.indexOf(ok)].click();
    return 1;
  })()`);
  await sleep(600);
  const afterDrill = await boardCounts();
  console.log('   各板块记录:', JSON.stringify(afterDrill));
  report(afterDrill.single === 1, '单选专项记了 1 题', afterDrill.single);

  /* 记下「顺序刷题做过的 3 题」数量，确认单选专项作答后这个数没变 */
  report(afterDrill.seq === 3, '★ 单选专项作答后，顺序刷题的 3 条记录原封不动', afterDrill.seq);

  await goto('顺序刷题');
  /* 找一道「只在单选专项做过、顺序刷题没做过」的题来验：
     单选专项第 1 题 gid，看它是否在 seq 板块里没有记录 */
  /* 找一道「只在 single 有记录、seq 没有」的题来证隔离。
     不能拿 drillList('single')[0] 凑数 —— 那题可能刚好在顺序刷题里也做过
     （题库顺序和专项题池顺序有重叠），那样两边都有记录是正常的。
     正确的验法是：把两个板块各自的记录集合拿出来求差集。 */
  const crossCheck = await ev(`(() => {
    const b = window.__bank;
    const seqSet = Object.keys(b.S.ansAll.seq || {});
    const singleSet = Object.keys(b.S.ansAll.single || {});
    const onlyInSingle = singleSet.filter(g => seqSet.indexOf(g) < 0);
    const onlyInSeq = seqSet.filter(g => singleSet.indexOf(g) < 0);
    return {
      seqN: seqSet.length, singleN: singleSet.length,
      onlyInSingle: onlyInSingle.length, onlyInSeq: onlyInSeq.length,
      sample: onlyInSingle[0] ? onlyInSingle[0].slice(0, 8) : null,
    };
  })()`);
  report(crossCheck.onlyInSingle > 0,
         '★ 存在「只在单选专项做过、顺序刷题没做过」的题（证明两边记录独立）',
         crossCheck);
  report(crossCheck.seqN === 3 && crossCheck.singleN === 1,
         '两个板块的记录数各自独立（seq=3、single=1）', crossCheck);
  await shot('iso_4_drill_isolated.png');

  /* ================== 场景 4：汇总口径仍然正常 ================== */
  console.log('\n【4. 顶栏/统计页是否仍按汇总显示】');
  const agg = await ev(`(() => {
    const b = window.__bank;
    return { aggregate: b.aggregateCount(),
             uiDone: document.getElementById('done').textContent,
             boardSum: b.BOARD_KEYS.reduce((s,k)=>s+Object.keys(b.S.ansAll[k]||{}).length,0) };
  })()`);
  console.log('   汇总:', JSON.stringify(agg));
  report(agg.aggregate >= 1, '汇总已练数正常（跨板块去重）', agg);
  report(agg.uiDone === String(agg.aggregate), '顶栏显示的就是汇总数', agg);
  report(agg.aggregate <= agg.boardSum, '汇总数 ≤ 各板块之和（同一题多板块做过去重）', agg);
  await shot('iso_5_header_aggregate.png');

  console.log('\nJS 异常:', errs.length ? errs : '无');
  console.log(bad ? `\n❌ ${bad} 项不符` : '\n✅ 全部符合预期');
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { }
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (x) { } process.exit(2); });
