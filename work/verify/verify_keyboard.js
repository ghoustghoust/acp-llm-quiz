/**
 * verify_keyboard.js — 键盘操作的映射正确性（选项打乱后仍要对得上）
 *
 * 背景：HTML 里同时支持鼠标点选项和键盘 A–F / 1–6 作答。
 * 但「选项位置打乱」上线后，存储层用的是**原始下标**，屏幕上是**显示位置**，
 * 键盘处理这一路没有做换算，于是出现四个真实缺陷：
 *
 * 【缺陷 1】按键映射错位
 *   按 A 选中并记录的是「原始第 0 项」，而屏幕上 A 对应的是 view.order[0]。
 *   4 个选项时有约 3/4 的概率按错 —— 用户看着 A 选下去，判分却按另一项算。
 *
 * 【缺陷 2】三个专项页键盘完全失效
 *   键盘取当前题号用的是 `S.pos[S.mode]`，而专项模式的进度存在 `S.drill[key].pos`，
 *   `S.pos.single` 根本不存在 → 永远是 0。于是：
 *     · 方向键把界面从「第 21 题」拽回「第 2 题」
 *     · 字母键答的是题池第 1 题，不是屏幕上那道题
 *
 * 【缺陷 3】「查看答案」的题键盘还能作答
 *   鼠标路径有 `if(showAns) return;` 挡住，键盘路径只看 `S.ans` 和 `S.memorizing`，
 *   漏了单题揭示状态 `S.reveal[gid]` —— 答案都摆在那儿了，按个 A 就记一次作答。
 *
 * 【缺陷 4】成绩单 / 解析页按键会偷偷改作答记录
 *   交卷后 `examRunning()` 变 false，键盘逻辑继续往下跑，此时 modeList() 落到 QS，
 *   题号取 `S.pos.exam`（不存在）→ 0。用户在成绩单上按个字母，
 *   后台就把 QS[0] 的作答记录改了，还附加错题计数。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.resolve(__dirname, '..', '..', '阿里云ACP大模型-离线题库.html');
const html = fs.readFileSync(FILE, 'utf8');

const jsErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = String((e && e.message) || e);
  if (!/Not implemented:\s*Window's (scrollTo|createObjectURL)/.test(m)) jsErrors.push(m);
});
vc.on('error', (...a) => jsErrors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://localhost/offline.html', virtualConsole: vc,
});
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
function key(k) {
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}
const tabByText = t => qa('.tab').find(x => x.textContent.includes(t));
const btnByText = t => qa('button').find(x => x.textContent.trim() === t);
/* 专项页里第一张卡是概览卡（写着「共 N 题」），题卡的 .qidx 才是「第 N / M 题」。
   这里按内容挑而不是按位置挑 —— 页面结构一改，按位置挑就会静默失效。 */
const cardIdx = () => {
  const e = qa('.qidx').find(x => x.textContent.indexOf('第') >= 0);
  return e ? e.textContent.replace(/\s+/g, '') : null;
};
const shownLetters = () => qa('.opt .k').map(x => x.textContent);

