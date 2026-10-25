/**
 * verify_backup.js — 验证备份/恢复功能
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

  /* ---- 统计页有备份栏 ---- */
  click(tabByText('统计'));
  await sleep(350);

  check('统计页有备份栏', !!q('.backup'), !!q('.backup'));
  const bkBtns = qa('.backup .btn').map(b => b.textContent);
  check('有「导出备份」按钮', bkBtns.includes('导出备份'), bkBtns);
  check('有「从备份恢复」按钮', bkBtns.includes('从备份恢复'), bkBtns);
  check('有隐藏的文件选择框', !!q('.backup input[type=file]'));
  check('备份栏有说明文字', /本机浏览器/.test(q('.backup .bk-lb').textContent), q('.backup .bk-lb').textContent.slice(0, 40));

  /* ---- 构造数据后导出 ---- */
  window.confirm = () => true;
  click('#btReset');
  await sleep(350);

  // 答 3 题，错 1 题
  await sleep(400);
  const q0 = bank.QS[0];
  const badIdx = q0.options.findIndex(o => !o.ok);
  qa('.opt') && qa('.opt')[badIdx] && qa('.opt')[badIdx].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);

  bank.noteWrong(bank.QS[1].gid);
  bank.noteWrong(bank.QS[1].gid);
  bank.setRec(bank.QS[1].gid, { sel: [0], ok: false, t: 5000 }, 'seq');
  bank.noteWrong(bank.QS[2].gid);
  bank.setRec(bank.QS[2].gid, { sel: [0], ok: false, t: 4000 }, 'seq');
  bank.S.star.push(bank.QS[5].gid);
  bank.save();
  await sleep(200);

  const snapshot = {
    answered: bank.aggregateCount(),
    wrong: bank.S.wrong.length,
    star: bank.S.star.length,
    wcnt2: bank.S.wcnt[bank.QS[1].gid],
  };

  check('导出前有数据', snapshot.answered >= 3, snapshot);

  /* ---- buildBackup 结构正确 ---- */
  const bk = bank.buildBackup();
  check('备份含 __type 标识', bk.__type === 'offline-tiku-backup', bk.__type);
  check('备份含题库 key', bk.__bank === 'aliyun-acp-llm', bk.__bank);
  check('备份含导出时间', typeof bk.__exportedAt === 'string' && bk.__exportedAt.length > 10);
  check('备份含 ansAll（按板块分开存）', !!bk.data.ansAll, Object.keys(bk.data || {}));
  check('备份不再用单份 ans', !bk.data.ans, Object.keys(bk.data || {}));
  check('备份含 wcnt', !!bk.data.wcnt);
  check('备份含 stats', !!bk.data.stats);
  check('备份版本号为 3（v3 补了板块隔离）', bk.__version === 3, bk.__version);

  /* ---- v2 新增字段必须都在 ----
     这里是真的踩过的缺陷：v1 只存错题本相关字段，
     换电脑导回后所有「已掌握」的题变回未掌握、攻坚池重新涨回去、
     成绩走势页归零。所以每一项都要单独断言。 */
  const V2_FIELDS = ['streak', 'daily', 'examHistory', 'optRound', 'pos', 'drill'];
  V2_FIELDS.forEach(f => {
    check('备份含 v2 字段 ' + f, bk.data[f] !== undefined, Object.keys(bk.data || {}));
  });

  /* ---- 模拟恢复：清空后导入 ---- */
  const backupJson = JSON.stringify(bk);

  // 保留一份 v2 数据的期望值（清空之前抓）
  const v2Expect = {
    streak: JSON.parse(JSON.stringify(bk.data.streak || {})),
    daily: JSON.parse(JSON.stringify(bk.data.daily || {})),
    examHistory: JSON.parse(JSON.stringify(bk.data.examHistory || [])),
    optRound: bk.data.optRound,
    pos: JSON.parse(JSON.stringify(bk.data.pos || {})),
    drill: JSON.parse(JSON.stringify(bk.data.drill || {})),
  };

  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};});
  bank.S.wrong = [];
  bank.S.star = [];
  bank.S.wcnt = {};
  bank.S.wlast = {};
  bank.S.streak = {};
  bank.S.daily = {};
  bank.S.examHistory = [];
  bank.save(); bank.render();
  await sleep(300);
  check('清空后已答为 0', bank.aggregateCount() === 0, bank.aggregateCount());
  check('清空后连续对数也为 0', Object.keys(bank.S.streak).length === 0, Object.keys(bank.S.streak).length);

  // 用 FileReader 需要 File 对象；jsdom 支持
  const file = new window.File([backupJson], 'backup.json', { type: 'application/json' });
  bank.importBackup(file);
  await sleep(600);

  check('恢复后已答数一致', bank.aggregateCount() === snapshot.answered, [bank.aggregateCount(), snapshot.answered]);
  check('恢复后错题本一致', bank.S.wrong.length === snapshot.wrong, [bank.S.wrong.length, snapshot.wrong]);
  check('恢复后收藏一致', bank.S.star.length === snapshot.star, [bank.S.star.length, snapshot.star]);
  check('恢复后错题次数一致', bank.S.wcnt[bank.QS[1].gid] === snapshot.wcnt2, [bank.S.wcnt[bank.QS[1].gid], snapshot.wcnt2]);
  check('恢复后错题时间恢复', typeof bank.S.wlast[bank.QS[1].gid] === 'number', bank.S.wlast[bank.QS[1].gid]);

  /* ---- v2 字段真的恢复出来了（不是只写进备份、导入时丢掉）---- */
  check('恢复后 streak 一致',
        JSON.stringify(bank.S.streak) === JSON.stringify(v2Expect.streak),
        [bank.S.streak, v2Expect.streak]);
  check('恢复后 daily 一致',
        JSON.stringify(bank.S.daily) === JSON.stringify(v2Expect.daily),
        [bank.S.daily, v2Expect.daily]);
  check('恢复后 examHistory 一致',
        JSON.stringify(bank.S.examHistory) === JSON.stringify(v2Expect.examHistory),
        [bank.S.examHistory, v2Expect.examHistory]);
  check('恢复后 optRound 一致', bank.S.optRound === v2Expect.optRound, [bank.S.optRound, v2Expect.optRound]);
  check('恢复后 pos 一致',
        JSON.stringify(bank.S.pos) === JSON.stringify(v2Expect.pos),
        [bank.S.pos, v2Expect.pos]);
  check('恢复后三个专项 drill 一致',
        JSON.stringify(bank.S.drill) === JSON.stringify(v2Expect.drill),
        [bank.S.drill, v2Expect.drill]);

  /* ---- 恢复后界面同步 ---- */
  check('恢复后界面已练数更新', q('#done').textContent === String(snapshot.answered), [q('#done').textContent, snapshot.answered]);

  /* ---- 拒绝非法文件 ---- */
  const bad1 = new window.File(['{"foo":1}'], 'bad.json', { type: 'application/json' });
  bank.importBackup(bad1);
  await sleep(400);
  check('拒绝非本题库备份（结构不对）', bank.aggregateCount() === snapshot.answered, '数据被误改');

  const bad2 = new window.File(['not json at all {{{'], 'bad2.json', { type: 'application/json' });
  bank.importBackup(bad2);
  await sleep(400);
  check('拒绝非法 JSON', bank.aggregateCount() === snapshot.answered, '数据被误改');

  /* ---- 恢复时过滤不存在的题号 ---- */
  const dirty = {
    __type: 'offline-tiku-backup', __version: 1, __bank: 'aliyun-acp-llm',
    __exportedAt: new Date().toISOString(),
    data: {
      ans: { 'NOT-A-REAL-GID': { sel: [0], ok: true, t: 1000 } },
      wrong: ['NOT-A-REAL-GID'], star: ['NOT-A-REAL-GID'],
      wcnt: { 'NOT-A-REAL-GID': 5 }, wlast: { 'NOT-A-REAL-GID': 123 },
      stats: { day: '2026-10-22', dayMs: 1000, totalMs: 1000 }
    }
  };
  bank.importBackup(new window.File([JSON.stringify(dirty)], 'dirty.json', { type: 'application/json' }));
  await sleep(500);
  check('导入时过滤掉不存在的题号', bank.aggregateCount() === 0, bank.aggregateCount());
  check('过滤后错题本为空', bank.S.wrong.length === 0, bank.S.wrong.length);

  /* ---- 旧版（v1）备份仍能导入 ----
     v1 文件里没有 streak/daily/examHistory 等字段，不能因此报错或崩，
     只恢复它有的东西；缺的部分保持导入前的当前值。 */
  bank.BOARD_KEYS.forEach(k=>{bank.S.ansAll[k]={};}); bank.S.streak = {}; bank.S.daily = {};
  bank.save();
  const v1 = {
    __type: 'offline-tiku-backup', __version: 1, __bank: 'aliyun-acp-llm',
    __exportedAt: '2026-10-20T00:00:00.000Z',
    data: {
      ans: { [bank.QS[7].gid]: { sel: [0], ok: true, t: 2000 } },
      wrong: [bank.QS[7].gid], star: [], wcnt: {}, wlast: {},
      stats: { day: '2026-10-20', dayMs: 5000, totalMs: 5000 }, memorizing: false
    }
  };
  bank.importBackup(new window.File([JSON.stringify(v1)], 'v1.json', { type: 'application/json' }));
  await sleep(500);
  check('v1 旧备份仍能导入', bank.aggregateCount() === 1, bank.aggregateCount());
  check('v1 备份不会把 streak 弄坏', typeof bank.S.streak === 'object' && bank.S.streak !== null, typeof bank.S.streak);
  check('v1 备份不会把 daily 置成非法值', typeof bank.S.daily === 'object' && bank.S.daily !== null, typeof bank.S.daily);

  /* ---- buildBackup 返回的是活引用，但要能深拷贝成快照 ----
     真实缺陷：buildBackup() 直接返回 S.ans / S.drill 等对象本身。
     调用方若在序列化之前改了 S，备份内容会跟着变。exportBackup 里
     立刻 stringify 所以没暴露，但把「预览备份」这类用法一加就会踩。
     所以导出走 buildBackupSnapshot()。 */
  check('暴露了 buildBackupSnapshot', typeof bank.buildBackupSnapshot === 'function');
  if (typeof bank.buildBackupSnapshot === 'function') {
    bank.S.drill.single.pos = 77;
    const snap = bank.buildBackupSnapshot();
    bank.S.drill.single.pos = 0;
    check('快照不随后续修改而变（深拷贝）', snap.data.drill.single.pos === 77, snap.data.drill.single.pos);
  }

  /* ---- 卸载事件注册了 pagehide ---- */
  check('注册了 pagehide 保存（移动端更可靠）', /pagehide/.test(html));
  check('visibilitychange 隐藏时保存', /document\.hidden/.test(html) && /visibilitychange/.test(html));

  /* ---- 无异常 ---- */
  check('无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3));

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
  console.log(NL + '--- 通过 ' + R.pass.length + ' 项 ---');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  console.log(NL + '--- 失败 ' + R.fail.length + ' 项 ---');
  R.fail.forEach(f => console.log('  ✗ ' + f));
  process.exit(2);
});
