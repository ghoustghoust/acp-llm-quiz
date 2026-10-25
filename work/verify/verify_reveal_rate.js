/**
 * verify_reveal_rate.js — 「查看答案」只影响单题 + 题卡显示板块正确率
 *
 * 这次修的两个问题：
 *
 * 【问题 1】点一次「查看答案」，所有板块永久变成背题模式
 *   原因：`reveal.onclick` 里写的是 `S.memorizing = true; save();`
 *   —— memorizing 是**全局且持久化**的开关，于是一次点击的效果 =
 *      「整个题库、所有板块、直到你手动关掉为止，全部直接显示答案」。
 *   用户感受就是「怎么默认变成背题模式了，不让我刷题」。
 *   修法：改成单题临时 `S.reveal[gid]`，切题即失效，且不持久化。
 *
 * 【问题 2】每个能刷的板块在「第 N / M 题」旁边显示该板块正确率
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

const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(n, c, d) { if (c) R.pass.push(n); else R.fail.push(n + (d !== undefined ? ' :: ' + JSON.stringify(d) : '')); }

(async () => {
  await sleep(450);
  const bank = window.__bank;
  window.confirm = () => true;

  /* =========================================================
     一、「查看答案」只能影响当前这一题
     ========================================================= */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.wrong = []; bank.S.wcnt = {}; bank.S.streak = {};
  bank.S.memorizing = false; bank.S.reveal = {};
  bank.S.mode = 'seq'; bank.S.pos.seq = 0;
  bank.save(); bank.render();
  await sleep(400);

  check('初始未开启背题模式', bank.S.memorizing === false, bank.S.memorizing);
  check('未作答时不显示答案区', !q('.result'), !!q('.result'));

  const revealBtn = btnByText('查看答案');
  check('有「查看答案」按钮', !!revealBtn, qa('button').map(b => b.textContent).slice(0, 8));
  check('切到下一题按钮前是「查看答案」不是「已背题」', !!revealBtn);

  const firstGid = bank.QS[bank.S.pos.seq].gid;
  click(revealBtn);
  await sleep(400);

  check('点「查看答案」后本题显示答案区', !!q('.result'), !!q('.result'));
  check('★ 不会打开全局背题模式（原缺陷）',
        bank.S.memorizing === false, { memorizing: bank.S.memorizing });
  check('★ 只把这一个 gid 标记为揭示',
        JSON.stringify(Object.keys(bank.S.reveal)) === JSON.stringify([firstGid]),
        bank.S.reveal);
  check('顶部「背题」按钮没有变成开启态',
        !q('#btMemorize').classList.contains('on'),
        q('#btMemorize').className);
  check('揭示后提供「继续作答」出口', !!btnByText('继续作答'),
        qa('button').map(b => b.textContent));

  /* 揭示状态不进 localStorage */
  const saved1 = JSON.parse(window.localStorage.getItem('offline_tiku_aliyun-acp-llm_v1') || '{}');
  check('揭示状态不写入 localStorage（刷新即失效）',
        saved1.reveal === undefined, Object.keys(saved1));

  /* 切到下一题 → 揭示失效、恢复答题 */
  click(btnByText('下一题 →'));
  await sleep(400);
  check('切到下一题后揭示状态被清空', Object.keys(bank.S.reveal).length === 0, bank.S.reveal);
  check('下一题不显示答案（恢复答题模式）', !q('.result'), !!q('.result'));
  check('下一题没有「继续作答」按钮', !btnByText('继续作答'));

  /* 点「继续作答」能回到答题状态 */
  bank.S.mode = 'seq'; bank.S.pos.seq = 0; bank.S.reveal = {}; bank.save(); bank.render();
  await sleep(350);
  click(btnByText('查看答案'));
  await sleep(350);
  check('重新揭示成功', !!q('.result'));
  const backBtn = btnByText('继续作答');
  check('有「继续作答」按钮', !!backBtn);
  if (backBtn) {
    click(backBtn);
    await sleep(350);
    check('点「继续作答」后回到答题状态（答案区消失）', !q('.result'), !!q('.result'));
    check('作答后 reveal 被清空', !bank.S.reveal[firstGid], bank.S.reveal);
  }

  /* 逐个板块确认都没被带成背题模式 */
  const MODES = ['seq', 'random', 'single', 'multi', 'hard', 'wrong', 'star'];
  let leaked = [];
  for (const m of MODES) {
    bank.S.mode = m; bank.save(); bank.render();
    await sleep(180);
    if (bank.S.memorizing === true) leaked.push(m);
  }
  check('★ 七个刷题板块都没有被带成背题模式', leaked.length === 0, leaked);

  /* =========================================================
     二、题卡显示板块正确率
     ========================================================= */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.wrong = []; bank.S.wcnt = {}; bank.S.streak = {};
  bank.S.reveal = {}; bank.S.memorizing = false;
  bank.S.mode = 'seq'; bank.S.pos.seq = 0;
  bank.save(); bank.render();
  await sleep(400);

  check('一道没做时不显示正确率徽标（避免 0% 误导）',
        !q('.qrate'), q('.qrate') && q('.qrate').textContent);

  /* 做 4 题：3 对 1 错 */
  const seq = bank.QS;
  for (let i = 0; i < 4; i++) {
    const qq = seq[i];
    const ok = i < 3;
    const cor = qq.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
    bank.setRec(qq.gid, { sel: ok ? cor : [qq.options.findIndex(o => !o.ok)], ok, t: 4000 }, 'seq');
  }
  bank.save(); bank.render();
  await sleep(400);

  const badge = q('.qrate');
  check('有正确率徽标', !!badge, q('.qrate'));
  if (badge) {
    const txt = badge.textContent;
    check('正确率 = 75%（3 对 / 4 做）', /75%/.test(txt), txt);
    check('徽标里带「对/总」明细 3/4', /3\/4/.test(txt.replace(/\s/g, '')), txt);
    check('徽标就在题号旁边（同一个 .qhead 里）',
          !!badge.closest('.qhead') && !!badge.parentElement.querySelector('.qidx'),
          { inHead: !!badge.closest('.qhead') });
    check('徽标紧跟在 .qidx 之后',
          badge.previousElementSibling && badge.previousElementSibling.classList.contains('qidx'),
          badge.previousElementSibling && badge.previousElementSibling.className);
  }

  /* 各板块口径：只算**本板块**题池内的题。
     板块隔离之后，数据必须真的落到对应板块里，否则测的就不是这里想验的东西。 */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.wrong = []; bank.S.wcnt = {}; bank.S.streak = {};
  const singles = bank.QS.filter(x => x.type === '单选题');
  const multis = bank.QS.filter(x => x.type === '多选题');
  const okSel = qq => qq.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
  const badSel = qq => [qq.options.findIndex(o => !o.ok)];

  /* 单选专项：做 2 题全对 */
  singles.slice(0, 2).forEach(qq => {
    bank.setRec(qq.gid, { sel: okSel(qq), ok: true, t: 3000, at: Date.now() }, 'single');
  });
  /* 多选专项：做 2 题全错 */
  multis.slice(0, 2).forEach(qq => {
    bank.setRec(qq.gid, { sel: badSel(qq), ok: false, t: 3000, at: Date.now() }, 'multi');
  });
  /* 顺序刷题：做 4 题，2 对 2 错 → 50% */
  singles.slice(10, 14).forEach((qq, i) => {
    const bad = qq.options.findIndex(o => !o.ok);
    const ok = i % 2 === 0 && bad >= 0;
    bank.setRec(qq.gid, { sel: ok ? okSel(qq) : badSel(qq), ok, t: 3000, at: Date.now() }, 'seq');
  });
  bank.save();

  bank.S.mode = 'single'; bank.save(); bank.render(); await sleep(350);
  check('单选专项正确率 = 100%（2/2）',
        /100%/.test(q('.qrate').textContent), q('.qrate') && q('.qrate').textContent);
  check('单选专项徽标明细是 2/2（不含其他板块的题）',
        /2\/2/.test((q('.qrate').textContent || '').replace(/\s/g, '')),
        q('.qrate') && q('.qrate').textContent);

  bank.S.mode = 'multi'; bank.save(); bank.render(); await sleep(350);
  check('多选专项正确率 = 0%（0/2）',
        /0%/.test(q('.qrate').textContent), q('.qrate') && q('.qrate').textContent);
  check('多选专项徽标明细是 0/2',
        /0\/2/.test((q('.qrate').textContent || '').replace(/\s/g, '')),
        q('.qrate') && q('.qrate').textContent);

  bank.S.mode = 'seq'; bank.save(); bank.render(); await sleep(350);
  check('顺序刷题正确率 = 50%（2 对 / 4 做）',
        /50%/.test(q('.qrate').textContent), q('.qrate') && q('.qrate').textContent);
  check('顺序刷题徽标明细是 2/4（不含单选/多选专项的题）',
        /2\/4/.test((q('.qrate').textContent || '').replace(/\s/g, '')),
        q('.qrate') && q('.qrate').textContent);

  /* rateOfList 纯函数口径：现在第二个参数是板块 */
  check('rateOfList 对空数组返回 0',
        bank.rateOfList ? bank.rateOfList([]).total === 0 : true);
  if (bank.rateOfList) {
    const r1 = bank.rateOfList(singles.slice(0, 2), 'single');
    check('rateOfList 计算正确（2/2=100%）', r1.total === 2 && r1.right === 2 && r1.rate === 100, r1);
    const r2 = bank.rateOfList(multis.slice(0, 2), 'multi');
    check('rateOfList 计算正确（0/2=0%）', r2.total === 2 && r2.right === 0 && r2.rate === 0, r2);
    /* ★ 关键：同一批题，换个板块读就必须是 0 —— 证明按板块隔离 */
    const r3 = bank.rateOfList(singles.slice(0, 2), 'multi');
    check('★ rateOfList 按板块隔离：单选专项的题在多选板块里算作未做',
          r3.total === 0, r3);
  }

  /* 错题本板块：只显示错题本内那些题的正确率 */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.wrong = []; bank.S.wcnt = {}; bank.S.streak = {};
  const w1 = singles[10], w2 = singles[11];
  bank.noteWrong(w1.gid); bank.noteWrong(w2.gid);
  bank.setRec(w1.gid, { sel: [0], ok: false, t: 2000 }, 'wrong');
  bank.setRec(w2.gid, { sel: w2.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0), ok: true, t: 2000 }, 'wrong');
  bank.S.mode = 'wrong'; bank.S.pos.wrong = 0;
  bank.save(); bank.render(); await sleep(400);
  check('错题本板块显示正确率 50%（1/2）',
        /50%/.test(q('.qrate') ? q('.qrate').textContent : ''), q('.qrate') && q('.qrate').textContent);

  /* 收藏板块 */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.star = []; bank.S.wrong = []; bank.S.wcnt = {}; bank.S.streak = {};
  const s1 = singles[20], s2 = singles[21];
  bank.S.star = [s1.gid, s2.gid];
  bank.setRec(s1.gid, { sel: s1.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0), ok: true, t: 2000 }, 'star');
  bank.S.mode = 'star'; bank.S.pos.star = 0;
  bank.save(); bank.render(); await sleep(400);
  check('收藏板块只按收藏内的题算（1 做 1 对 = 100%）',
        /100%/.test(q('.qrate') ? q('.qrate').textContent : ''), q('.qrate') && q('.qrate').textContent);

  /* =========================================================
     三、回归：正常答题流程没被破坏
     ========================================================= */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.mode = 'seq'; bank.S.pos.seq = 0; bank.S.reveal = {};
  bank.S.memorizing = false; bank.save(); bank.render();
  await sleep(400);
  const q0 = bank.QS[0];
  const corIdx = q0.options.findIndex(o => o.ok);
  const view = bank.optionView(q0);
  const dispPos = view.order.indexOf(corIdx);
  click(qa('.opt')[dispPos]);
  await sleep(400);
  check('单选题点正确选项后正常判分', !!q('.result') && q('.result').classList.contains('ok'),
        q('.result') && q('.result').className);
  check('答完后正确率徽标仍在', !!q('.qrate'), q('.qrate') && q('.qrate').textContent);

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