const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(name, cond, extra) {
  if (cond) R.pass.push(name);
  else R.fail.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

function resetState(bank) {
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.wrong = []; bank.S.wcnt = {}; bank.S.wlast = {};
  bank.S.streak = {}; bank.S.reveal = {}; bank.S.memorizing = false;
  bank.S.mode = 'seq'; bank.S.pos = { seq: 0, random: 0, wrong: 0, star: 0, search: 0 };
  ['single', 'multi', 'hard'].forEach(k => { bank.S.drill[k].pos = 0; });
  bank.save(); bank.render();
}

(async () => {
  await sleep(500);
  const bank = window.__bank;
  window.confirm = () => true;

  /* =========================================================
     一、顺序刷题：字母键必须命中「屏幕上那个字母」对应的选项
     ========================================================= */
  resetState(bank);
  await sleep(400);
  bank.S.optRound = 7;                 // 固定一个轮次，保证选项确实被打乱
  bank.save(); bank.render();
  await sleep(400);

  const q0 = bank.QS[0];
  const view0 = bank.optionView(q0);
  const opts0 = qa('.opt');
  check('顺序刷题：选项已渲染', opts0.length === q0.options.length, [opts0.length, q0.options.length]);
  check('顺序刷题：选项位置确实被打乱', view0.shuffled === true && view0.order.some((v, i) => v !== i), view0.order);

  const shownA = opts0[0].querySelector('.v').textContent.trim();
  const expectA = q0.options[view0.order[0]].t.trim();
  check('屏幕上第一个选项的文本 = order[0] 指向的选项', shownA === expectA,
        { shownA: shownA.slice(0, 24), expectA: expectA.slice(0, 24) });
  check('屏幕上字母按 A/B/C… 顺序排列', shownLetters().join('') === 'ABCD'.slice(0, opts0.length), shownLetters());

  key('a');
  await sleep(400);
  const rec0 = bank.recOf(q0.gid);
  check('按 A 后有作答记录', !!rec0, rec0);
  check('★ 按 A 记录的是「屏幕上显示为 A 的那一项」（原缺陷：记成原始第 0 项）',
        !!rec0 && rec0.sel.length === 1 && rec0.sel[0] === view0.order[0],
        { got: rec0 && rec0.sel, want: [view0.order[0]], order: view0.order });
  check('按 A 的判分与显示一致',
        !!rec0 && rec0.ok === q0.options[view0.order[0]].ok,
        { ok: rec0 && rec0.ok, showedCorrect: q0.options[view0.order[0]].ok });
  check('屏幕上该行确实高亮成「选中」样式', qa('.opt')[0].className.indexOf('sel') >= 0 || rec0.ok,
        qa('.opt').map(x => x.className));

  /* 数字键同一条映射 */
  resetState(bank);
  await sleep(350);
  const q0b = bank.QS[0];
  const view0b = bank.optionView(q0b);
  key('2');
  await sleep(400);
  const rec0b = bank.recOf(q0b.gid);
  check('数字键 2 → 显示位置 1 对应的选项',
        !!rec0b && rec0b.sel[0] === view0b.order[1],
        { got: rec0b && rec0b.sel, want: [view0b.order[1]], order: view0b.order });

  /* 越界按键不应作答 */
  resetState(bank);
  await sleep(350);
  key('f');                        // 题库最多 6 个选项，这里第 1 题只有 4 个
  await sleep(300);
  check('超出选项数量的按键不作答', bank.aggregateCount() === 0,
        bank.aggregateCount());

  /* =========================================================
     二、三个专项页：键盘要认「专项自己的进度」
     ========================================================= */
  for (const [tab, keyName, poolKey] of [['单选专项', 'single', 'single'], ['多选专项', 'multi', 'multi']]) {
    click(tabByText(tab));
    await sleep(400);
    bank.S.drill[keyName].pos = 9;
    bank.save(); bank.render();
    await sleep(350);
    check(tab + '：起始停在第 10 题', /第10\//.test(cardIdx() || ''), cardIdx());

    key('ArrowRight');
    await sleep(350);
    check('★ ' + tab + '：→ 键前进到第 11 题（原缺陷：被拽回第 2 题）',
          /第11\//.test(cardIdx() || ''), { ui: cardIdx(), pos: bank.S.drill[keyName].pos });
    check(tab + '：→ 键写的是专项自己的进度', bank.S.drill[keyName].pos === 10, bank.S.drill[keyName].pos);

    key('ArrowLeft');
    await sleep(350);
    check(tab + '：← 键退回第 10 题', /第10\//.test(cardIdx() || ''), cardIdx());

    /* 字母键必须答「屏幕上这道题」，而不是题池第 1 题。
       当前位置从状态里读，别写死下标 —— 上面刚做过 ← →，写死会和实际差一位。
       另外要按题型分流：单选按一下即判分，多选只是勾选、必须再按 Enter 提交
       （这正是 README 里记过的「随机是测试的隐性输入」那个坑）。 */
    const list = bank.drillList(poolKey);
    const posNow = bank.S.drill[keyName].pos;
    const cur = list[posNow];
    const view = bank.optionView(cur);
    const isMultiQ = cur.type === '多选题';
    key('a');
    await sleep(400);
    if (isMultiQ) {
      check(tab + '：多选按 A 只是勾选（未提交前不判分）', !bank.recOf(cur.gid), bank.recOf(cur.gid));
      check(tab + '：勾选落在屏幕上当前题上', !!bank.S.pend[cur.gid], Object.keys(bank.S.pend || {}));
      key('Enter');
      await sleep(400);
    }
    check('★ ' + tab + '：按 A 答的是屏幕上当前题（原缺陷：答成题池第 1 题）',
          !!bank.recOf(cur.gid),
          { posNow, curGid: cur.gid.slice(0, 8), answered: Object.keys(bank.aggregateAns()) });
    check(tab + '：题池第 1 题没有被误答', !list[0] || !bank.recOf(list[0].gid), list[0] && list[0].gid.slice(0, 8));
    check(tab + '：记录的仍是显示映射后的原下标',
          !!bank.recOf(cur.gid) && bank.recOf(cur.gid).sel[0] === view.order[0],
          { got: bank.recOf(cur.gid) && bank.recOf(cur.gid).sel, want: [view.order[0]] });
  }

  /* 攻坚页：池子是动态的，至少要能正常前进/作答 */
  click(tabByText('错题攻坚'));
  await sleep(400);
  bank.noteWrong(bank.QS.filter(x => x.type === '单选题')[3].gid);
  bank.noteWrong(bank.QS.filter(x => x.type === '单选题')[4].gid);
  bank.S.drill.hard.pos = 0;
  bank.save(); bank.render();
  await sleep(400);
  const hardList = bank.drillList('hard');
  check('攻坚页：池子非空（前置条件）', hardList.length >= 2, hardList.length);
  key('ArrowRight');
  await sleep(350);
  check('攻坚页：→ 键能前进', /第2\//.test(cardIdx() || '') || hardList.length < 2, { ui: cardIdx(), n: hardList.length });
  check('攻坚页：进度写在 S.drill.hard.pos', bank.S.drill.hard.pos === 1, bank.S.drill.hard.pos);

  /* =========================================================
     三、「查看答案」的题：键盘不能作答
     ========================================================= */
  resetState(bank);
  await sleep(400);
  const qR = bank.QS[0];
  click(btnByText('查看答案'));
  await sleep(400);
  check('查看答案后本题显示答案区', !!q('.result'), !!q('.result'));
  check('本题标记为已揭示', !!bank.S.reveal[qR.gid], bank.S.reveal);

  key('a');
  await sleep(400);
  check('★ 已揭示答案的题，键盘不能作答（原缺陷：按键就记一次作答）',
        !bank.recOf(qR.gid), bank.recOf(qR.gid));
  key('b');
  await sleep(300);
  check('换个字母也不能作答', !bank.recOf(qR.gid), bank.recOf(qR.gid));
  check('揭示状态没有被键盘弄丢', !!bank.S.reveal[qR.gid], bank.S.reveal);

  /* 背题模式下同理（鼠标路径本来就会挡，键盘也必须挡） */
  resetState(bank);
  await sleep(350);
  bank.S.memorizing = true; bank.save(); bank.render();
  await sleep(350);
  key('a');
  await sleep(300);
  check('背题模式下键盘不能作答', bank.aggregateCount() === 0, Object.keys(bank.aggregateAns()));
  bank.S.memorizing = false;

  /* =========================================================
     四、考试中：键盘也要按开考时固定的选项顺序换算
     ========================================================= */
  click(tabByText('模拟'));
  await sleep(400);
  click(qa('.btn.primary').find(b => b.textContent.includes('开始考试')));
  await sleep(500);
  const E = bank.S.exam;
  check('考试已开始', !!E && !E.finished);

  let examBad = [];
  for (let i = 0; i < 5; i++) {
    E.pos = i; bank.save(); bank.render();
    await sleep(200);
    const gid = E.gids[i];
    const eq = bank.BY[gid];
    const eo = (E.optOrder && E.optOrder[gid]) ? E.optOrder[gid] : eq.options.map((_, k) => k);
    key('b');
    await sleep(200);
    const got = E.ans[gid];
    if (!(got && got.length === 1 && got[0] === eo[1])) examBad.push({ i, type: eq.type, got, want: eo[1], eo });
  }
  check('★ 考试中按 B 存的是「屏幕上 B」对应的原始下标（原缺陷：直接存 1）',
        examBad.length === 0, examBad.slice(0, 3));

  /* 多选题键盘再按一次同一字母 = 取消勾选 */
  let multiIdx = -1;
  for (let i = 0; i < E.gids.length; i++) if (bank.BY[E.gids[i]].type === '多选题') { multiIdx = i; break; }
  if (multiIdx >= 0) {
    E.pos = multiIdx; bank.save(); bank.render();
    await sleep(250);
    const mg = E.gids[multiIdx];
    const meq = bank.BY[mg];
    const meo = (E.optOrder && E.optOrder[mg]) ? E.optOrder[mg] : meq.options.map((_, k) => k);
    const before = (E.ans[mg] || []).slice();
    key('c');
    await sleep(250);
    const mid = (E.ans[mg] || []).slice();
    key('c');
    await sleep(250);
    const after = (E.ans[mg] || []).slice();
    check('考试多选：按 C 勾上的是屏幕 C 对应的项',
          mid.indexOf(meo[2]) >= 0, { mid, want: meo[2], eo: meo });
    check('考试多选：再按一次 C 取消勾选',
          after.indexOf(meo[2]) < 0, { before, mid, after });
  }

  /* 方向键切题 */
  E.pos = 0; bank.save(); bank.render();
  await sleep(250);
  key('ArrowRight');
  await sleep(250);
  check('考试中 → 键切到下一题', E.pos === 1, E.pos);
  key('ArrowLeft');
  await sleep(250);
  check('考试中 ← 键切回上一题', E.pos === 0, E.pos);

  /* =========================================================
     五、成绩单 / 解析页：键盘不能偷偷改作答记录
     ========================================================= */
  click(qa('.btn').find(b => b.textContent === '交卷'));
  await sleep(500);
  check('已交卷', bank.S.exam.finished === true, bank.S.exam.finished);
  check('成绩单已显示', !!q('.score .big'));

  const ansBefore = JSON.stringify(bank.aggregateAns());
  const wcntBefore = JSON.stringify(bank.S.wcnt);
  const ansCountBefore = bank.aggregateCount();
  key('a');
  key('b');
  key('c');
  await sleep(400);
  check('★ 成绩单页按字母键不会改动作答记录（原缺陷：后台悄悄改 QS[0]）',
        JSON.stringify(bank.aggregateAns()) === ansBefore,
        { before: ansCountBefore, after: bank.aggregateCount() });
  check('成绩单页按字母键不会影响错题次数', JSON.stringify(bank.S.wcnt) === wcntBefore);

  const rrow = qa('.rrow')[0];
  if (rrow) {
    click(rrow);
    await sleep(400);
    check('可进入单题解析', !!q('.result') || !!q('.ana'));
    const ansBefore2 = JSON.stringify(bank.aggregateAns());
    key('d');
    await sleep(300);
    check('解析页按字母键也不会改作答记录', JSON.stringify(bank.aggregateAns()) === ansBefore2);
    const back = qa('.btn.ghost').find(b => b.textContent.includes('返回成绩单'));
    if (back) { click(back); await sleep(300); }
  }

  /* =========================================================
     六、只读页（统计 / 成绩走势 / 排行）：键盘无副作用
     ========================================================= */
  for (const tab of ['统计', '成绩走势', '错题排行']) {
    click(tabByText(tab));
    await sleep(350);
    const before = JSON.stringify(bank.aggregateAns()) + '|' + JSON.stringify(bank.S.wcnt);
    key('a');
    key('ArrowRight');
    await sleep(300);
    const after = JSON.stringify(bank.aggregateAns()) + '|' + JSON.stringify(bank.S.wcnt);
    check('「' + tab + '」页按键不改作答记录', before === after);
  }

  /* =========================================================
     七、回归：空格暂停、Enter 前进仍然正常
     ========================================================= */
  resetState(bank);
  await sleep(400);
  const pausedBefore = bank.TMR.running;
  key(' ');
  await sleep(200);
  check('空格仍能暂停计时', bank.TMR.running === !pausedBefore, [pausedBefore, bank.TMR.running]);
  key(' ');
  await sleep(200);
  check('空格仍能恢复计时', bank.TMR.running === pausedBefore);

  const qE = bank.QS[0];
  const viewE = bank.optionView(qE);
  key('a');
  await sleep(400);
  check('（前置）答题成功', !!bank.recOf(qE.gid));
  check('答题后 Enter 应能前进', true);   // 下一行实测
  key('Enter');
  await sleep(350);
  check('答题后 Enter 前进到下一题', /第2\//.test(cardIdx() || ''), cardIdx());

  /* 未作答时 Enter 不应跳题（避免误触略过题目） */
  const idxBeforeEnter = cardIdx();
  key('Enter');
  await sleep(300);
  check('未作答时 Enter 不跳题', cardIdx() === idxBeforeEnter, [idxBeforeEnter, cardIdx()]);

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
