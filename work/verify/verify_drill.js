/**
 * verify_drill.js — 验证三个专项练习（单选/多选/错题攻坚）
 *
 * 重点：
 *   1. 单选专项只出单选，多选专项只出多选
 *   2. 攻坚池 = 做错过且未掌握的题；掌握后自动移出
 *   3. 连续答对 3 次才算掌握，答错归零
 *   4. 三个专项的进度互不干扰
 *   5. 每个专项可独立随机 / 重置 / 跳转
 *   6. 已做/做对/做错 三个数字算得对
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
     1. 标签页存在
     ========================================================= */
  check('有单选专项标签', !!tabByText('单选专项'));
  check('有多选专项标签', !!tabByText('多选专项'));
  check('有错题攻坚标签', !!tabByText('错题攻坚'));
  check('标签页总数为 12', qa('.tab').length === 12, qa('.tab').length);

  /* =========================================================
     2. 单选专项：只出单选题
     ========================================================= */
  click(tabByText('单选专项'));
  await sleep(500);

  const singlePool = bank.drillPool('single');
  check('单选专项题池 = 全部单选题', singlePool.length === 273, singlePool.length);
  check('单选专项题池全是单选题', singlePool.every(x => x.type === '单选题'));
  check('单选专项页显示概览', !!q('.drillnums'), !!q('.drillnums'));

  /* =========================================================
     3. 多选专项：只出多选题
     ========================================================= */
  click(tabByText('多选专项'));
  await sleep(500);

  const multiPool = bank.drillPool('multi');
  check('多选专项题池 = 全部多选题', multiPool.length === 122, multiPool.length);
  check('多选专项题池全是多选题', multiPool.every(x => x.type === '多选题'));

  /* =========================================================
     4. 三个数字：已做 / 做对 / 做错
     ========================================================= */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.wrong = []; bank.S.wcnt = {}; bank.S.streak = {};
  bank.save();

  const st0 = bank.drillStats('single');
  check('初始已做为 0', st0.done === 0, st0);
  check('初始做对为 0', st0.right === 0);
  check('初始做错为 0', st0.wrong === 0);

  // 做对 3 道单选题
  const singles = bank.drillPool('single');
  for (let i = 0; i < 3; i++) {
    const qq = singles[i];
    bank.setRec(qq.gid, { sel: qq.options.map((o,k)=>o.ok?k:-1).filter(k=>k>=0), ok: true, t: 5000 }, 'single');
  }
  // 做错 2 道单选题
  for (let i = 3; i < 5; i++) {
    const qq = singles[i];
    bank.setRec(qq.gid, { sel: [0], ok: false, t: 5000 }, 'single');
    bank.noteWrong(qq.gid);
  }
  bank.save();

  const st1 = bank.drillStats('single');
  check('已做 = 5', st1.done === 5, st1.done);
  check('做对 = 3', st1.right === 3, st1.right);
  check('做错 = 2', st1.wrong === 2, st1.wrong);

  /* 页面上三个数字显示正确 */
  bank.S.mode = 'single'; bank.save(); bank.render();
  await sleep(400);
  const nums = qa('.drillnums .dnv').map(x => x.textContent);
  check('页面显示已做 5', nums[0] === '5', nums);
  check('页面显示做对 3', nums[1] === '3', nums);
  check('页面显示做错 2', nums[2] === '2', nums);

  // 多选专项不受影响
  const stMulti = bank.drillStats('multi');
  check('多选专项已做数不受单选影响', stMulti.done === 0, stMulti.done);

  /* =========================================================
     5. 掌握度：连续答对 3 次才算掌握
     ========================================================= */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.wrong = []; bank.S.wcnt = {}; bank.S.streak = {};
  const gid = singles[10].gid;

  check('没做过 = 未接触', bank.masteryOf(gid) === 'untouched', bank.masteryOf(gid));

  bank.noteWrong(gid);
  check('做错一次 = 顽固', bank.masteryOf(gid) === 'stubborn', bank.masteryOf(gid));
  check('错一次后连续对数为 0', (bank.S.streak[gid] || 0) === 0);

  bank.noteRight(gid);
  check('对 1 次后连续对 = 1', bank.S.streak[gid] === 1);
  check('对 1 次还不算掌握', bank.isMastered(gid) === false);
  check('对 1 次 = 巩固中', bank.masteryOf(gid) === 'learning', bank.masteryOf(gid));
  check('对 1 次后仍在错题本（不能一次洗白）', bank.S.wrong.indexOf(gid) >= 0);

  bank.noteRight(gid);
  check('对 2 次后连续对 = 2', bank.S.streak[gid] === 2);
  check('对 2 次仍不算掌握', bank.isMastered(gid) === false);

  bank.noteRight(gid);
  check('对 3 次后连续对 = 3', bank.S.streak[gid] === 3);
  check('对 3 次算掌握', bank.isMastered(gid) === true);
  check('掌握后移出错题本', bank.S.wrong.indexOf(gid) < 0);
  check('掌握后等级 = mastered', bank.masteryOf(gid) === 'mastered', bank.masteryOf(gid));

  /* 答错会清零连续数 */
  bank.noteWrong(gid);
  check('掌握后答错，连续数归零', bank.S.streak[gid] === 0);
  check('掌握后答错，重新回到错题本', bank.S.wrong.indexOf(gid) >= 0);

  /* =========================================================
     6. 攻坚池：只收做错过且未掌握的题
     ========================================================= */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.wrong = []; bank.S.wcnt = {}; bank.S.streak = {};
  bank.save();

  check('初始攻坚池为空', bank.drillPool('hard').length === 0, bank.drillPool('hard').length);

  // 做错 3 道
  const hardGids = [singles[20].gid, singles[21].gid, singles[22].gid];
  hardGids.forEach(g => bank.noteWrong(g));
  check('做错 3 道后攻坚池 = 3', bank.drillPool('hard').length === 3, bank.drillPool('hard').length);

  // 其中一道连续答对 3 次 → 移出攻坚池
  bank.noteRight(hardGids[0]);
  bank.noteRight(hardGids[0]);
  check('对 2 次后仍在攻坚池', bank.drillPool('hard').length === 3, bank.drillPool('hard').length);
  bank.noteRight(hardGids[0]);
  check('连续对 3 次后移出攻坚池', bank.drillPool('hard').length === 2, bank.drillPool('hard').length);
  check('移出的题不在攻坚池里', bank.drillPool('hard').every(x => x.gid !== hardGids[0]));

  /* 攻坚池包含「错过但已移出错题本、未掌握」的题 */
  const gidA = singles[30].gid;
  bank.noteWrong(gidA);       // 错一次，进错题本
  bank.S.wrong = bank.S.wrong.filter(g => g !== gidA);  // 手动移出错题本
  check('攻坚池仍收「错过但不在错题本、未掌握」的题',
        bank.drillPool('hard').some(x => x.gid === gidA), bank.drillPool('hard').map(x=>x.gid));

  /* =========================================================
     7. 攻坚页渲染
     ========================================================= */
  click(tabByText('错题攻坚'));
  await sleep(500);
  check('攻坚页显示待攻克数', /待攻克/.test(doc.body.textContent) || !!q('.hardbar'), !!q('.hardbar'));
  check('攻坚页有题卡', qa('.opt').length >= 2, qa('.opt').length);

  const hardStat = bank.drillStats('hard');
  check('攻坚统计的已做数合理', hardStat.done >= 0, hardStat.done);

  /* =========================================================
     8. 每个专项独立随机
     ========================================================= */
  bank.S.drill.single.shuffleSeq = false;
  bank.S.drill.multi.shuffleSeq = false;
  bank.save();

  const singleSeq = bank.drillList('single').map(x => x.gid).slice(0, 5).join(',');
  const singleSeq2 = bank.drillList('single').map(x => x.gid).slice(0, 5).join(',');
  check('未随机时顺序稳定', singleSeq === singleSeq2);

  bank.S.drill.single.shuffleSeq = true;
  bank.S.drill.single.order = null;
  const singleRand = bank.drillList('single').map(x => x.gid).slice(0, 5).join(',');
  check('开启随机后顺序变化', singleRand !== singleSeq, { singleSeq: singleSeq.slice(0,40), singleRand: singleRand.slice(0,40) });

  const singleRand2 = bank.drillList('single').map(x => x.gid).slice(0, 5).join(',');
  check('随机顺序在同一个轮次内稳定', singleRand === singleRand2);

  check('单选随机不影响多选', bank.S.drill.multi.shuffleSeq === false);

  /* =========================================================
     9. 每个专项独立重置
     ========================================================= */
  bank.S.drill.single.pos = 5;
  bank.S.drill.multi.pos = 3;
  /* 先记下多选池里有多少条作答记录，重置单选后这个数不能变 */
  const multiAnsweredBefore = bank.drillPool('multi').filter(x => !!bank.recOf(x.gid)).length;
  const roundBefore = bank.S.optRound;

  bank.resetDrill('single');
  check('重置专项后进度归零', bank.S.drill.single.pos === 0);
  check('重置专项后轮次 +1', bank.S.optRound === roundBefore + 1, { before: roundBefore, after: bank.S.optRound });
  check('重置专项不影响其他专项进度', bank.S.drill.multi.pos === 3, bank.S.drill.multi.pos);
  /* 这里原来写的是 `bank.aggregateCount() > 0 || true` ——
     `|| true` 让它永远为真，等于没测。而它掩盖的恰好是一个真实缺陷：
     resetDrill 只把 pos 归零、根本不碰 S.ans，于是「重置」后每道题仍是已作答状态，
     答案摊在屏幕上、选项点不动，用户点重置以为没反应。
     现在按真实语义断言：本专项题池内的作答记录必须被清空。 */
  const singlePoolGids = bank.drillPool('single').map(x => x.gid);
  check('★ 重置本专项清空该池的作答记录',
        singlePoolGids.every(g => !bank.recOf(g)),
        singlePoolGids.filter(g => bank.recOf(g)).length);
  check('重置本专项不动其他专项（多选）的作答记录',
        bank.drillPool('multi').filter(x => !!bank.recOf(x.gid)).length === multiAnsweredBefore,
        { before: multiAnsweredBefore, after: bank.drillPool('multi').filter(x => !!bank.recOf(x.gid)).length });

  /* =========================================================
     10. 跳转功能
     ========================================================= */
  bank.S.mode = 'single';
  bank.save(); bank.render();
  await sleep(400);

  const jumpInput = q('.drillctrl .jump input');
  check('专项页有跳转输入框', !!jumpInput, !!q('.drillctrl'));
  if (jumpInput) {
    jumpInput.value = '10';
    const jumpBtn = q('.drillctrl .jump .btn');
    click(jumpBtn);
    await sleep(400);
    check('跳转后进度 = 9（第 10 题）', bank.S.drill.single.pos === 9, bank.S.drill.single.pos);
    // 题号显示在题卡头部（.qidx 在概览卡里显示的是「共 N 题」，不是题号）
    const headIdxs = qa('.qidx').map(x => x.textContent);
    const cardIdx = headIdxs.find(t => /第\s*\d+\s*\//.test(t)) || '';
    check('页面显示第 10 题', /第\s*10\s*\//.test(cardIdx), { headIdxs });
  }

  /* =========================================================
     11. 随机/顺序切换按钮
     ========================================================= */
  const segBtns = qa('.drillctrl .seg button').map(b => b.textContent);
  check('专项页有「按题号 / 随机出题」切换', segBtns.includes('按题号') && segBtns.includes('随机出题'), segBtns);

  const randBtn = qa('.drillctrl .seg button').find(b => b.textContent === '随机出题');
  click(randBtn);
  await sleep(400);
  check('点随机后 shuffleSeq = true', bank.S.drill.single.shuffleSeq === true, bank.S.drill.single.shuffleSeq);

  /* =========================================================
     12. 全局重置应清空专项与 streak
     ========================================================= */
  bank.S.drill.single.pos = 5;
  bank.S.drill.multi.pos = 4;
  bank.S.drill.hard.pos = 2;
  bank.S.streak['x'] = 5;
  bank.save();

  click('#btReset');
  await sleep(600);

  check('全局重置清空 streak', Object.keys(bank.S.streak).length === 0, Object.keys(bank.S.streak).length);
  check('全局重置清空单选专项进度', bank.S.drill.single.pos === 0, bank.S.drill.single.pos);
  check('全局重置清空多选专项进度', bank.S.drill.multi.pos === 0, bank.S.drill.multi.pos);
  check('全局重置清空攻坚专项进度', bank.S.drill.hard.pos === 0, bank.S.drill.hard.pos);
  check('全局重置后攻坚池为空', bank.drillPool('hard').length === 0, bank.drillPool('hard').length);

  /* =========================================================
     13. 无异常
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
