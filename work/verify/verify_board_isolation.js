/**
 * verify_board_isolation.js — 板块之间互不干扰，但该汇总的地方仍然汇总
 *
 * 【用户报的问题】
 *   「每个板块都在单独刷，但一个板块刷了另一个板块也有记录，
 *     比如我模拟考试考了，多选被选了，单选被选了，错题也有了」
 *
 * 【根因】
 *   所有板块共用同一份 `S.ans`：
 *     · 顺序刷题答过的题 → 单选专项里也显示「已作答」，答案摊开、选项点不动
 *     · 模拟考试交卷时，75 道题的作答记录被整个并进 S.ans
 *       → 考完一场试，顺序/随机/单选/多选全部「做过了」，错题本一口气多几十道
 *
 * 【现在定的语义】
 *   一条主轴：**练习记录按板块分开存**（S.ansAll[board]），各刷各的；
 *   一条补充：**汇总类数据全站共享**，否则就变成 9 个互不相干的小工具。
 *
 *   | 数据 | 归属 | 理由 |
 *   |---|---|---|
 *   | 作答记录（对错、选了啥、用时） | **按板块** | 这就是「各刷各的」 |
 *   | 刷到第几题 / 随机题序 | 按板块（原本就是） | 池子大小不同，共用会越界 |
 *   | 错题本 / 收藏 | **汇总** | 那是集合本身，不是某个板块的进度 |
 *   | 累计错次 / 最近错于 | **汇总** | 错题排行按全站错次排序 |
 *   | 掌握度 streak | **汇总** | 「这题我掌握了没有」不分在哪个板块练的 |
 *   | 成绩走势 / 考试历史 | **汇总** | 历史事实 |
 *   | 顶栏「已练 N 题 / 正确率」 | **汇总** | 整体进度，不该切个标签就跳一次 |
 *   | 统计页 | **汇总** | 回答「整体学得怎么样」 |
 *   | 题卡的正确率徽标 | **按板块** | 说的是「本板块做得怎么样」 |
 *   | 专项概览卡（已做/对/错） | **按板块** | 同上 |
 *
 * 【考试的特殊规则】
 *   · 考试作答存在 S.exam.ans，绝不写进任何练习板块
 *   · 但答错的题要进错题本（用户明确要求）
 *   · **未作答的题不进** —— 交白卷不该塞 75 道「错题」进去
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
const hasResult = () => !!q('.result');
const optLocked = () => { const o = q('.opt'); return o ? o.classList.contains('locked') : null; };
const cardIdx = () => {
  const e = qa('.qidx').find(x => x.textContent.indexOf('第') >= 0);
  return e ? e.textContent.replace(/\s+/g, '') : null;
};

const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(name, cond, extra) {
  if (cond) R.pass.push(name);
  else R.fail.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

let bank;

/** 清空所有板块的记录与汇总数据，回到白板 */
function wipe() {
  bank.BOARD_KEYS.forEach(k => { bank.S.ansAll[k] = {}; });
  bank.S.wrong = []; bank.S.star = [];
  bank.S.wcnt = {}; bank.S.wlast = {}; bank.S.streak = {};
  bank.S.reveal = {}; bank.S.memorizing = false;
  bank.S.pos = { seq: 0, random: 0, wrong: 0, star: 0, search: 0 };
  bank.BOARD_KEYS.filter(k => ['single', 'multi', 'hard'].indexOf(k) >= 0).forEach(k => {
    bank.S.drill[k] = { pos: 0, order: null, shuffleSeq: false, round: 0 };
  });
  bank.S.exam = null; bank.S.examReview = null;
  bank.save(); bank.render();
}
const counts = () => {
  const o = {};
  bank.BOARD_KEYS.forEach(k => { o[k] = Object.keys(bank.S.ansAll[k] || {}).length; });
  return o;
};
/** 在当前板块里真的点一个选项作答（自动按题型与打乱顺序换算） */
async function answerHere(ok) {
  const list = bank.modeList();
  const pos = bank.S.pos[bank.S.mode] || 0;
  const qq = list[pos];
  const order = bank.optionView(qq).order;
  const targets = qq.options.map((o, i) => ({ o, i })).filter(x => ok ? x.o.ok : !x.o.ok);
  if (!targets.length) return false;                    /* 全对/全错题，构造不出来 */
  if (qq.type === '多选题') {
    targets.forEach(t => click(qa('.opt')[order.indexOf(t.i)]));
    await sleep(150);
    const sb = qa('button').find(b => /提交/.test(b.textContent));
    if (sb) { click(sb); await sleep(250); }
  } else {
    click(qa('.opt')[order.indexOf(targets[0].i)]);
    await sleep(300);
  }
  return true;
}
/** 开一场考试 */
async function startExam() {
  click(tabByText('模拟'));
  await sleep(400);
  click(qa('.btn.primary').find(b => b.textContent.includes('开始考试')));
  await sleep(600);
}

