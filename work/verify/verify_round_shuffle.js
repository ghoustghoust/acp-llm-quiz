/**
 * verify_round_shuffle.js — 验证「顺序刷题每次重置后换一套选项位置」
 *
 * 关键风险点：
 *   1. 重置后排列必须真的变（不是碰巧）
 *   2. 重置后答案不能错位（存储层用原始下标）
 *   3. 不重置时排列必须稳定（刷新/切页面不变）
 *   4. 同一道题在顺序/错题本/收藏 页面位置要一致
 *   5. 「以上所有」类题永远不打乱
 *   6. 轮次要能跨刷新保留
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

/* 抓取一组题在当前轮次下的排列签名，用于比较「是否变了」 */
function orderSignature(bank, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const qq = bank.QS[i];
    if (!bank.canShuffleOptions(qq)) continue;
    out.push(qq.gid + ':' + bank.optionView(qq).order.join(''));
  }
  return out.join('|');
}

(async () => {
  await sleep(400);
  const bank = window.__bank;
  window.confirm = () => true;

  /* =========================================================
     1. 顺序刷题：默认就应打乱选项
     ========================================================= */
  bank.S.mode = 'seq';
  bank.save(); bank.render();
  await sleep(350);

  const vSeq = bank.optionView(bank.QS[0]);
  check('顺序刷题现在也会打乱选项', vSeq.shuffled === true, vSeq);
  check('顺序刷题排列是合法排列',
        JSON.stringify(vSeq.order.slice().sort((a,b)=>a-b)) ===
        JSON.stringify(bank.QS[0].options.map((_,i)=>i)), vSeq.order);

  /* 页面上确实渲染成了打乱顺序 */
  const domOrder = await (async () => {
    const opts = qa('.opt');
    if (!opts.length) return null;
    const texts = opts.map(o => o.querySelector('.v').textContent.trim());
    const orig = bank.QS[0].options.map(o => String(o.t).trim());
    return { texts, orig };
  })();
  check('渲染的选项文本是同一组（只是顺序不同）',
        domOrder && JSON.stringify(domOrder.texts.slice().sort()) === JSON.stringify(domOrder.orig.slice().sort()),
        domOrder);

  /* 显示顺序应与 optionView 一致 */
  const expectedTexts = vSeq.order.map(oi => String(bank.QS[0].options[oi].t).trim());
  check('渲染顺序 = optionView 给出的顺序',
        domOrder && JSON.stringify(domOrder.texts) === JSON.stringify(expectedTexts),
        { dom: domOrder && domOrder.texts.slice(0,2), exp: expectedTexts.slice(0,2) });

  /* =========================================================
     2. 不重置时排列稳定（刷新/重渲染不变）
     ========================================================= */
  const sig1 = orderSignature(bank, 30);
  bank.render();
  await sleep(200);
  const sig1b = orderSignature(bank, 30);
  check('重渲染后排列不变', sig1 === sig1b);

  /* 切到别的页面再切回来，排列应不变 */
  click(tabByText('统计'));
  await sleep(300);
  click(tabByText('顺序刷题'));
  await sleep(300);
  const sig1c = orderSignature(bank, 30);
  check('切页面后排列不变', sig1 === sig1c);

  /* =========================================================
     3. 重置 → 排列必须变
     ========================================================= */
  const roundBefore = bank.S.optRound || 0;
  click('#btReset');
  await sleep(600);

  check('重置后轮次 +1', (bank.S.optRound || 0) === roundBefore + 1, { before: roundBefore, after: bank.S.optRound });

  const sig2 = orderSignature(bank, 30);
  check('重置后选项排列整体变了', sig1 !== sig2, { sig1: sig1.slice(0, 60), sig2: sig2.slice(0, 60) });

  /* 逐题统计：多少题的排列变了 */
  let changed = 0, same = 0;
  for (let i = 0; i < 30; i++) {
    const qq = bank.QS[i];
    if (!bank.canShuffleOptions(qq)) continue;
    const v = bank.optionView(qq);
    // 与第 1 轮对比：用 roundBefore 重算
    const savedRound = bank.S.optRound;
    bank.S.optRound = roundBefore;
    const v0 = bank.optionView(qq);
    bank.S.optRound = savedRound;
    if (JSON.stringify(v.order) !== JSON.stringify(v0.order)) changed++;
    else same++;
  }
  check('重置后绝大多数题的排列都变了', changed > 20, { changed, same });
  check('重置后排列仍全部合法', (function(){
    for (let i = 0; i < 30; i++) {
      const qq = bank.QS[i];
      if (!bank.canShuffleOptions(qq)) continue;
      const v = bank.optionView(qq);
      const s = v.order.slice().sort((a,b)=>a-b);
      const e = qq.options.map((_,k)=>k);
      if (JSON.stringify(s) !== JSON.stringify(e)) return false;
    }
    return true;
  })());

  /* =========================================================
     4. 连续重置多次，每次都要换
     ========================================================= */
  const sigs = [orderSignature(bank, 20)];
  for (let r = 0; r < 3; r++) {
    click('#btReset');
    await sleep(500);
    sigs.push(orderSignature(bank, 20));
  }
  const uniqueSigs = new Set(sigs);
  check('连续 4 轮（含初始）排列各不相同', uniqueSigs.size === sigs.length,
        { count: uniqueSigs.size, total: sigs.length });

  /* =========================================================
     5. 重置后答案不错位（点正确选项仍然判对）
     ========================================================= */
  click(tabByText('顺序刷题'));
  await sleep(400);

  const curQ = (function(){
    const opts = qa('.opt');
    if (!opts.length) return null;
    const qtext = q('.qtext').textContent.trim();
    return bank.QS.find(x => x.q.trim() === qtext) || null;
  })();
  check('能定位当前题', !!curQ);

  if (curQ) {
    const v = bank.optionView(curQ);
    const cOrig = curQ.options.findIndex(o => o.ok);
    const dPos = v.order.indexOf(cOrig);
    const opts = qa('.opt');
    const shownText = opts[dPos].querySelector('.v').textContent.trim();
    check('重置后正确选项仍显示在预期位置',
          shownText === String(curQ.options[cOrig].t).trim(),
          { shownText: shownText.slice(0,30), expect: String(curQ.options[cOrig].t).slice(0,30) });

    await sleep(400);
    opts[dPos].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(500);
    check('重置后点正确选项仍判对', q('.result') && q('.result').classList.contains('ok'),
          q('.result') && q('.result').className);

    const rec = bank.recOf(curQ.gid);
    check('存储的仍是原始下标', rec && JSON.stringify(rec.sel.slice().sort((a,b)=>a-b)) === JSON.stringify([cOrig]),
          { sel: rec && rec.sel, cOrig });
  }

  /* =========================================================
     6. 同一道题在 顺序 / 错题本 / 收藏 页面位置一致
     ========================================================= */
  const probe = bank.QS[5];
  bank.S.mode = 'seq';
  const seqOrder = bank.optionView(probe).order.join('');

  bank.S.mode = 'wrong';
  const wrongOrder = bank.optionView(probe).order.join('');

  bank.S.mode = 'star';
  const starOrder = bank.optionView(probe).order.join('');

  bank.S.mode = 'search';
  const searchOrder = bank.optionView(probe).order.join('');

  check('顺序刷题与错题本的选项排列一致', seqOrder === wrongOrder, { seqOrder, wrongOrder });
  check('顺序刷题与收藏的选项排列一致', seqOrder === starOrder, { seqOrder, starOrder });
  check('顺序刷题与搜索的选项排列一致', seqOrder === searchOrder, { seqOrder, searchOrder });

  /* =========================================================
     7. 「以上所有」类题永远不打乱
     ========================================================= */
  bank.S.mode = 'seq';
  const dependents = bank.QS.filter(x => !bank.canShuffleOptions(x));
  check('存在依赖选项位置的题', dependents.length > 0, dependents.length);
  let badDep = 0;
  dependents.forEach(x => {
    const v = bank.optionView(x);
    if (v.shuffled || v.order.some((o, i) => o !== i)) badDep++;
  });
  check('依赖顺序的题在顺序模式下保持原顺序', badDep === 0, badDep);

  /* =========================================================
     8. 随机刷题：关掉开关要能回到原顺序
     ========================================================= */
  bank.S.mode = 'random';
  bank.S.shuffleOpt = false;
  const rOff = bank.optionView(bank.QS[0]);
  check('随机刷题关闭开关后选项回到原顺序',
        !rOff.shuffled && rOff.order.every((o,i)=>o===i), rOff);

  bank.S.shuffleOpt = true;
  const rOn = bank.optionView(bank.QS[0]);
  check('随机刷题开启开关后选项打乱', rOn.shuffled === true, rOn);

  /* =========================================================
     9. 轮次跨刷新保留
     ========================================================= */
  bank.S.mode = 'seq';
  bank.save();
  const roundNow = bank.S.optRound;
  const raw = JSON.parse(window.localStorage.getItem('offline_tiku_aliyun-acp-llm_v1'));
  check('轮次已写入 localStorage', raw.optRound === roundNow, { saved: raw.optRound, mem: roundNow });

  /* 新实例读取（jsdom 各实例 storage 独立，这里验证 load 不报错、结构对） */
  const dom2 = mkDom();
  await sleep(400);
  const bank2 = dom2.window.__bank;
  check('新实例能正常启动', dom2.window.document.querySelector('#total').textContent === '395');
  check('新实例 optRound 是数字', typeof bank2.S.optRound === 'number', typeof bank2.S.optRound);

  /* =========================================================
     10. 顺序刷题页显示轮次标记
     ========================================================= */
  click(tabByText('顺序刷题'));
  await sleep(400);
  check('顺序刷题页显示轮次标记', !!q('.roundbadge'), !!q('.roundbadge'));
  check('轮次标记文案含「轮」',
        q('.roundbadge') && /轮/.test(q('.roundbadge').textContent),
        q('.roundbadge') && q('.roundbadge').textContent);

  /* =========================================================
     11. 考试不受轮次影响（开考时固化）
     ========================================================= */
  bank.S.mode = 'exam';
  bank.S.exam = null;
  bank.save(); bank.render();
  await sleep(300);
  const startBtn = qa('.btn.primary').find(b => b.textContent.includes('开始考试'));
  if (startBtn) {
    click(startBtn);
    await sleep(600);
    const E = bank.S.exam;
    check('考试能正常开始', !!E && !E.finished);

    const g0 = E.gids[0];
    const fixed0 = E.optOrder[g0].slice();

    // 考试中改轮次，不应影响本次考试
    const before = bank.S.optRound;
    bank.S.optRound = before + 5;
    const after = bank.optionView(bank.BY[g0]).order.slice();
    bank.S.optRound = before;

    check('考试中改轮次不影响已固化的选项顺序',
          JSON.stringify(after) === JSON.stringify(fixed0),
          { after, fixed0 });
  }

  /* =========================================================
     12. 无异常
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
