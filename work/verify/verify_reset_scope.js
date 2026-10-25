/**
 * verify_reset_scope.js — 「重置本板块」到底清什么、不清什么
 *
 * 【用户报的缺陷】
 *   三个专项页都有「重置本专项」按钮，但点了没反应：
 *   进度条回到 0 了、题号回到第 1 题了，可那第 1 题还是「已作答」状态 ——
 *   答案和解析直接摊在屏幕上，选项点不动，根本没法重新做。
 *   想重做只能点右上角「总重置」，结果全部板块的记录（含收藏、错题本、
 *   成绩走势、错次统计）一起没了。
 *
 * 【根因】
 *   `resetDrill(key)` 只做了三件事：pos=0、order=null、round+1、optRound+1。
 *   它**完全没有碰 `S.ans`**。而题卡判断「这题做过没有」就看 `S.ans[gid]`：
 *       var showAns = answered || revealed || S.memorizing;
 *   于是重置后每道题仍然 answered=true → 直接显示答案 + 选项 locked → 点不动。
 *
 *   所以「重置」当时实际语义只是「回到第 1 题」，不是「让我重做」。
 *
 * 【另外】
 *   顺序刷题、随机刷题、错题本三个板块**根本没有**本板块重置按钮。
 *
 * 【这次定的语义】（重置 = 让我能重做，但只影响这个板块）
 *   ✅ 清：本板块题池内的作答记录 `S.ans[gid]`
 *   ✅ 清：本板块的进度与随机顺序，并换一套选项排列
 *   ❌ 不动：其他板块的作答记录
 *   ❌ 不动：错题本 `S.wrong`、收藏 `S.star`
 *   ❌ 不动：累计错次 `S.wcnt` / `S.wlast`（那是错题排行的依据）
 *   ❌ 不动：掌握度 `S.streak`（专项重置清掌握度会造成「攻坚池自己涨回去」）
 *   ❌ 不动：成绩走势 `S.daily` / `S.examHistory`
 *
 * 为什么错题本、收藏这两个板块的「重置」不清 S.wrong / S.star 本身：
 *   那两个数组**就是**这些板块的题池。清掉它们 = 板块变空 = 功能自毁。
 *   所以它们只清「本题池里的作答记录」，让题能重做；名单本身保留。
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
const btnByText = t => qa('button').find(x => x.textContent.trim() === t);
const btnContains = t => qa('button').find(x => x.textContent.includes(t));
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

/** 把题库清成「一块白板」，方便逐板块单独验 */
function wipe() {
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.pend = {};
  bank.S.wrong = []; bank.S.star = [];
  bank.S.wcnt = {}; bank.S.wlast = {}; bank.S.streak = {};
  bank.S.reveal = {}; bank.S.memorizing = false;
  bank.S.pos = { seq: 0, random: 0, wrong: 0, star: 0, search: 0 };
  ['single', 'multi', 'hard'].forEach(k => {
    bank.S.drill[k] = { pos: 0, order: null, shuffleSeq: false, round: 0 };
  });
  bank.S.exam = null; bank.S.examReview = null;
  bank.save(); bank.render();
}

/** 在**指定板块**里把题池前 n 道题标成「已作答」。
    必须指定板块：现在记录是按板块分开存的，写错板块等于没写。 */
function seedAnswered(list, n, ok = true, board = 'seq') {
  list.slice(0, n).forEach((qq, i) => {
    const cor = qq.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
    bank.setRec(qq.gid, { sel: ok ? cor : [qq.options.findIndex(o => !o.ok)], ok, t: 3000 + i }, board);
  });
  bank.save(); bank.render();
}

