/**
 * verify_exam_no_peek.js — 模拟考试过程中不能泄露「这题对不对」
 *
 * 【用户报的问题】
 *   「模拟考试直接能看到估分」—— 更准确地说：
 *   考试中每选一个选项，题卡右上角的「约 X 分」立刻变化。
 *   选对了分数涨，选错了分数不动 —— 这等于**当场判卷**。
 *
 *   多选题更明显：每题 2 分，数字跳 0 或 2 一目了然。
 *   考生只要每题答完看一眼分数，就知道该不该改答案，模拟考试完全失去意义。
 *
 * 【模拟考试应该是什么样】
 *   考试期间：只告诉考生「还剩多少时间、已答几题、本题几分」，
 *   **绝不给任何对错反馈**。对错要等交卷后统一判。
 *
 *   这是模拟考试和练习模式的根本区别：
 *   练习模式要求即时反馈（答完立刻看解析，这是学习）；
 *   考试模式要求延迟反馈（不然就是「边考边对答案」，考不出真实水平）。
 *
 * 【要守住的三条】
 *   1. 考试中不能出现任何得分/估分/正确率数字
 *   2. 考试中不能出现「答对/答错」样式或文案（.result / .ana 都不该有）
 *   3. 考试中改动答案不能影响任何可见的统计数字
 *      （否则用「改一次答案看数字变不变」也能反推）
 *
 * 交卷之后必须一切照旧：成绩单、逐题解析、成绩走势全都正常显示。
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
const examHead = () => (q('.qhead') ? q('.qhead').textContent.replace(/\s+/g, ' ') : '');

const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(name, cond, extra) {
  if (cond) R.pass.push(name);
  else R.fail.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

/** 当前考题的显示顺序（考试用开考时固定的 optOrder） */
function examOrder(bank) {
  const E = bank.S.exam;
  const gid = E.gids[E.pos];
  return (E.optOrder && E.optOrder[gid]) ? E.optOrder[gid].slice()
                                         : bank.BY[gid].options.map((_, i) => i);
}
/** 按原始下标点考试里的选项 */
function clickExamOrig(bank, origIdx) {
  const disp = examOrder(bank).indexOf(origIdx);
  if (disp < 0) throw new Error('考试选项未渲染: ' + origIdx);
  click(qa('.opt')[disp]);
}

/* ⚠️ 题库里有 7 道多选题是「所有选项都是正确答案」，
   还有 2 道单选题属于「以上所有」这类不能打乱的题。
   所以「找一个错误选项」这一步可能返回 -1 —— 那不是 bug，是数据本身如此。
   下面两个辅助函数遇到这种题会返回 false，让调用方换一题，
   而不是硬点 -1 把测试崩掉（这正是第一次跑全量时 FATAL 的原因）。 */
function hasWrongOption(bank, qq) {
  return qq.options.some(o => !o.ok);
}

/** 把当前考题改成「正确答案」；返回 false 表示这题没法构造对答案 */
async function answerCurrentCorrect(bank) {
  const E = bank.S.exam;
  const gid = E.gids[E.pos];
  const qq = bank.BY[gid];
  const was = (E.ans[gid] || []).slice();
  if (qq.type === '多选题') {
    was.forEach(oi => clickExamOrig(bank, oi));
    await sleep(120);
    qq.options.forEach((o, oi) => { if (o.ok) clickExamOrig(bank, oi); });
  } else {
    const okIdx = qq.options.findIndex(o => o.ok);
    if (okIdx < 0) return false;
    clickExamOrig(bank, okIdx);
  }
  await sleep(250);
  return true;
}

/** 把当前考题改成「错误答案」；返回 false 表示这题没有错误选项可点 */
async function answerCurrentWrong(bank) {
  const E = bank.S.exam;
  const gid = E.gids[E.pos];
  const qq = bank.BY[gid];
  const was = (E.ans[gid] || []).slice();
  const wrongIdx = qq.options.findIndex(o => !o.ok);
  if (wrongIdx < 0) return false;       /* 全对题：构造不出错误答案 */
  if (qq.type === '多选题') {
    was.forEach(oi => clickExamOrig(bank, oi));
    await sleep(120);
    clickExamOrig(bank, wrongIdx);
  } else {
    clickExamOrig(bank, wrongIdx);
  }
  await sleep(250);
  return true;
}