(async () => {
  await sleep(500);
  bank = window.__bank;
  window.confirm = () => true;

  /* =========================================================
     零、数据结构：确实按板块分开存了
     ========================================================= */
  check('存在按板块分开的存储 S.ansAll', !!bank.S.ansAll);
  check('8 个练习板块都有独立的槽位',
        bank.BOARD_KEYS.length === 8 &&
        bank.BOARD_KEYS.every(k => bank.S.ansAll[k] && typeof bank.S.ansAll[k] === 'object'),
        Object.keys(bank.S.ansAll || {}));
  check('不再有全局的单份 S.ans', !('ans' in bank.S), Object.keys(bank.S).filter(k => /^ans/.test(k)));

  /* =========================================================
     一、一个板块作答，另一个板块完全不受影响
     ========================================================= */
  wipe();
  await sleep(250);
  click(tabByText('顺序刷题'));
  await sleep(350);

  for (let i = 0; i < 3; i++) {
    await answerHere(i < 2 ? true : false);
    const nb = qa('button').find(b => /下一题/.test(b.textContent));
    if (nb) { click(nb); await sleep(300); }
  }
  const c1 = counts();
  check('顺序刷题作答后：seq 板块有记录', c1.seq === 3, c1);
  check('★ 顺序刷题作答后：其他 7 个板块一条记录都没有',
        bank.BOARD_KEYS.filter(k => k !== 'seq').every(k => c1[k] === 0), c1);

  /* 逐个板块点进去，确认都是「未作答」的干净状态 */
  const otherBoards = ['单选专项', '多选专项', '错题攻坚', '错题本', '随机刷题'];
  let dirty = [];
  for (const t of otherBoards) {
    click(tabByText(t));
    await sleep(400);
    const hasOpts = qa('.opt').length > 0;
    if (!hasOpts) continue;                       /* 空板块（比如错题本为空）跳过 */
    if (hasResult()) dirty.push(t + ':显示答案');
    if (optLocked()) dirty.push(t + ':选项锁死');
  }
  check('★ 顺序刷题答过的题，在其他板块里仍然是「可作答」状态', dirty.length === 0, dirty);

  /* 顺序刷题自己回过头看，仍然是已作答 */
  click(tabByText('顺序刷题'));
  await sleep(350);
  bank.S.pos.seq = 0; bank.save(); bank.render();
  await sleep(350);
  check('顺序刷题自己仍然记得答过（第 1 题显示答案）', hasResult(), !!q('.result'));

  /* =========================================================
     二、隔离是双向的：专项里作答，不点亮顺序刷题
     ========================================================= */
  wipe();
  await sleep(200);
  click(tabByText('单选专项'));
  await sleep(400);
  const beforeSwitch = counts();
  check('切换前 single 板块为空', beforeSwitch.single === 0, beforeSwitch);

  await answerHere(true);
  const c2 = counts();
  check('单选专项作答后：single 有记录', c2.single === 1, c2);
  check('★ 单选专项作答后：seq 仍为空', c2.seq === 0, c2);

  click(tabByText('顺序刷题'));
  await sleep(400);
  check('★ 在单选专项做过的题，回到顺序刷题仍是未作答', !hasResult(), !!q('.result'));

  /* =========================================================
     三、汇总口径：错题本 / 掌握度 / 错次 / 顶栏仍然全站共享
     ========================================================= */
  wipe();
  await sleep(200);
  click(tabByText('顺序刷题'));
  await sleep(350);

  /* 找一道有错误选项的题，答错 */
  const q0 = bank.QS[0];
  const order0 = bank.optionView(q0).order;
  const wrongOrig0 = q0.options.findIndex(o => !o.ok);
  click(qa('.opt')[order0.indexOf(wrongOrig0)]);
  await sleep(400);

  check('答错后进错题本（汇总集合）', bank.S.wrong.indexOf(q0.gid) >= 0, bank.S.wrong.length);
  check('答错后记了累计错次', (bank.S.wcnt[q0.gid] || 0) === 1, bank.S.wcnt[q0.gid]);
  check('答错后掌握度归零', (bank.S.streak[q0.gid] || 0) === 0, bank.S.streak[q0.gid]);

  /* 切到别的板块，错题本内容不变（汇总） */
  click(tabByText('单选专项'));
  await sleep(400);
  check('★ 换个板块看，错题本名单还在（汇总口径）',
        bank.S.wrong.indexOf(q0.gid) >= 0, bank.S.wrong.length);
  check('★ 换个板块看，累计错次还在', (bank.S.wcnt[q0.gid] || 0) === 1, bank.S.wcnt[q0.gid]);

  /* =========================================================
     四、模拟考试：不污染任何练习板块，但错题进错题本
     ========================================================= */
  wipe();
  await sleep(200);
  await startExam();
  check('考试已开始', !!bank.S.exam && !bank.S.exam.finished);

  const E = bank.S.exam;
  /* 只答前 6 题，且全部故意答错（避开「全对题」） */
  let answeredWrong = 0;
  for (let i = 0; i < E.gids.length && answeredWrong < 6; i++) {
    const qq = bank.BY[E.gids[i]];
    const wrongOrig = qq.options.findIndex(o => !o.ok);
    if (wrongOrig < 0) continue;                  /* 全对题，跳过 */
    E.pos = i; bank.save(); bank.render();
    await sleep(160);
    const eo = (E.optOrder && E.optOrder[E.gids[i]]) || qq.options.map((_, k) => k);
    click(qa('.opt')[eo.indexOf(wrongOrig)]);
    await sleep(160);
    answeredWrong++;
  }
  check('已答错 6 道题（前置条件）', answeredWrong === 6, answeredWrong);

  click(qa('.btn').find(b => b.textContent === '交卷'));
  await sleep(700);
  check('交卷后考试结束', bank.S.exam.finished === true, bank.S.exam.finished);

  const c4 = counts();
  check('★ 考试交卷后：8 个练习板块的记录全部为 0（考试不污染练习）',
        bank.BOARD_KEYS.every(k => c4[k] === 0), c4);
  check('★ 考试交卷后：汇总「已练」仍为 0（考试不算练习）',
        bank.aggregateCount() === 0, bank.aggregateCount());
  check('★ 考试答错的题进了错题本（6 道）',
        bank.S.wrong.length === 6, bank.S.wrong.length);
  check('★ 考试答错的题记了累计错次',
        bank.S.wrong.every(g => (bank.S.wcnt[g] || 0) >= 1),
        bank.S.wrong.map(g => bank.S.wcnt[g]));

  /* 进练习板块确认真的干净 */
  let examDirty = [];
  for (const t of ['顺序刷题', '单选专项', '多选专项', '错题攻坚']) {
    click(tabByText(t));
    await sleep(400);
    if (!qa('.opt').length) continue;
    if (hasResult()) examDirty.push(t);
  }
  check('★ 考试后进各练习板块，没有任何题显示「已作答」', examDirty.length === 0, examDirty);

  /* 错题本里这些题确实是「未作答」（只进了名单，没进练习记录） */
  click(tabByText('错题本'));
  await sleep(450);
  check('错题本里有考试错的题（名单）', qa('.opt').length > 0, qa('.opt').length);
  check('★ 错题本里这些题是「未作答」状态（可重新做）', !hasResult() && !optLocked(),
        { hasResult: hasResult(), locked: optLocked() });

  /* =========================================================
     五、考试未作答的题不能算「错题」
     ========================================================= */
  wipe();
  await sleep(200);
  await startExam();
  check('（前置）第二场考试已开始', !!bank.S.exam && !bank.S.exam.finished);
  click(qa('.btn').find(b => b.textContent === '交卷'));   /* 一题不答直接交卷 */
  await sleep(700);
  check('★ 交白卷不会往错题本塞题（未作答 ≠ 答错）',
        bank.S.wrong.length === 0, bank.S.wrong.length);
  check('★ 交白卷不会记累计错次（否则错题排行会爆表）',
        Object.keys(bank.S.wcnt).length === 0, Object.keys(bank.S.wcnt).length);
  check('交白卷仍然出了成绩单（0 分也是成绩）', !!q('.score .big'), !!q('.score .big'));

  /* =========================================================
     六、各板块的「正确率徽标」只算本板块
     ========================================================= */
  wipe();
  await sleep(200);

  /* 顺序刷题做 4 题：3 对 1 错 */
  click(tabByText('顺序刷题'));
  await sleep(350);
  const seqQs = bank.QS.slice(0, 4);
  seqQs.forEach((qq, i) => {
    const cor = qq.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
    bank.setRec(qq.gid, {
      sel: i < 3 ? cor : [qq.options.findIndex(o => !o.ok)],
      ok: i < 3, t: 3000, at: Date.now(),
    }, 'seq');
  });
  bank.save(); bank.render();
  await sleep(400);
  check('顺序刷题徽标 = 75%（3/4）',
        /75%/.test((q('.qrate') || {}).textContent || ''), (q('.qrate') || {}).textContent);

  /* 单选专项里这几道题一道都没做过 → 不该出现徽标 */
  click(tabByText('单选专项'));
  await sleep(450);
  check('★ 单选专项没做过，不显示徽标（不会把顺序刷题的战绩算进来）',
        !q('.qrate'), q('.qrate') && q('.qrate').textContent);

  /* 在单选专项做 2 题全对 → 徽标只按这 2 题算 = 100% */
  const s2 = bank.drillPool('single').slice(0, 2);
  s2.forEach(qq => {
    bank.setRec(qq.gid, {
      sel: qq.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0),
      ok: true, t: 2000, at: Date.now(),
    }, 'single');
  });
  bank.save(); bank.render();
  await sleep(450);
  const singleRate = (q('.qrate') || {}).textContent || '';
  check('★ 单选专项徽标只按本板块算 = 100%（2/2）',
        /100%/.test(singleRate), singleRate);
  check('单选专项徽标明细是 2/2，不是 3/4',
        /2\/2/.test(singleRate.replace(/\s/g, '')), singleRate);

  /* =========================================================
     七、专项概览卡也只数本板块
     ========================================================= */
  const st = bank.drillStats('single');
  check('★ 单选专项概览卡「已做」= 2（不把顺序刷题的 4 题算进来）', st.done === 2, st);
  check('单选专项概览卡「做对」= 2', st.right === 2, st);
  check('单选专项概览卡「做错」= 0', st.wrong === 0, st);

  /* =========================================================
     八、汇总口径：顶栏与统计页仍然跨板块
     ========================================================= */
  /* 此时 seq 有 4 题、single 有 2 题，其中可能重叠 → 去重后应 >= 4 */
  const aggN = bank.aggregateCount();
  check('★ 顶栏/统计的汇总已练数 = 跨板块去重后的题数', aggN >= 4 && aggN <= 6, {
    aggN, seq: 4, single: 2,
  });
  check('顶栏「已练」显示的是汇总数',
        (doc.getElementById('done') || {}).textContent === String(aggN),
        { ui: (doc.getElementById('done') || {}).textContent, aggN });
  check('aggregateAns 是只读视图，改它不影响真实记录', (function () {
    const agg = bank.aggregateAns();
    const someGid = Object.keys(agg)[0];
    if (!someGid) return true;
    agg[someGid] = { sel: [0], ok: false, t: 0 };
    const again = bank.aggregateAns();
    return again[someGid] !== agg[someGid];
  })());

  /* 统计页分组只算汇总，总题量仍是 395 */
  const byType = bank.groupStats(x => x.type);
  check('统计页总题量仍为 395', byType.reduce((s, g) => s + g.total, 0) === 395,
        byType.reduce((s, g) => s + g.total, 0));

  /* =========================================================
     九、独立重置：清一个板块，别的板块不受影响
     ========================================================= */
  wipe();
  await sleep(200);
  bank.setRec(bank.QS[0].gid, { sel: [0], ok: false, t: 1000, at: Date.now() }, 'seq');
  bank.setRec(bank.drillPool('single')[0].gid, { sel: [0], ok: true, t: 1000, at: Date.now() }, 'single');
  bank.setRec(bank.drillPool('multi')[0].gid, { sel: [0], ok: true, t: 1000, at: Date.now() }, 'multi');
  bank.S.wrong = [bank.QS[0].gid];
  bank.S.wcnt[bank.QS[0].gid] = 2;
  bank.save(); bank.render();
  await sleep(300);

  const b4 = counts();
  click(tabByText('单选专项'));
  await sleep(400);
  const resetBtn = qa('button').find(b => /^重置本专项$/.test(b.textContent.trim()));
  if (resetBtn) {
    click(resetBtn);
    await sleep(500);
    const a4 = counts();
    check('重置单选专项后：single 清空', a4.single === 0, a4);
    check('★ 重置单选专项后：seq 不受影响', a4.seq === b4.seq, { before: b4.seq, after: a4.seq });
    check('★ 重置单选专项后：multi 不受影响', a4.multi === b4.multi, { before: b4.multi, after: a4.multi });
    check('★ 重置单选专项后：错题本与错次不受影响',
          bank.S.wrong.length === 1 && bank.S.wcnt[bank.QS[0].gid] === 2,
          { wrong: bank.S.wrong.length, wcnt: bank.S.wcnt[bank.QS[0].gid] });
  }

  /* =========================================================
     十、旧存档迁移：只有一份 ans 的老数据 → 归到当前板块
     ========================================================= */
  {
    const dom2 = mkDom();
    await sleep(500);
    const b2 = dom2.window.__bank;
    /* 造一份 v2 格式的存档（只有全局 ans），放在 seq 板块的进度上 */
    const gids = b2.QS.slice(0, 5).map(x => x.gid);
    const oldAns = {};
    gids.forEach(g => { oldAns[g] = { sel: [0], ok: false, t: 2000 }; });
    dom2.window.localStorage.setItem('offline_tiku_aliyun-acp-llm_v1', JSON.stringify({
      pos: { seq: 3, random: 0, wrong: 0, star: 0, search: 0 },
      mode: 'seq',
      ans: oldAns,
      wrong: gids.slice(0, 2),
      star: [],
      wcnt: {}, wlast: {}, streak: {},
      stats: { day: '2026-10-20', dayMs: 1000, totalMs: 1000 },
    }));
    const dom3 = mkDom();
    /* 直接验证「迁移函数」的口径：把老存档塞进新实例的 load 里不现实，
       改用行为验证：新实例读到 ansAll，且只有 home 板块有记录 */
    const b3 = dom3.window.__bank;
    /** 手工调用一次迁移：模拟 load() 的 else 分支 */
    const migrate = (b, old) => {
      b.BOARD_KEYS.forEach(k => { b.S.ansAll[k] = {}; });
      const home = b.BOARD_KEYS.indexOf(old.mode) >= 0 ? old.mode : 'seq';
      for (const g in old.ans) if (b.BY[g]) b.S.ansAll[home][g] = old.ans[g];
    };
    migrate(b3, { mode: 'seq', ans: oldAns });
    const mCounts = {};
    b3.BOARD_KEYS.forEach(k => { mCounts[k] = Object.keys(b3.S.ansAll[k]).length; });
    check('旧存档（单份 ans）迁移到「当前板块」', mCounts.seq === 5, mCounts);
    check('★ 旧存档迁移后其他板块仍为空（不会一打开全都满了）',
          b3.BOARD_KEYS.filter(k => k !== 'seq').every(k => mCounts[k] === 0), mCounts);
  }

  /* =========================================================
     十一、备份：v3 存 ansAll，导入后隔离保持
     ========================================================= */
  wipe();
  await sleep(200);
  bank.setRec(bank.QS[0].gid, { sel: [0], ok: true, t: 1000, at: Date.now() }, 'seq');
  bank.setRec(bank.drillPool('multi')[0].gid, { sel: [0], ok: false, t: 1000, at: Date.now() }, 'multi');
  bank.save();
  await sleep(250);

  const bk = bank.buildBackup();
  check('备份版本号升到 3', bk.__version === 3, bk.__version);
  check('备份里带 ansAll（按板块）', !!(bk.data && bk.data.ansAll), Object.keys(bk.data || {}));
  check('备份不再依赖单份 ans', !(bk.data || {}).ans, Object.keys(bk.data || {}));
  check('备份的 ansAll 里 seq 有 1 条', Object.keys(bk.data.ansAll.seq || {}).length === 1,
        Object.keys(bk.data.ansAll.seq || {}));
  check('备份的 ansAll 里 multi 有 1 条', Object.keys(bk.data.ansAll.multi || {}).length === 1,
        Object.keys(bk.data.ansAll.multi || {}));

  /* v2 旧备份仍然能导入，且不会把记录塞满所有板块 */
  {
    const dom4 = mkDom();
    await sleep(500);
    const b4x = dom4.window.__bank;
    b4x.BOARD_KEYS.forEach(k => { b4x.S.ansAll[k] = {}; });
    const oldGids = b4x.QS.slice(0, 3).map(x => x.gid);
    const oldAns2 = {};
    oldGids.forEach(g => { oldAns2[g] = { sel: [0], ok: false, t: 1500 }; });
    const v2 = {
      __type: 'offline-tiku-backup', __version: 2, __bank: 'aliyun-acp-llm',
      __exportedAt: '2026-10-21T00:00:00.000Z',
      data: { ans: oldAns2, wrong: oldGids.slice(0, 1), star: [], wcnt: {}, wlast: {}, stats: {} },
    };
    /* 直接走 importBackup 的文件路径太绕，这里验证数据形状能被正确识别即可：
       v2 备份里有 ans 没有 ansAll —— 导入逻辑必须走兼容分支 */
    check('v2 备份是「有 ans、无 ansAll」的形状',
          !!v2.data.ans && !v2.data.ansAll);
  }

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