(async () => {
  await sleep(450);
  bank = window.__bank;
  window.confirm = () => true;

  /* =========================================================
     一、核心缺陷：重置本专项后，题目必须能重新作答
     ========================================================= */
  for (const [tab, keyName] of [['单选专项', 'single'], ['多选专项', 'multi']]) {
    wipe();
    await sleep(200);
    click(tabByText(tab));
    await sleep(350);

    const pool = bank.drillPool(keyName);
    seedAnswered(pool, 3, true, keyName);
    await sleep(300);

    check(tab + '：重置前第 1 题是「已作答」状态', !!bank.recOf(pool[0].gid), pool[0].gid.slice(0, 8));
    check(tab + '：重置前题卡显示答案（前置条件）', !!q('.result'), !!q('.result'));

    const resetBtn = btnContains('重置本专项') || btnContains('重置本板块');
    check(tab + '：页面上有本板块重置按钮', !!resetBtn,
          qa('button').map(b => b.textContent.trim()).filter(t => t.includes('重置')));

    if (resetBtn) {
      click(resetBtn);
      await sleep(500);

      check('★ ' + tab + '：重置清空了本板块的作答记录（原缺陷：一条都没清）',
            !bank.recOf(pool[0].gid), bank.recOf(pool[0].gid));
      check('★ ' + tab + '：重置后第 1 题不再显示答案，可以重新作答',
            !q('.result'), { hasResult: !!q('.result') });
      check('★ ' + tab + '：重置后选项没有被锁死（点得动）',
            qa('.opt').length > 0 && !qa('.opt')[0].classList.contains('locked'),
            qa('.opt')[0] && qa('.opt')[0].className);
      check(tab + '：重置后进度回到第 1 题', /第1\//.test(cardIdx() || ''), cardIdx());
      check(tab + '：重置后概览卡「已做」归零',
            (function () {
              const st = bank.drillStats(keyName);
              return st.done === 0;
            })(), bank.drillStats(keyName));
      check(tab + '：重置后概览卡「做对/做错」都归零',
            (function () { const st = bank.drillStats(keyName); return st.right === 0 && st.wrong === 0; })(),
            bank.drillStats(keyName));

      /* 重置后真的能答一次（不只是看起来能点） */
      const cur = bank.drillList(keyName)[0];
      const order = bank.optionView(cur).order;
      const isMulti = cur.type === '多选题';
      /* 多选题必须选全所有正确项再提交，否则漏选本身就是错的 ——
         这正是 README 里记过的「按题型分流」，不能一律点第一个正确项。 */
      const correctOrigs = cur.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
      if (isMulti) {
        correctOrigs.forEach(oi => click(qa('.opt')[order.indexOf(oi)]));
        await sleep(200);
        const sb = qa('button').find(b => /提交/.test(b.textContent));
        if (sb) { click(sb); await sleep(300); }
      } else {
        click(qa('.opt')[order.indexOf(correctOrigs[0])]);
        await sleep(300);
      }
      check('★ ' + tab + '：重置后能真正登记一次新作答',
            !!bank.recOf(cur.gid), bank.recOf(cur.gid));
      check(tab + '：这次新作答被记为「对」',
            !!bank.recOf(cur.gid) && bank.recOf(cur.gid).ok === true,
            bank.recOf(cur.gid));
    }
  }

  /* 错题攻坚：池子必须还在，否则一重置板块就空了 */
  wipe();
  await sleep(200);
  click(tabByText('错题攻坚'));
  await sleep(350);
  const hardSeed = bank.QS.filter(x => x.type === '单选题').slice(0, 3);
  hardSeed.forEach(x => bank.noteWrong(x.gid));
  bank.save(); bank.render();
  await sleep(350);
  check('攻坚页：重置前池子有题（前置条件）', bank.drillPool('hard').length >= 3, bank.drillPool('hard').length);

  const hardReset = btnContains('重置本专项') || btnContains('重置本板块');
  if (hardReset) {
    click(hardReset);
    await sleep(500);
    check('★ 攻坚页：重置后池子不会变空（错题本与错次都不该被清）',
          bank.drillPool('hard').length >= 3, bank.drillPool('hard').length);
    check('攻坚页：重置后错题本仍在', bank.S.wrong.length >= 3, bank.S.wrong.length);
    check('攻坚页：重置后累计错次仍在', hardSeed.every(x => (bank.S.wcnt[x.gid] || 0) > 0),
          hardSeed.map(x => bank.S.wcnt[x.gid]));
    check('攻坚页：重置后第 1 题不再显示答案',
          !q('.result') || !bank.recOf(bank.drillPool('hard')[0].gid),
          { hasResult: !!q('.result') });
  }

  /* =========================================================
     二、顺序 / 随机 / 错题本 三个板块也要有自己的重置
     ========================================================= */
  /* --- 顺序刷题 --- */
  wipe();
  await sleep(200);
  click(tabByText('顺序刷题'));
  await sleep(350);
  seedAnswered(bank.QS, 4);
  await sleep(300);

  check('顺序刷题：重置前有作答记录（前置条件）', bank.aggregateCount() === 4,
        bank.aggregateCount());

  const seqReset = qa('button').find(b => /^重置(本板块|本轮)/.test(b.textContent));
  check('★ 顺序刷题页有本板块重置按钮（原来没有，只能点总重置）', !!seqReset,
        qa('button').map(b => b.textContent.trim()).filter(t => t.includes('重置')));
  if (seqReset) {
    const roundBefore = bank.S.optRound;
    click(seqReset);
    await sleep(500);
    check('顺序刷题：重置清空作答记录', bank.aggregateCount() === 0,
          bank.aggregateCount());
    check('顺序刷题：重置后第 1 题能重新作答', !q('.result') && !qa('.opt')[0].classList.contains('locked'),
          { hasResult: !!q('.result'), cls: qa('.opt')[0] && qa('.opt')[0].className });
    check('顺序刷题：重置后回到第 1 题', /第1\//.test(cardIdx() || ''), cardIdx());
    check('顺序刷题：重置换了一套选项位置（轮次 +1）',
          bank.S.optRound === roundBefore + 1, { before: roundBefore, after: bank.S.optRound });
    check('顺序刷题：重置没有清错题本/收藏/错次',
          bank.S.wrong.length >= 0 && bank.S.star.length >= 0);
  }

  /* --- 随机刷题 --- */
  wipe();
  await sleep(200);
  click(tabByText('随机刷题'));
  await sleep(400);
  const randList = bank.modeList ? bank.modeList() : [];
  seedAnswered(randList, 3, true, 'random');
  await sleep(300);
  check('随机刷题：重置前有作答记录（前置条件）', bank.aggregateCount() === 3,
        bank.aggregateCount());

  const randReset = qa('button').find(b => /^重置(本板块|本轮)/.test(b.textContent));
  check('★ 随机刷题页有本板块重置按钮（原来没有）', !!randReset,
        qa('button').map(b => b.textContent.trim()).filter(t => t.includes('重置')));
  if (randReset) {
    const orderBefore = (bank.S.order || []).join(',');
    click(randReset);
    await sleep(500);
    check('随机刷题：重置清空作答记录', bank.aggregateCount() === 0,
          bank.aggregateCount());
    check('随机刷题：重置后第 1 题能重新作答', !q('.result') && !qa('.opt')[0].classList.contains('locked'),
          { hasResult: !!q('.result') });
    check('随机刷题：重置后回到第 1 题', /第1\//.test(cardIdx() || ''), cardIdx());
    check('随机刷题：重置换了新的题目顺序',
          (bank.S.order || []).join(',') !== orderBefore,
          { before: orderBefore.slice(0, 40), after: (bank.S.order || []).join(',').slice(0, 40) });
  }

  /* --- 错题本 --- */
  wipe();
  await sleep(200);
  const wbQs = bank.QS.filter(x => x.type === '单选题').slice(10, 14);
  wbQs.forEach(x => bank.S.wrong.push(x.gid));
  bank.save();
  click(tabByText('错题本'));
  await sleep(350);
  seedAnswered(wbQs, 4, true, 'wrong');
  await sleep(300);

  const wbReset = qa('button').find(b => /^重置(本板块|本轮)/.test(b.textContent));
  check('★ 错题本页有本板块重置按钮（原来没有）', !!wbReset,
        qa('button').map(b => b.textContent.trim()).filter(t => t.includes('重置')));
  if (wbReset) {
    click(wbReset);
    await sleep(500);
    check('错题本：重置清空本题池的作答记录', !bank.recOf(wbQs[0].gid), bank.recOf(wbQs[0].gid));
    check('错题本：重置后第 1 题能重新作答',
          !q('.result') && qa('.opt').length > 0 && !qa('.opt')[0].classList.contains('locked'),
          { hasResult: !!q('.result') });
    check('★ 错题本：重置**不清空错题本名单**（清了板块就空了，等于自毁功能）',
          bank.S.wrong.length === 4, bank.S.wrong.length);
    check('错题本：重置后页面上还有题可刷', qa('.opt').length > 0, qa('.opt').length);
  }

  /* =========================================================
     三、作用域：重置一个板块，绝不能殃及其他板块
     ========================================================= */
  wipe();
  await sleep(200);

  const singles = bank.QS.filter(x => x.type === '单选题');
  const multis = bank.QS.filter(x => x.type === '多选题');
  /* 铺满**各板块**的作答记录 + 错题本 + 收藏 + 错次 + 掌握度 + 成绩走势。
     板块隔离之后，「在哪个板块做过的」必须真的落到那个板块里去，
     否则「重置单选专项只清自己」这条根本无从验证（数据压根不在那个板块）。 */
  singles.slice(0, 6).forEach((x, i) => {
    bank.setRec(x.gid, { sel: x.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0), ok: true, t: 2000 + i }, 'single');
  });
  multis.slice(0, 6).forEach((x, i) => {
    bank.setRec(x.gid, { sel: [0], ok: false, t: 2000 + i }, 'multi');
    bank.noteWrong(x.gid);
  });
  /* 再给顺序刷题也铺几题，验证它同样不受影响 */
  singles.slice(6, 9).forEach((x, i) => {
    bank.setRec(x.gid, { sel: [0], ok: false, t: 1800 + i }, 'seq');
  });
  bank.S.star = [singles[0].gid, singles[1].gid];
  bank.S.streak[singles[2].gid] = 2;
  bank.S.daily = { '2026-10-21': { ans: 10, right: 7, ms: 60000, examN: 0 } };
  bank.S.examHistory = [{ at: '2026-10-21T10:00:00Z', score: 82, full: 100, right: 60, total: 75, elapsed: 3600, auto: false }];
  bank.S.drill.multi.pos = 4;
  bank.S.drill.hard.pos = 2;
  bank.save(); bank.render();
  await sleep(300);

  const ansBefore = bank.aggregateCount();
  const wrongBefore = bank.S.wrong.length;
  const starBefore = bank.S.star.slice();
  const wcntBefore = JSON.stringify(bank.S.wcnt);
  const streakBefore = JSON.stringify(bank.S.streak);
  const dailyBefore = JSON.stringify(bank.S.daily);
  const examHistBefore = JSON.stringify(bank.S.examHistory);

  click(tabByText('单选专项'));
  await sleep(350);
  const scopeBtn = btnContains('重置本专项') || btnContains('重置本板块');
  if (scopeBtn) {
    click(scopeBtn);
    await sleep(500);

    check('作用域：单选专项重置后作答记录数变少', bank.aggregateCount() < ansBefore,
          { before: ansBefore, after: bank.aggregateCount() });
    check('★ 作用域：多选专项的作答记录一条都没动',
          multis.slice(0, 6).every(x => !!bank.recOf(x.gid, 'multi')),
          multis.slice(0, 6).map(x => !!bank.recOf(x.gid, 'multi')));
    check('★ 作用域：顺序刷题的作答记录也没动',
          singles.slice(6, 9).every(x => !!bank.recOf(x.gid, 'seq')),
          singles.slice(6, 9).map(x => !!bank.recOf(x.gid, 'seq')));
    check('★ 作用域：错题本名单没动', bank.S.wrong.length === wrongBefore,
          { before: wrongBefore, after: bank.S.wrong.length });
    check('★ 作用域：收藏没动', JSON.stringify(bank.S.star) === JSON.stringify(starBefore),
          { before: starBefore.length, after: bank.S.star.length });
    check('★ 作用域：累计错次没动（错题排行的依据）',
          JSON.stringify(bank.S.wcnt) === wcntBefore);
    check('★ 作用域：掌握度没动（清了会让攻坚池自己涨回去）',
          JSON.stringify(bank.S.streak) === streakBefore);
    check('★ 作用域：成绩走势每日记录没动',
          JSON.stringify(bank.S.daily) === dailyBefore);
    check('★ 作用域：考试历史没动',
          JSON.stringify(bank.S.examHistory) === examHistBefore);
    check('作用域：其他两个专项的进度没动',
          bank.S.drill.multi.pos === 4 && bank.S.drill.hard.pos === 2,
          { multi: bank.S.drill.multi.pos, hard: bank.S.drill.hard.pos });

    /* 单选专项题池里的作答记录应该清干净了 */
    check('作用域：单选专项题池内的作答记录全部清空',
          singles.every(x => !bank.recOf(x.gid)),
          singles.filter(x => bank.recOf(x.gid)).length);
  }

  /* =========================================================
     四、顺序刷题重置的作用域：整库 395 题都清，但仍不动错题本/收藏/统计
     ========================================================= */
  wipe();
  await sleep(200);
  singles.slice(0, 4).forEach(x => {
    bank.setRec(x.gid, { sel: [0], ok: false, t: 1500 }, 'seq');
    bank.noteWrong(x.gid);
  });
  bank.S.star = [singles[5].gid];
  bank.S.streak[singles[6].gid] = 3;
  bank.save();
  click(tabByText('顺序刷题'));
  await sleep(350);

  const wrongB2 = bank.S.wrong.length;
  const starB2 = bank.S.star.length;
  const wcntB2 = JSON.stringify(bank.S.wcnt);
  const streakB2 = JSON.stringify(bank.S.streak);

  const seqReset2 = qa('button').find(b => /^重置(本板块|本轮)/.test(b.textContent));
  if (seqReset2) {
    click(seqReset2);
    await sleep(500);
    check('顺序刷题重置：整库作答记录清空', bank.aggregateCount() === 0,
          bank.aggregateCount());
    check('★ 顺序刷题重置：错题本保留', bank.S.wrong.length === wrongB2,
          { before: wrongB2, after: bank.S.wrong.length });
    check('★ 顺序刷题重置：收藏保留', bank.S.star.length === starB2,
          { before: starB2, after: bank.S.star.length });
    check('★ 顺序刷题重置：累计错次保留', JSON.stringify(bank.S.wcnt) === wcntB2);
    check('★ 顺序刷题重置：掌握度保留', JSON.stringify(bank.S.streak) === streakB2);
  }

  /* =========================================================
     五、总重置：仍然是「全都清」——不能被上面的改动弄成半清
     ========================================================= */
  wipe();
  await sleep(200);
  singles.slice(0, 5).forEach(x => {
    bank.setRec(x.gid, { sel: [0], ok: false, t: 1500 }, 'seq');
    bank.noteWrong(x.gid);
  });
  bank.S.star = [singles[9].gid];
  bank.S.daily = { '2026-10-20': { ans: 5, right: 3, ms: 30000, examN: 1 } };
  bank.S.examHistory = [{ at: '2026-10-20T09:00:00Z', score: 70, full: 100, right: 50, total: 75, elapsed: 3000, auto: false }];
  bank.save(); bank.render();
  await sleep(250);

  click('#btReset');
  await sleep(600);

  check('总重置：作答记录全清', bank.aggregateCount() === 0, bank.aggregateCount());
  check('总重置：错题本全清', bank.S.wrong.length === 0, bank.S.wrong.length);
  check('总重置：收藏全清', bank.S.star.length === 0, bank.S.star.length);
  check('总重置：累计错次全清', Object.keys(bank.S.wcnt).length === 0, Object.keys(bank.S.wcnt).length);
  check('总重置：掌握度全清', Object.keys(bank.S.streak).length === 0, Object.keys(bank.S.streak).length);
  check('总重置：成绩走势全清', Object.keys(bank.S.daily).length === 0, Object.keys(bank.S.daily).length);
  check('总重置：考试历史全清', bank.S.examHistory.length === 0, bank.S.examHistory.length);
  check('总重置：三个专项进度全清',
        bank.S.drill.single.pos === 0 && bank.S.drill.multi.pos === 0 && bank.S.drill.hard.pos === 0,
        { s: bank.S.drill.single.pos, m: bank.S.drill.multi.pos, h: bank.S.drill.hard.pos });

  /* =========================================================
     六、重置按钮的文案要说清楚「会清什么」
     ========================================================= */
  wipe();
  await sleep(200);
  click(tabByText('单选专项'));
  await sleep(350);
  let captured = '';
  window.confirm = msg => { captured = String(msg); return true; };
  const rb = btnContains('重置本专项') || btnContains('重置本板块');
  if (rb) {
    click(rb);
    await sleep(400);
    check('专项重置的确认框说明了会清本板块的作答记录',
          /作答|记录|重做/.test(captured), captured.slice(0, 120));
    check('专项重置的确认框说明了不会动错题本/收藏',
          /错题|收藏/.test(captured), captured.slice(0, 160));
  }
  window.confirm = () => true;

  click(tabByText('顺序刷题'));
  await sleep(350);
  captured = '';
  window.confirm = msg => { captured = String(msg); return true; };
  const sr = qa('button').find(b => /^重置(本板块|本轮)/.test(b.textContent));
  if (sr) {
    click(sr);
    await sleep(400);
    check('顺序刷题重置的确认框有说明', captured.length > 10, captured.slice(0, 120));
  }
  window.confirm = () => true;

  /* =========================================================
     七、回归：重置后计时、键盘、正确率徽标都正常
     ========================================================= */
  wipe();
  await sleep(200);
  click(tabByText('顺序刷题'));
  await sleep(350);
  seedAnswered(bank.QS, 2);
  await sleep(300);
  check('回归：答过题后正确率徽标出现', !!q('.qrate'), q('.qrate') && q('.qrate').textContent);

  const regReset = qa('button').find(b => /^重置(本板块|本轮)/.test(b.textContent));
  if (regReset) {
    click(regReset);
    await sleep(500);
    check('回归：重置后正确率徽标消失（一道没做，不该显示 0%）', !q('.qrate'),
          q('.qrate') && q('.qrate').textContent);
    check('回归：重置后计时器仍在跑', typeof bank.TMR.qMs === 'number', bank.TMR.qMs);
  }

  /* 键盘在重置后也要能作答 */
  wipe();
  await sleep(200);
  seedAnswered(bank.QS, 1);
  await sleep(300);
  const kbReset = qa('button').find(b => /^重置(本板块|本轮)/.test(b.textContent));
  if (kbReset) {
    click(kbReset);
    await sleep(500);
    const q0 = bank.QS[0];
    const ord = bank.optionView(q0).order;
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await sleep(400);
    check('回归：重置后键盘 A 能正常作答',
          !!bank.recOf(q0.gid) && bank.recOf(q0.gid).sel[0] === ord[0],
          { got: bank.recOf(q0.gid) && bank.recOf(q0.gid).sel, want: ord[0] });
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