/** 切到一道「既能答错、也能答对」的题（避开全对题和单选答案题） */
async function gotoComparableQuestion(bank) {
  const E = bank.S.exam;
  for (let i = 0; i < E.gids.length; i++) {
    const qq = bank.BY[E.gids[i]];
    if (!qq) continue;
    const hasOk = qq.options.some(o => o.ok);
    const hasBad = qq.options.some(o => !o.ok);
    if (hasOk && hasBad) {
      E.pos = i;
      bank.save(); bank.render();
      await sleep(250);
      return true;
    }
  }
  return false;
}
const startExam = async () => {
  click(tabByText('模拟'));
  await sleep(400);
  const btn = qa('.btn.primary').find(b => b.textContent.includes('开始考试'));
  if (!btn) throw new Error('找不到开始考试按钮');
  click(btn);
  await sleep(600);
};
/** 页面上所有可见文本（用来搜「分」「正确率」这类字眼） */
const examCardText = () => {
  const cards = qa('.card');
  return cards.map(c => c.textContent.replace(/\s+/g, ' ')).join(' || ');
};

(async () => {
  await sleep(450);
  const bank = window.__bank;
  window.confirm = () => true;

  /* =========================================================
     一、考试中：题卡上不能出现任何得分/估分
     ========================================================= */
  bank.S.ans = {}; window.confirm = () => true;
  await startExam();
  check('考试已开始', !!bank.S.exam && !bank.S.exam.finished);

  const headBefore = examHead();
  check('考试中题卡显示题号', /第\s*\d+\s*\/\s*75\s*题/.test(headBefore), headBefore.slice(0, 100));
  check('考试中题卡显示「已答 x/75」', /已答\s*\d+\s*\/\s*75/.test(headBefore), headBefore.slice(0, 120));
  check('考试中题卡显示本题分值', !!q('.ptbadge'), q('.ptbadge') && q('.ptbadge').textContent);

  check('★ 未作答时没有「约 X 分」估分', !/约\s*\d+\s*分/.test(headBefore), headBefore);
  check('★ 未作答时题卡里没有「分」字样（除本题分值角标外）',
        (examCardText().match(/\d+\s*分/g) || []).every(t => /^\d+\s*分$/.test(t.trim())),
        (examCardText().match(/[^ ]*\d+\s*分[^ ]*/g) || []).slice(0, 6));

  /* =========================================================
     二、核心：答错 vs 答对，题卡显示必须完全一样
     ========================================================= */
  const E = bank.S.exam;

  /* 先切到一道「既能答错也能答对」的题。
     题库里有 7 道多选题是所有选项都正确，那种题构造不出错误答案 ——
     不是 bug，是数据本身如此，换一题即可。 */
  const gotComparable = await gotoComparableQuestion(bank);
  check('找到一个既可答错也可答对的题（前置条件）', gotComparable);

  /* --- 先答错 --- */
  const madeWrong = await answerCurrentWrong(bank);
  check('已构造出一个错误答案（前置条件）', madeWrong);
  const headWrong = examHead();
  const cardWrong = examCardText();
  const optClsWrong = qa('.opt').map(x => x.className).join('|');

  check('答错后不显示结果块（考试中不判卷）', !q('.result'), !!q('.result'));
  check('答错后不显示解析', !q('.ana'), !!q('.ana'));
  check('答错后题卡里没有「答对/答错」字样',
        !/回答正确|回答错误|答对|答错/.test(examCardText()),
        /回答正确|回答错误|答对|答错/.exec(examCardText()) &&
        /回答正确|回答错误|答对|答错/.exec(examCardText())[0]);
  check('★ 答错后题卡没有得分数字', !/约\s*\d+\s*分/.test(headWrong), headWrong);

  /* --- 再改成答对 --- */
  const madeRight = await answerCurrentCorrect(bank);
  check('已构造出一个正确答案（前置条件）', madeRight);
  const headRight = examHead();
  const cardRight = examCardText();

  /* 把「本题计时」和「已答」这两个会自然变化的数字抹掉再比较 */
  const norm = s => s
    .replace(/本题\s*[\d:]+/g, '本题 _')
    .replace(/剩余\s*[\d:]+/g, '剩余 _')
    .replace(/今日\s*[\d:]+/g, '今日 _')
    .replace(/本次\s*[\d:]+/g, '本次 _')
    .replace(/\s+/g, ' ');

  check('★ 答错与答对时，题卡头部显示完全一致（不泄露对错）',
        norm(headWrong) === norm(headRight),
        { wrong: norm(headWrong), right: norm(headRight) });
  check('★ 答错与答对时，整张考卷卡片文本完全一致',
        norm(cardWrong) === norm(cardRight),
        { wrongLen: cardWrong.length, rightLen: cardRight.length });

  /* 选项样式只允许反映「选中没选中」，不允许反应对错 */
  const optClsRight = qa('.opt').map(x => x.className).join('|');
  const onlySelOrPlain = qa('.opt').every(x =>
    /^opt( sel)?$/.test(x.className.trim()));
  check('★ 选项样式只有 opt / opt sel 两种（没有 ok / bad / locked 这些判分样式）',
        onlySelOrPlain, qa('.opt').map(x => x.className));

  /* =========================================================
     三、反复改动答案，可见数字一个都不能动
     ========================================================= */
  const visibleNums = () => {
    /* 把题卡和顶栏里所有数字抓出来（抹掉计时类，那些本来就在走） */
    const txt = (examCardText() + ' || ' + (q('header') ? q('header').textContent : ''))
      .replace(/[\d:]{1,2}:[\d:]{1,2}(:[\d:]{1,2})?/g, 'T');   // 时间戳
    return (txt.match(/-?\d+/g) || []).join(',');
  };
  await sleep(300);
  const nums1 = visibleNums();
  for (let i = 0; i < 3; i++) {
    /* 每次先确保停在可比较的题上（全对题没法构造错误答案）。
       如果找不到（理论上 75 题里不可能全是全对题，但不能假设），就跳过一次，
       而不是硬在「没有错误选项」的题上点 -1。 */
    const okPos = await gotoComparableQuestion(bank);
    if (!okPos) break;
    await answerCurrentWrong(bank);
    await answerCurrentCorrect(bank);
  }
  await sleep(300);
  const nums2 = visibleNums();
  check('★ 来回改 3 次答案，页面上可见的数字没有任何变化（无法反推对错）',
        nums1 === nums2, { before: nums1, after: nums2 });

  /* =========================================================
     四、考试中不能跳去看解析/成绩单
     ========================================================= */
  check('考试中不显示成绩单', !q('.score .big'), q('.score') && q('.score').textContent);
  check('考试中不显示及格判定', !q('.verdict'), !!q('.verdict'));

  /* =========================================================
     五、交卷之后：一切照旧，成绩与解析都要有
     ========================================================= */
  const sub = qa('.btn').find(b => b.textContent === '交卷');
  check('有交卷按钮', !!sub);
  click(sub);
  await sleep(600);

  check('交卷后考试结束', bank.S.exam.finished === true, bank.S.exam.finished);
  check('交卷后出现成绩单总分', !!q('.score .big'), !!q('.score .big'));
  check('交卷后出现及格判定', !!q('.verdict'), !!q('.verdict'));
  const scoreTxt = q('.score') ? q('.score').textContent.replace(/\s+/g, ' ') : '';
  check('成绩单显示「X / 100 分」', /\/\s*100\s*分/.test(scoreTxt), scoreTxt);
  check('交卷后出现逐题解析入口', qa('.rrow').length > 0, qa('.rrow').length);
  check('成绩单里有正确率统计', /正确率/.test(examCardText()), examCardText().slice(0, 120));

  /* 点开一题看解析，此刻必须给反馈 */
  if (qa('.rrow').length) {
    click(qa('.rrow')[0]);
    await sleep(450);
    check('考后点开单题能看到解析', !!q('.ana'), !!q('.ana'));
    check('考后单题显示「回答正确/错误」判定',
          /回答正确|回答错误/.test(examCardText()),
          /回答正确|回答错误/.exec(examCardText()) &&
          /回答正确|回答错误/.exec(examCardText())[0]);
    const back = qa('.btn.ghost').find(b => b.textContent.includes('返回成绩单'));
    if (back) { click(back); await sleep(350); }
  }

  /* =========================================================
     六、练习模式仍然要即时反馈（别把考试的限制误伤到练习）
     ========================================================= */
  bank.S.exam = null; bank.S.examReview = null;
  bank.S.mode = 'seq'; bank.S.pos.seq = 0; bank.S.ans = {}; bank.S.reveal = {};
  bank.save(); bank.render();
  await sleep(400);

  const pq = bank.QS[0];
  const porder = bank.optionView(pq).order;
  click(qa('.opt')[porder.indexOf(pq.options.findIndex(o => !o.ok))]);
  await sleep(400);
  check('练习模式答完立刻显示结果块', !!q('.result'), !!q('.result'));
  check('练习模式答完立刻显示解析', !!q('.ana'), !!q('.ana'));
  check('练习模式显示「回答正确/错误」', /回答正确|回答错误/.test(examCardText()),
        /回答正确|回答错误/.exec(examCardText()));

  /* =========================================================
     七、紧接着开第二场考试：同样是「不判卷」状态
     ========================================================= */
  await startExam();
  check('第二场考试已开始', !!bank.S.exam && !bank.S.exam.finished);
  const head2 = examHead();
  check('★ 第二场考试中依然没有估分', !/约\s*\d+\s*分/.test(head2), head2);
  check('第二场考试中没有上一场的残留结果块', !q('.result'), !!q('.result'));

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
  console.log(NL + '--- 通过 ' + R.pass.length + ' / 失败 ' + R.fail.length + ' ---');
  R.fail.forEach(f => console.log('  ✗ ' + f));
  process.exit(2);
});
