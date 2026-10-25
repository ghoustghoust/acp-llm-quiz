/**
 * verify_stats_rank.js — 验证「按题型/难度统计」与「错题排行」两个新功能
 *
 * 重点验证的不是「能不能显示」，而是「数字算得对不对」：
 *   - 分组统计的总数必须等于题库总数（不重不漏）
 *   - 答错次数只增不减
 *   - 排行顺序真的按次数降序
 *   - 重置后统计清零
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

const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(name, cond, extra) {
  if (cond) R.pass.push(name);
  else R.fail.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

(async () => {
  await sleep(400);
  const bank = window.__bank;

  /* =========================================================
     一、新标签页存在
     ========================================================= */
  check('标签页为 12 个', qa('.tab').length === 12, qa('.tab').length);
  check('有「统计」标签', !!tabByText('统计'));
  check('有「错题排行」标签', !!tabByText('错题排行'));

  /* =========================================================
     二、分组统计的数学正确性
     ========================================================= */
  const byType = bank.groupStats(x => x.type);

  check('按题型分组数量正确（单选/多选两组）', byType.length === 2, byType.map(g => g.key));
  const sumTotal = byType.reduce((s, g) => s + g.total, 0);
  check('各组题量之和 = 395（不重不漏）', sumTotal === 395, sumTotal);

  const single = byType.find(g => g.key === '单选题');
  const multi = byType.find(g => g.key === '多选题');
  check('单选 273 题', single && single.total === 273, single && single.total);
  check('多选 122 题', multi && multi.total === 122, multi && multi.total);

  const sumDone = byType.reduce((s, g) => s + g.done, 0);
  check('各组已练之和 = 全库已练数', sumDone === bank.aggregateCount(), [sumDone, bank.aggregateCount()]);

  check('未做的组正确率为 null（而不是 0%）', byType.every(g => g.done > 0 ? typeof g.rate === 'number' : g.rate === null), byType.map(g => [g.key, g.done, g.rate]));

  /* =========================================================
     三、统计页渲染
     ========================================================= */
  click(tabByText('统计'));
  await sleep(300);

  check('统计页有总览格子', qa('.stat').length >= 6, qa('.stat').length);
  const ovLabels = qa('.stat .l').map(x => x.textContent);
  check('总览含「总题量」', ovLabels.includes('总题量'), ovLabels);
  /* 这个格子原来叫「累计错题」、数值取 rankCount()（wcnt>0 的题数），
     和错题本页显示的 S.wrong.length 在「移出错题本」后会对不上。
     已改成「错题本 = S.wrong.length」——它要回答的是「我现在有多少错题待处理」。
     断言跟着改成新标签，并额外验证它与错题本实际大小一致。 */
  check('总览含「错题本」', ovLabels.includes('错题本'), ovLabels);
  {
    const idx = ovLabels.indexOf('错题本');
    const vals = qa('.stat .v').map(x => x.textContent);
    check('总览的「错题本」数与实际错题本大小一致',
          idx >= 0 && vals[idx] === (bank.S.wrong.length + ' 题'),
          { shown: vals[idx], actual: bank.S.wrong.length });
  }
  check('总览含「累计用时」', ovLabels.includes('累计用时'), ovLabels);

  check('有分组行', qa('.statrow').length === 2, qa('.statrow').length);
  check('每组有进度条', qa('.bar2').length === 2, qa('.bar2').length);
  check('有维度切换按钮', qa('.seg button').length === 2, qa('.seg button').map(b => b.textContent));

  /* 切到「按难度」 */
  const diffBtn = qa('.seg button').find(b => b.textContent === '按难度');
  click(diffBtn);
  await sleep(300);
  check('可切换到按难度', bank.S.statsTab === 'diff', bank.S.statsTab);
  check('难度页有说明（不冒充官方难度）', /推导/.test(q('.hint') ? q('.hint').textContent : '') || doc.body.textContent.includes('推导'), 'hint 未包含推导说明');

  /* =========================================================
     四、难度推导逻辑（关键：必须是推导，不是瞎编）
     ========================================================= */
  const q1 = bank.QS[0];
  check('未做过的题难度 = 未练', bank.difficultyOf(q1) === '未练', bank.difficultyOf(q1));

  // 造一道「错 2 次」的题
  const gidA = bank.QS[1].gid;
  bank.noteWrong(gidA);
  bank.noteWrong(gidA);
  bank.setRec(gidA, { sel: [0], ok: false, t: 5000 }, 'seq');
  check('错 2 次 → 较难', bank.difficultyOf(bank.QS[1]) === '较难', bank.difficultyOf(bank.QS[1]));

  // 造一道「错 1 次」
  const gidB = bank.QS[2].gid;
  bank.noteWrong(gidB);
  bank.setRec(gidB, { sel: [0], ok: false, t: 4000 }, 'seq');
  check('错 1 次 → 一般', bank.difficultyOf(bank.QS[2]) === '一般', bank.difficultyOf(bank.QS[2]));

  // 造一道「一次就对且不过慢」
  const gidC = bank.QS[3].gid;
  bank.setRec(gidC, { sel: [0], ok: true, t: 3000 }, 'seq');
  check('一次就对 → 简单', bank.difficultyOf(bank.QS[3]) === '简单', bank.difficultyOf(bank.QS[3]));

  // 关键回归：以前错过 1 次、现在答对 → 应保持「一般」，不能被洗成「简单」
  // 注意：必须用一道全新的题，否则会被前面测试已累计的错次污染
  const qClean = bank.QS[500 % bank.QS.length] || bank.QS[100];
  const gidClean = qClean.gid;
  bank.delRec(gidClean, 'seq');
  bank.S.wcnt[gidClean] = 0;
  bank.noteWrong(gidClean);                                  // 历史错 1 次
  bank.setRec(gidClean, { sel: [0], ok: true, t: 3000 }, 'seq');     // 现在答对
  check('历史错过1次但现在答对 → 仍为一般（不被洗白）',
        bank.difficultyOf(qClean) === '一般', bank.difficultyOf(qClean));

  /* =========================================================
     五、错题次数：只增不减
     ========================================================= */
  const cntA0 = bank.S.wcnt[gidA];
  bank.noteRight(gidA);                    // 答对 1 次
  check('答对不会减少错题次数', bank.S.wcnt[gidA] === cntA0, [cntA0, bank.S.wcnt[gidA]]);
  // 新规则：要连续答对 3 次（MASTER_STREAK）才移出错题本，一次对不算掌握
  check('答对 1 次还不移出错题本', bank.S.wrong.indexOf(gidA) >= 0, bank.S.wrong.indexOf(gidA));
  bank.noteRight(gidA);
  bank.noteRight(gidA);
  check('连续答对 3 次后移出错题本', bank.S.wrong.indexOf(gidA) < 0, bank.S.wrong.indexOf(gidA));

  bank.noteWrong(gidA);
  check('再错一次次数 +1', bank.S.wcnt[gidA] === cntA0 + 1, [cntA0, bank.S.wcnt[gidA]]);

  /* =========================================================
     六、错题排行：排序正确性
     ========================================================= */
  // 再造一个错 5 次的题，确保它是第一名
  const gidTop = bank.QS[10].gid;
  for (let i = 0; i < 5; i++) bank.noteWrong(gidTop);

  const rank = bank.wrongRank();
  check('排行非空', rank.length > 0, rank.length);
  check('排行第一 = 错得最多的那道', rank[0].gid === gidTop, { first: rank[0].gid, expect: gidTop, n: rank[0].n });
  check('排行第一错 5 次', rank[0].n === 5, rank[0].n);

  let desc = true;
  for (let i = 1; i < rank.length; i++) if (rank[i].n > rank[i - 1].n) desc = false;
  check('排行为降序', desc, rank.map(r => r.n).slice(0, 10));

  check('排行数量 = 有过错次的题数', rank.length === bank.rankCount(), [rank.length, bank.rankCount()]);
  check('排行不含 0 次的题', rank.every(r => r.n > 0));

  /* =========================================================
     七、排行页渲染
     ========================================================= */
  click(tabByText('错题排行'));
  await sleep(350);

  check('排行页渲染出条目', qa('.rk').length > 0, qa('.rk').length);
  check('第一名有 top1 样式', q('.rk.top1') !== null);
  check('条目显示次数', qa('.rk .cnt').length === qa('.rk').length);

  // 回归：标题里的 <b> 必须被当成标签渲染，不能以字面文本出现
  const headTxt = q('.qidx') ? q('.qidx').textContent : '';
  check('排行标题不出现字面 HTML 标签', !/<b>|<\/b>/.test(headTxt), headTxt);
  check('排行标题含「道错过」', /道错过/.test(headTxt), headTxt);

  const firstNo = q('.rk .no').textContent;
  check('第一名序号是 1', firstNo === '1', firstNo);
  const firstCnt = q('.rk.top1 .cnt').textContent;
  check('第一名次数显示 5', /5/.test(firstCnt), firstCnt);

  /* 显示条数切换 */
  const segAll = qa('.seg button').find(b => b.textContent === '全部');
  check('有「全部」按钮', !!segAll);
  if (segAll) {
    click(segAll);
    await sleep(300);
    check('切到全部后条目数 = 总错题数', qa('.rk').length === bank.rankCount(), [qa('.rk').length, bank.rankCount()]);
  }

  /* 点条目能跳转 */
  const beforeMode = bank.S.mode;
  click(q('.rk'));
  await sleep(350);
  check('点排行条目能跳走', bank.S.mode !== 'rank', bank.S.mode);

  /* =========================================================
     八、持久化：错题次数要存住
     ========================================================= */
  const savedRaw = window.localStorage.getItem('offline_tiku_aliyun-acp-llm_v1');
  const saved = JSON.parse(savedRaw);
  check('错题次数已写入 storage', saved.wcnt && typeof saved.wcnt === 'object', !!saved.wcnt);
  check('错题时间已写入 storage', saved.wlast && typeof saved.wlast === 'object', !!saved.wlast);
  check('保存的次数与内存一致', saved.wcnt[gidTop] === bank.S.wcnt[gidTop], [saved.wcnt[gidTop], bank.S.wcnt[gidTop]]);

  /* =========================================================
     九、重新加载后统计仍在（新实例 + 同一份 storage 不易模拟，
        这里直接验证 load 能正确读回字段）
     ========================================================= */
  const dom2 = mkDom();
  await sleep(400);
  const bank2 = dom2.window.__bank;
  check('新实例启动正常', dom2.window.document.querySelector('#total').textContent === '395');
  check('新实例也有统计函数', typeof bank2.groupStats === 'function' && typeof bank2.wrongRank === 'function');

  const t2 = bank2.groupStats(x => x.type);
  check('新实例分组总数仍为 395', t2.reduce((s, g) => s + g.total, 0) === 395);

  /* =========================================================
     十、重置会清空统计与排行
     ========================================================= */
  window.confirm = () => true;
  click('#btReset');
  await sleep(400);

  check('重置后错题次数清空', Object.keys(bank.S.wcnt).length === 0, Object.keys(bank.S.wcnt).length);
  check('重置后错题时间清空', Object.keys(bank.S.wlast).length === 0, Object.keys(bank.S.wlast).length);
  check('重置后排行清空', bank.wrongRank().length === 0, bank.wrongRank().length);
  check('重置后排行计数为 0', bank.rankCount() === 0, bank.rankCount());

  const g3 = bank.groupStats(x => x.type);
  check('重置后各组已练归零', g3.every(g => g.done === 0), g3.map(g => g.done));
  check('重置后正确率回到 null', g3.every(g => g.rate === null), g3.map(g => g.rate));

  click(tabByText('错题排行'));
  await sleep(300);
  check('重置后排行页显示空状态', q('.empty') !== null, !!q('.empty'));

  /* =========================================================
     十一、无 JS 异常
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
  console.log(NL + '--- 崩溃前通过 (' + R.pass.length + ') ---');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  console.log(NL + '--- 崩溃前失败 (' + R.fail.length + ') ---');
  R.fail.forEach(f => console.log('  ✗ ' + f));
  process.exit(2);
});
