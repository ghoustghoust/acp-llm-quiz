/**
 * verify_e2e_stats.js — 端到端：走真实 UI 点击路径，验证错题次数与统计
 *
 * 上一份测试是直接调 noteWrong()，属于「绕过 UI 测逻辑」，
 * 它证明不了「用户真的点选项答错时，次数会不会 +1」。
 * 这里补上真实点击路径。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.resolve(__dirname, '..', '..', '阿里云ACP大模型-离线题库.html');
const html = fs.readFileSync(FILE, 'utf8');

const jsErrors = [];
function mkDom(store) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String((e && e.message) || e);
    if (!/Not implemented:\s*Window's scrollTo/.test(m)) jsErrors.push(m);
  });
  vc.on('error', (...a) => jsErrors.push('console.error: ' + a.join(' ')));
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://localhost/offline.html', virtualConsole: vc,
  });
}

const dom = mkDom();
const { window } = dom;
const doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = s => doc.querySelector(s);
const qa = s => [...doc.querySelectorAll(s)];
function click(x) {
  const e = typeof x === 'string' ? q(x) : x;
  if (!e) throw new Error('no element: ' + x);
  e.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
const tabByText = t => qa('.tab').find(x => x.textContent.includes(t));

/* 点选项时必须做「原始下标 → 显示位置」的换算。
   选项位置现在是打乱的（顺序刷题按轮次、随机题按开关），
   存储层一律用原始下标，屏幕上却是显示位置 —— 直接拿原下标去点 .opt
   会点到别的选项上，于是「想点错」变成点对、「想点对」变成点错。
   这类断言因此约 20% 概率随机失败（不是产品 bug，是测试自己按错了行）。 */
