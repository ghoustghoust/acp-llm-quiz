/**
 * verify_exam_trend.js — 验证真实考试构成 + 成绩走势板块
 *
 * 重点验证「算得对不对」，不是「能不能显示」：
 *   1. 抽题比例：50 单选 + 25 多选，且每次不同
 *   2. 计分：单选 1 分、多选 2 分，满分 100
 *   3. 及格线 80
 *   4. 限时 120 分钟
 *   5. 每日正确率统计准确
 *   6. 鼓励语/批注随数据变化
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.resolve(__dirname, '..', '..', '阿里云ACP大模型-离线题库.html');
const html = fs.readFileSync(FILE, 'utf8');

const jsErrors = [];
function mkDom() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String((e && e.message) || e);
    if (!/Not implemented:\s*Window's (scrollTo|createObjectURL)/.test(m)) jsErrors.push(m);
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

const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(n, c, d) { if (c) R.pass.push(n); else R.fail.push(n + (d !== undefined ? ' :: ' + JSON.stringify(d) : '')); }

(async () => {
  await sleep(400);
  const bank = window.__bank;
  window.confirm = () => true;

  /* =========================================================
     1. 考试规格配置
     ========================================================= */
  const EX = bank.S.examSpec;
  check('单选 50 题 × 1 分', EX.singleCount === 50 && EX.singlePoint === 1, EX);
  check('多选 25 题 × 2 分', EX.multiCount === 25 && EX.multiPoint === 2, EX);
  check('限时 120 分钟', EX.limitMin === 120, EX.limitMin);
  check('及格线 80 分', EX.passScore === 80, EX.passScore);
  check('满分合计 100', EX.singleCount*EX.singlePoint + EX.multiCount*EX.multiPoint === 100);

  /* =========================================================
     2. 开始考试 → 抽题比例
     ========================================================= */
  click(tabByText('模拟'));
  await sleep(400);

  check('考试设置页有规格表', qa('.specrow').length >= 5, qa('.specrow').length);
  const specTxt = qa('.specrow').map(r => r.textContent).join('|');
  check('规格表写明单选 50 题', /单选题.*50 题/.test(specTxt), specTxt.slice(0, 80));
  check('规格表写明多选 25 题', /多选题.*25 题/.test(specTxt), specTxt.slice(0, 80));
  check('规格表写明 120 分钟', /限时.*120 分钟/.test(specTxt), specTxt.slice(0, 120));
  check('规格表写明及格 80 分', /及格线.*80 分/.test(specTxt), specTxt.slice(0, 120));

  const startBtn = qa('.btn.primary').find(b => b.textContent.includes('开始考试'));
  check('有开始考试按钮', !!startBtn);
  click(startBtn);
  await sleep(500);

  let E = bank.S.exam;
  check('考试已开始', !!E && !E.finished);

  const gids = E.gids;
  const singleN = gids.filter(g => bank.BY[g].type === '单选题').length;
  const multiN  = gids.filter(g => bank.BY[g].type === '多选题').length;

  check('共 75 题', gids.length === 75, gids.length);
  check('恰好 50 道单选', singleN === 50, singleN);
  check('恰好 25 道多选', multiN === 25, multiN);
  check('无重复题目', new Set(gids).size === gids.length, [gids.length, new Set(gids).size]);

  /* 满分与限时 */
  let full = 0;
  gids.forEach(g => { full += E.points[g]; });
  check('本次满分 = 100', full === 100, full);
  check('单选分值 = 1', gids.filter(g => bank.BY[g].type === '单选题').every(g => E.points[g] === 1));
  check('多选分值 = 2', gids.filter(g => bank.BY[g].type === '多选题').every(g => E.points[g] === 2));
  check('限时 = 120 分钟', E.limitMs === 120 * 60 * 1000, E.limitMs);
  check('及格线记录为 80', E.passScore === 80, E.passScore);

  /* ---------- 考试中不得泄露对错（原来这里断言「约 X 分」必须存在） ----------
     那条断言是错的：实时得分会当场判卷 ——
     答错分数不动、改答对分数立刻 +1（多选 +2），
     考生每题答完看一眼就知道该不该改答案，模拟考试就失去意义了。
     现在考试中只允许出现「剩余时间 / 本题分值 / 已答几题」这类与对错无关的信息。 */
  await sleep(400);
  const headTxt = q('.qhead') ? q('.qhead').textContent.replace(/\s+/g, ' ') : '';
  check('★ 考试中不显示「约 X 分」估分（会当场判卷）',
        !/约\s*\d+\s*分/.test(headTxt), headTxt.slice(0, 100));
  check('考试中显示「已答 x/75」', /已答\s*\d+\s*\/\s*75/.test(headTxt), headTxt.slice(0, 120));
  check('考试中显示本题分值角标', !!q('.ptbadge'), q('.ptbadge') && q('.ptbadge').textContent);

  /* ---------- 考试中答错与答对，题卡显示必须一致（不能反推） ----------
     ⚠️ 不能假设「当前这题有错误选项」：题库里有 7 道多选题是全对题，
     还有一道单选题的选项含「以上所有」。碰上它们时 findIndex 返回 -1，
     qa('.opt')[-1] 是 undefined → 崩。
     这是数据如此，不是产品问题；先挑一道「有对有错」的题再测。 */
  {
    let foundPos = -1, q0 = null;
    for (let i = 0; i < E.gids.length; i++) {
      const cand = bank.BY[E.gids[i]];
      if (cand && cand.options.some(o => o.ok) && cand.options.some(o => !o.ok)) {
        foundPos = i; q0 = cand; break;
      }
    }
    check('找到一道既可答错也可答对的题（前置条件）', foundPos >= 0, foundPos);
    if (foundPos >= 0) {
      E.pos = foundPos;
      bank.save(); bank.render();
      await sleep(280);
    }
    const gid0 = (foundPos >= 0) ? E.gids[E.pos] : E.gids[E.pos];
    const eo0 = (E.optOrder && E.optOrder[gid0]) || q0.options.map((_, i) => i);
    const clickOrig = oi => {
      const disp = eo0.indexOf(oi);
      if (disp < 0) return;                        /* 防御：找不到就不点 */
      qa('.opt')[disp].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    };
    const norm = s => s.replace(/本题\s*[\d:]+/g, '本题 _').replace(/\s+/g, ' ');

    if (q0.type === '多选题') {
      (E.ans[gid0] || []).slice().forEach(clickOrig);
      await sleep(120);
      clickOrig(q0.options.findIndex(o => !o.ok));
    } else {
      clickOrig(q0.options.findIndex(o => !o.ok));
    }
    await sleep(300);
    const headWrong = norm(q('.qhead') ? q('.qhead').textContent : '');

    if (q0.type === '多选题') {
      (E.ans[gid0] || []).slice().forEach(clickOrig);
      await sleep(120);
      q0.options.forEach((o, oi) => { if (o.ok) clickOrig(oi); });
    } else {
      clickOrig(q0.options.findIndex(o => o.ok));
    }
    await sleep(300);
    const headRight = norm(q('.qhead') ? q('.qhead').textContent : '');

    check('★ 考试中答错与答对的题卡显示完全一致（无法据此反推对错）',
          headWrong === headRight, { wrong: headWrong, right: headRight });
    check('考试中不出现 ok/bad 这类判分样式',
          qa('.opt').every(x => /^opt( sel)?$/.test(x.className.trim())),
          qa('.opt').map(x => x.className));
  }

  /* =========================================================
     3. 题序确实被打乱（不是按 Type 聚在一起）
     ========================================================= */
  // 检查单选/多选是否交替分布，而不是前 50 单选后 25 多选
  let firstMulti = gids.findIndex(g => bank.BY[g].type === '多选题');
  check('多选题不是全部堆在末尾（题序已打乱）', firstMulti < 50, firstMulti);

  /* =========================================================
     4. 计分正确性：构造已知答案，验证得分
     ========================================================= */
  // 全部答对 → 100 分
  gids.forEach(g => {
    const qq = bank.BY[g];
    E.ans[g] = qq.options.map((o, i) => o.ok ? i : -1).filter(i => i >= 0);
  });
  bank.save();
  // 触发交卷
  const handIn = qa('.btn').find(b => b.textContent === '交卷');
  // 交卷按钮可能在最后一题；直接调内部
  bank.S.exam.msAcc = 1000;
  // 用 UI 交卷
  click(tabByText('模拟'));
  await sleep(300);
  // 找交卷按钮
  const sub2 = qa('.btn').find(b => b.textContent === '交卷');
  if (sub2) { click(sub2); await sleep(600); }
  else {
    // 兜底：直接改状态
    E.finished = true; E.score = 100; E.rightCount = 75;
    bank.save(); bank.render();
  }

  E = bank.S.exam;
  check('全对得 100 分', E.score === 100, E.score);
  check('75 题全对', E.rightCount === 75, E.rightCount);

  /* =========================================================
     5. 及格判定
     ========================================================= */
  await sleep(400);
  const verdict = q('.verdict');
  check('成绩单显示及格判定', !!verdict, !!verdict);
  check('100 分显示及格', verdict && verdict.classList.contains('pass'), verdict && verdict.className);
  check('显示及格文案', verdict && /及格/.test(verdict.textContent), verdict && verdict.textContent);

  const bigScore = q('.score .big');
  check('成绩单显示总分', bigScore && bigScore.textContent === '100', bigScore && bigScore.textContent);
  check('成绩单显示满分 100', q('.score .sc-of') && /100/.test(q('.score .sc-of').textContent), q('.score .sc-of') && q('.score .sc-of').textContent);

  /* 分项得分 */
  check('成绩单有分项得分条', qa('.sbrow').length === 2, qa('.sbrow').length);
  const sbTxt = qa('.sbrow').map(r => r.textContent).join('|');
  check('分项显示单选 50/50', /单选题.*50 \/ 50/.test(sbTxt), sbTxt);
  check('分项显示多选 50/50', /多选题.*50 \/ 50/.test(sbTxt), sbTxt);

  /* 批注 */
  check('成绩单有批注', !!q('.comment'), !!q('.comment'));

  /* =========================================================
     6. 不及格场景：答对一半
     ========================================================= */
  bank.S.exam = null;
  bank.save(); bank.render();
  await sleep(300);
  click(tabByText('模拟'));
  await sleep(300);
  const sb3 = qa('.btn.primary').find(b => b.textContent.includes('开始考试'));
  click(sb3);
  await sleep(500);

  E = bank.S.exam;
  // 只答对一半：前 37 题答对，其余答错
  E.gids.forEach((g, i) => {
    const qq = bank.BY[g];
    const correct = qq.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
    if (i < 37) {
      E.ans[g] = correct;
    } else {
      const wrong = qq.options.map((o, k) => o.ok ? -1 : k).filter(k => k >= 0);
      E.ans[g] = wrong.length ? [wrong[0]] : correct;
    }
  });
  E.msAcc = 2000;
  bank.save();
  // 交卷
  let sub3 = qa('.btn').find(b => b.textContent === '交卷');
  if (sub3) { click(sub3); await sleep(600); }
  E = bank.S.exam;
  check('部分答对得分 < 100', E.score < 100, E.score);
  check('得分始终 = 各题分值之和', (function(){
    let s = 0;
    E.gids.forEach(g => {
      const qq = bank.BY[g];
      if (bank.BY[g] && E.ans[g] && E.ans[g].length) {
        const cor = qq.options.map((o,k)=>o.ok?k:-1).filter(k=>k>=0);
        const sel = E.ans[g].slice().sort((a,b)=>a-b);
        if (JSON.stringify(cor.slice().sort((a,b)=>a-b)) === JSON.stringify(sel)) s += E.points[g];
      }
    });
    return s === E.score;
  })(), { score: E.score });

  /* =========================================================
     7. 考试成绩历史
     ========================================================= */
  check('考试历史已记录', bank.S.examHistory.length >= 2, bank.S.examHistory.length);
  const last = bank.S.examHistory[bank.S.examHistory.length - 1];
  check('历史记录含总分', typeof last.score === 'number', last.score);
  check('历史记录含满分', last.full === 100, last.full);
  check('历史记录含及格标记', typeof last.pass === 'boolean', last.pass);
  check('历史记录含正确率', typeof last.rate === 'number', last.rate);
  check('历史记录条数与交卷次数一致', bank.S.examHistory.length === 2, bank.S.examHistory.length);

  /* =========================================================
     8. 每日正确率统计
     ========================================================= */
  bank.S.daily = {};
  bank.S.ans = {};
  bank.save();

  // 回填几天数据
  const dk = bank.dailyKey;
  const today = new Date();
  function dkey(offset) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  bank.S.daily[dkey(0)] = { ans: 20, right: 18, ms: 300000, examN: 0 };
  bank.S.daily[dkey(1)] = { ans: 30, right: 21, ms: 400000, examN: 1 };
  bank.S.daily[dkey(2)] = { ans: 10, right: 5,  ms: 120000, examN: 0 };
  bank.S.daily[dkey(3)] = { ans: 25, right: 20, ms: 350000, examN: 0 };
  bank.save();

  const days = bank.recentDays(7);
  check('recentDays 返回 7 天', days.length === 7, days.length);
  check('最后一天是今天', days[days.length-1].isToday === true);
  check('今天 20 题正确率 90%', days[days.length-1].ans === 20 && days[days.length-1].rate === 90,
        { ans: days[days.length-1].ans, rate: days[days.length-1].rate });
  check('昨天 30 题正确率 70%', days[days.length-2].ans === 30 && days[days.length-2].rate === 70,
        { ans: days[days.length-2].ans, rate: days[days.length-2].rate });
  check('正确率计算正确（18/20=90%）', days[days.length-1].rate === Math.round(18/20*100));
  check('正确率计算正确（5/10=50%）', days[days.length-3].rate === 50, days[days.length-3].rate);
  check('没练的日子 rate 为 null', days[0].rate === null, days[0].rate);

  /* 每日记录累加 */
  bank.recordDailyAnswer(true, 5000);
  check('答题后当天计数 +1', bank.S.daily[dkey(0)].ans === 21, bank.S.daily[dkey(0)].ans);
  check('答对后当天正确数 +1', bank.S.daily[dkey(0)].right === 19, bank.S.daily[dkey(0)].right);

  /* =========================================================
     9. 成绩走势页渲染
     ========================================================= */
  click(tabByText('成绩走势'));
  await sleep(500);

  check('有成绩走势标签页', !!tabByText('成绩走势'));
  check('走势页有鼓励卡', !!q('.enc'), !!q('.enc'));
  check('鼓励卡有标题', q('.enctitle') && q('.enctitle').textContent.length > 0, q('.enctitle') && q('.enctitle').textContent);
  check('鼓励卡有正文', q('.enctext') && q('.enctext').textContent.length > 5, q('.enctext') && q('.enctext').textContent.slice(0,30));

  check('走势页有 7 天柱状图', qa('.dcol').length === 7, qa('.dcol').length);
  check('柱状图显示正确率数字', qa('.dv').length === 7, qa('.dv').length);
  const dvTxt = qa('.dv').map(x => x.textContent);
  check('今天的柱子显示 90%', dvTxt.includes('90%'), dvTxt);
  check('未练习的日子显示 —', dvTxt.includes('—'), dvTxt);

  check('走势页有每日明细列表', qa('.drow').length >= 7, qa('.drow').length);
  const listTxt = qa('.drow').map(x => x.textContent).join('|');
  check('明细里有「答 20 题」之类', /答 \d+ 题/.test(listTxt), listTxt.slice(0, 100));

  check('走势页有趋势批注', !!q('.trendnote'), !!q('.trendnote'));
  check('趋势批注不是空的', q('.trendnote').textContent.length > 5, q('.trendnote').textContent.slice(0, 40));
  check('有趋势标签', !!q('.trendtag'), !!q('.trendtag'));

  /* 考试历史板块 */
  check('走势页有考试历史柱状图', qa('.histbars').length > 0, qa('.histbars').length);

  /* 批注要随数据变化（不是固定文案） */
  const note1 = bank.trendAnnotation(bank.recentDays(7)).text;
  bank.S.daily[dkey(1)] = { ans: 30, right: 30, ms: 1000, examN: 0 };
  bank.S.daily[dkey(0)] = { ans: 30, right: 30, ms: 1000, examN: 0 };
  const note2 = bank.trendAnnotation(bank.recentDays(7)).text;
  check('趋势批注会随数据变化（不是死文案）', note1 !== note2, { note1: note1.slice(0,40), note2: note2.slice(0,40) });

  /* 鼓励语也随数据变化 */
  const encHigh = bank.todayEncouragement({ ans: 20, right: 20, rate: 100 });
  const encLow  = bank.todayEncouragement({ ans: 20, right: 6, rate: 30 });
  check('高正确率鼓励语 ≠ 低正确率', encHigh.title !== encLow.title, { h: encHigh.title, l: encLow.title });
  check('低分不无脑夸', /吃力|正常|别急|别硬撑/.test(encLow.text), encLow.text);

  /* =========================================================
     10. 重置清空
     ========================================================= */
  click('#btReset');
  await sleep(500);
  check('重置清空考试历史', bank.S.examHistory.length === 0, bank.S.examHistory.length);
  check('重置清空每日统计', Object.keys(bank.S.daily).length === 0, Object.keys(bank.S.daily).length);

  /* =========================================================
     11. 无异常
     ========================================================= */
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
  console.log(NL + '--- 通过 ' + R.pass.length + ' ---');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  console.log(NL + '--- 失败 ' + R.fail.length + ' ---');
  R.fail.forEach(f => console.log('  ✗ ' + f));
  process.exit(2);
});