function clickPracticeOpt(bank, origIdx) {
  const cur = bank.QS[bank.S.pos.seq];
  const order = bank.optionView(cur).order;
  const disp = order.indexOf(origIdx);
  if (disp < 0) throw new Error('选项未渲染：origIdx=' + origIdx + ' order=' + order);
  qa('.opt')[disp].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
function clickExamOpt(bank, origIdx) {
  const gid = bank.S.exam.gids[bank.S.exam.pos];
  const eo = bank.S.exam.optOrder[gid] || bank.BY[gid].options.map((_, i) => i);
  const disp = eo.indexOf(origIdx);
  if (disp < 0) throw new Error('考试选项未渲染：origIdx=' + origIdx + ' order=' + eo);
  qa('.opt')[disp].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(name, cond, extra) {
  if (cond) R.pass.push(name);
  else R.fail.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

(async () => {
  await sleep(400);
  const bank = window.__bank;

  /* 清空以便从零计量 */
  window.confirm = () => true;
  click('#btReset');
  await sleep(400);

  check('起点：错题次数为空', bank.rankCount() === 0, bank.rankCount());

  /* ---------- 场景 1：真实点击答错 ---------- */
  const q1 = bank.QS[0];
  check('Q1 未做过', !bank.recOf(q1.gid));

  const badIdx = q1.options.findIndex(o => !o.ok);
  await sleep(400);
  clickPracticeOpt(bank, badIdx);
  await sleep(300);

  check('真实点击答错后 wcnt = 1', bank.S.wcnt[q1.gid] === 1, bank.S.wcnt[q1.gid]);
  check('真实点击答错后进错题本', bank.S.wrong.indexOf(q1.gid) >= 0);
  check('真实点击答错后记录 wlast', typeof bank.S.wlast[q1.gid] === 'number', bank.S.wlast[q1.gid]);
  check('排行出现 1 条', bank.wrongRank().length === 1, bank.wrongRank().length);

  /* ---------- 场景 2：点「重做本题」再答错，次数应累加 ---------- */
  const redo = qa('.btn').find(b => b.textContent === '重做本题');
  check('有重做按钮', !!redo);
  if (redo) {
    click(redo);
    await sleep(300);
    check('重做后本次作答记录清空', !bank.recOf(q1.gid));
    check('重做不会清掉错题次数', bank.S.wcnt[q1.gid] === 1, bank.S.wcnt[q1.gid]);

    await sleep(400);
    clickPracticeOpt(bank, badIdx);
    await sleep(300);
    check('再错一次后 wcnt = 2', bank.S.wcnt[q1.gid] === 2, bank.S.wcnt[q1.gid]);
    check('难度升级为较难', bank.difficultyOf(q1) === '较难', bank.difficultyOf(q1));
  }

  /* ---------- 场景 3：答对，次数不变但移出错题本 ---------- */
  const redo2 = qa('.btn').find(b => b.textContent === '重做本题');
  if (redo2) {
    click(redo2);
    await sleep(300);
    const okIdx = q1.options.findIndex(o => o.ok);
    await sleep(400);
    clickPracticeOpt(bank, okIdx);
    await sleep(300);
    check('答对后 wcnt 仍是 2', bank.S.wcnt[q1.gid] === 2, bank.S.wcnt[q1.gid]);
    // 新规则：连续答对 3 次才移出错题本，答对 1 次仍在里面
    check('答对 1 次后仍在错题本（未达掌握标准）', bank.S.wrong.indexOf(q1.gid) >= 0,
          { streak: bank.S.streak[q1.gid], wcnt: bank.S.wcnt[q1.gid] });
    check('答对后仍留在排行里', bank.wrongRank().some(r => r.gid === q1.gid));
  }

  /* ---------- 场景 4：统计页数字与实际作答一致 ---------- */
  click(tabByText('统计'));
  await sleep(400);

  const byType = bank.groupStats(x => x.type);
  const sumDone = byType.reduce((s, g) => s + g.done, 0);
  const actualDone = bank.aggregateCount();
  check('统计页已练数 = 实际已答数', sumDone === actualDone, [sumDone, actualDone]);
  check('已练数为 1', actualDone === 1, actualDone);

  const sumWrong = byType.reduce((s, g) => s + g.wrong, 0);
  check('统计页错题数 = 有错次记录的题数', sumWrong === bank.rankCount(), [sumWrong, bank.rankCount()]);

  /* 统计页可见数字 */
  const statVals = qa('.stat .v').map(x => x.textContent);
  check('总览显示总题量 395', statVals.includes('395 题'), statVals);
  check('总览显示已练 1 题', statVals.includes('1 题'), statVals);

  /* ---------- 场景 5：排行页真实反映 ---------- */
  click(tabByText('错题排行'));
  await sleep(400);
  check('排行页有 1 条', qa('.rk').length === 1, qa('.rk').length);
  const cntTxt = q('.rk .cnt').textContent;
  check('排行显示 2 次', /2/.test(cntTxt), cntTxt);
  check('排行显示「本次已答对」', /本次已答对/.test(q('.rk .mt').textContent), q('.rk .mt').textContent);

  /* ---------- 场景 6：刷新后统计保留 ---------- */
  const raw = JSON.parse(window.localStorage.getItem('offline_tiku_aliyun-acp-llm_v1'));
  check('storage 里 wcnt 记为 2', raw.wcnt[q1.gid] === 2, raw.wcnt[q1.gid]);

  const dom2 = mkDom();
  await sleep(500);
  const bank2 = dom2.window.__bank;
  /* jsdom 每个实例 storage 独立，这里只验证 load 逻辑不炸、结构完整 */
  check('新实例统计函数可用', typeof bank2.groupStats === 'function');
  const byType2 = bank2.groupStats(x => x.type);
  check('新实例分组数学仍正确', byType2.reduce((s, g) => s + g.total, 0) === 395);

  /* ---------- 场景 7：考试答错也要计数 ---------- */
  click(tabByText('模拟'));
  await sleep(400);
  const startBtn = qa('.btn.primary').find(b => b.textContent.includes('开始考试'));
  click(startBtn);
  await sleep(500);

  // 考试中把第一题答错。
  // 注意：考试里选项顺序用开考时固定的 E.optOrder（不是 optionView 现算），
  // 直接拿原始下标去点 .opt 会点到别的行上 —— 这就是这条断言以前约 20% 概率
  // 随机失败的原因（不是产品 bug，是测试没换算显示位置）。
  // 关于多选题：考试里没有「逐题提交」按钮，勾选即写进 E.ans，
  // 交卷时统一判分，所以这里点一下就够了（漏选在判分时算错）。
  const E = bank.S.exam;
  check('考试已开始', !!E && !E.finished);

  /* ⚠️ 题库里有 7 道多选题是「所有选项都正确」，另有一道单选题的选项是
     「以上所有」这类。如果不加判断直接 findIndex(o => !o.ok)，
     会拿到 -1 → 点不到任何行 → 整套测试崩在这里，后面 31 项全丢。
     这不是产品问题，是数据本身如此；换一道「有错误选项」的题即可。 */
  let eqPos = -1, eq = null, eqBad = -1;
  for (let i = 0; i < E.gids.length; i++) {
    const cand = bank.BY[E.gids[i]];
    const bad = cand.options.findIndex(o => !o.ok);
    if (bad >= 0) { eqPos = i; eq = cand; eqBad = bad; break; }
  }
  check('找到一道有错误选项的题（前置条件）', eqPos >= 0, eqPos);
  E.pos = eqPos;
  bank.save(); bank.render();
  await sleep(300);

  const cntBefore = bank.S.wcnt[eq.gid] || 0;
  clickExamOpt(bank, eqBad);
  await sleep(300);

  // 交卷
  const sub = qa('.btn').find(b => b.textContent === '交卷');
  click(sub);
  await sleep(500);

  check('交卷后考试结束', bank.S.exam.finished === true, bank.S.exam.finished);
  check('考试答错也计入错题次数', (bank.S.wcnt[eq.gid] || 0) === cntBefore + 1, [cntBefore, bank.S.wcnt[eq.gid]]);
  check('考试答错也进错题本', bank.S.wrong.indexOf(eq.gid) >= 0);
  check('考试后排行包含该题', bank.wrongRank().some(r => r.gid === eq.gid));

  /* ---------- 场景 8：无异常 ---------- */
  check('全程无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 4));

  console.log(NL + '===== PASS (' + R.pass.length + ') =====');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  if (R.fail.length) {
    console.log(NL + '===== FAIL (' + R.fail.length + ') =====');
    R.fail.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log(NL + 'ALL CHECKS PASSED (' + R.pass.length + ')');
  process.exit(0);
})().catch(e => {
  console.error('FATAL', e && e.message);
  console.log(NL + '--- 崩溃前通过 (' + R.pass.length + ') ---');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  console.log(NL + '--- 崩溃前失败 (' + R.fail.length + ') ---');
  R.fail.forEach(f => console.log('  ✗ ' + f));
  process.exit(2);
});
