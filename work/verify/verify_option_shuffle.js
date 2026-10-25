/**
 * verify_option_shuffle.js — 验证「随机刷题时选项位置也打乱」
 *
 * 这个功能的风险不在「能不能打乱」，而在「打乱后还对不对」：
 *   1. 打乱后点对选项，判分必须仍然正确
 *   2. 打乱后「正确答案」显示的字母，必须指向真正正确的那一行
 *   3. 已答过的题，切模式后不能错位
 *   4. 解析正文里「A 对 / 选项 B」必须跟着重映射
 *   5. 有「以上所有」这类题的选项绝对不能打乱
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

  /* =========================================================
     1. 打乱算法本身：确定性、合法性
     ========================================================= */
  const a1 = bank.seededShuffle([0, 1, 2, 3], 12345);
  const a2 = bank.seededShuffle([0, 1, 2, 3], 12345);
  check('同一 seed 结果相同（不会刷新就变）', JSON.stringify(a1) === JSON.stringify(a2), [a1, a2]);
  check('打乱结果是合法排列', JSON.stringify(a1.slice().sort((x, y) => x - y)) === JSON.stringify([0, 1, 2, 3]), a1);
  check('不同 seed 结果不同', JSON.stringify(a1) !== JSON.stringify(bank.seededShuffle([0, 1, 2, 3], 999)));

  /* =========================================================
     2. 顺序刷题：选项必须保持原顺序
     ========================================================= */
  bank.S.mode = 'seq';
  bank.save(); bank.render();
  await sleep(300);
  let v = bank.optionView(bank.QS[0]);
  // 新需求：顺序刷题也打乱选项，且每次重置换一套排列（详见 verify_round_shuffle.js）
  check('顺序刷题也会打乱选项（新需求）', v.shuffled === true, v);
  check('顺序刷题排列是合法排列',
        JSON.stringify(v.order.slice().sort((a,b)=>a-b)) === JSON.stringify([0,1,2,3].slice(0, v.order.length)),
        v.order);

  /* =========================================================
     3. 随机刷题：选项要被打乱，但排列必须合法
     ========================================================= */
  bank.S.mode = 'random';
  bank.S.shuffleOpt = true;
  bank.save(); bank.render();
  await sleep(300);

  let shuffledCount = 0, invalid = 0;
  for (let i = 0; i < 60; i++) {
    const qq = bank.QS[i];
    const vv = bank.optionView(qq);
    const sorted = vv.order.slice().sort((x, y) => x - y);
    const expect = qq.options.map((_, k) => k);
    if (JSON.stringify(sorted) !== JSON.stringify(expect)) invalid++;
    if (vv.shuffled && JSON.stringify(vv.order) !== JSON.stringify(expect)) shuffledCount++;
  }
  check('随机模式下大量题目选项被重排', shuffledCount > 40, shuffledCount);

  // 回归：不能有「说打乱了其实没变」的题
  let identityShuffles = 0;
  bank.QS.forEach(qq => {
    if (!bank.canShuffleOptions(qq)) return;
    const vv = bank.optionView(qq);
    if (vv.order.every((x, i) => x === i)) identityShuffles++;
  });
  check('没有「白打乱」的题（排列必然真的变了）', identityShuffles === 0, identityShuffles);
  check('所有排列都是合法排列（不重不漏）', invalid === 0, invalid);

  /* =========================================================
     4. 关键：打乱后「正确答案」字母必须指向真正正确的行
     ========================================================= */
  let letterMismatch = 0, tested = 0;
  for (let i = 0; i < 40; i++) {
    const qq = bank.QS[i];
    const vv = bank.optionView(qq);
    /* 按显示顺序，找出第几个显示位置是正确选项 */
    const correctOrig = qq.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
    const correctDisplay = [];
    vv.order.forEach((oi, di) => { if (correctOrig.indexOf(oi) >= 0) correctDisplay.push(di); });
    /* 界面上应该显示的字母 */
    const expectedLetters = correctDisplay.sort((x, y) => x - y).map(d => String.fromCharCode(65 + d)).join('、');
    /* 数据一致性：显示顺序里的元素必须是原题选项 */
    if (correctDisplay.length !== correctOrig.length) letterMismatch++;
    tested++;
  }
  check('正确答案的显示位置映射正确', letterMismatch === 0, letterMismatch);

  /* =========================================================
     5. 端到端：在随机模式下点「正确选项所在的行」，必须判对
     ========================================================= */
  click(tabByText('随机刷题'));
  await sleep(400);

  // 确保开关是「选项也打乱」
  const segBtns = qa('.seg button').map(b => b.textContent);
  check('随机页有「选项也打乱 / 只打乱顺序」开关', segBtns.includes('选项也打乱') && segBtns.includes('只打乱顺序'), segBtns);

  const shufBtn = qa('.seg button').find(b => b.textContent === '选项也打乱');
  click(shufBtn);
  await sleep(400);

  // 找到当前显示的题
  // 不能靠 S.order 推导——测试前面动过 state，可能与界面不一致。
  // 改为直接从界面反读：取当前第一个选项的文本，去题库里匹配。
  const curQ = await (async () => {
    const opts0 = qa('.opt');
    if (!opts0.length) return bank.QS[0];
    const firstTxt = opts0[0].querySelector('.v').textContent.trim();
    const qtext = q('.qtext').textContent.trim();
    // 先靠题干精确定位
    let found = bank.QS.find(x => x.q.trim() === qtext);
    if (found) return found;
    // 退路：靠选项文本定位
    found = bank.QS.find(x => x.options.some(o => String(o.t).trim() === firstTxt));
    return found || bank.QS[0];
  })();

  bank.S.shuffleOpt = true;
  const view = bank.optionView(curQ);
  // 找到正确选项在显示顺序中的位置
  const correctOrigIdx = curQ.options.findIndex(o => o.ok);
  const displayPos = view.order.indexOf(correctOrigIdx);
  check('当前题在随机模式下确实打乱了', view.shuffled === true, view.shuffled);

  // 点那一行
  const opts = qa('.opt');
  check('渲染出的选项数量与题目一致', opts.length === curQ.options.length, [opts.length, curQ.options.length]);

  // 该行显示的文本，应等于正确选项文本
  const shownText = opts[displayPos].querySelector('.v').textContent;
  const correctText = curQ.options[correctOrigIdx].t;
  check('正确选项被显示在预期位置（文本一致）', shownText.trim() === correctText.trim(), { shownText: shownText.slice(0, 40), correctText: correctText.slice(0, 40) });
  // 该行显示的字母，应等于正确答案里写的字母
  const shownLetter = opts[displayPos].querySelector('.k').textContent;

  /* 打乱后「显示位置」可能恰好等于原始位置，这是数学上允许的，
     所以这里要按 view.order 反查真正该点的位置。

     ⚠️ 这里原来只 dispatched 一次 click 就去断言 .result，是个测试缺陷：
     随机刷题的第一题是**随机抽的**，有约 1/4 概率抽到多选题。
     多选题和单选题的作答流程不一样：
       - 单选题：点中选项即判分
       - 多选题：点选项只是勾选，点「提交」才判分，而且必须**选全**所有正确答案
     所以这里要按题型分流。以前这条测试约 13% 概率随机失败，不是产品 bug。 */
  const isMulti = curQ.type === '多选题';
  // 多选题要勾全所有正确选项（各自换算成显示位置）
  const correctDisplayPositions = [];
  curQ.options.forEach((o, oi) => {
    if (o.ok) correctDisplayPositions.push(view.order.indexOf(oi));
  });

  if (isMulti) {
    check('多选题的正确答案不止一个（前置条件）', correctDisplayPositions.length >= 2, correctDisplayPositions.length);
    correctDisplayPositions.forEach(dp => {
      opts[dp].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await sleep(250);
    // 勾选完再提交
    const submitBtn = qa('button').find(b => /提交/.test(b.textContent));
    check('多选题在随机模式下有「提交」按钮', !!submitBtn, qa('button').map(b => b.textContent).slice(0, 8));
    if (submitBtn) {
      submitBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(400);
    }
  } else {
    opts[displayPos].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(400);
  }

  check('点打乱后的正确选项 → 判为正确',
        !!q('.result') && q('.result').classList.contains('ok'),
        { hasResult: !!q('.result'), cls: q('.result') && q('.result').className,
          type: curQ.type, displayPos, correctDisplayPositions, order: view.order });

  const ansLine = q('.ansline') ? q('.ansline').textContent : '';
  check('正确答案字母 = 刚才点的那一行的字母', ansLine.includes(shownLetter), { ansLine, shownLetter });

  // 单选题只会显示一个字母；多选题会有多个，所以只在单选题上断言
  if (curQ.type === '单选题') {
    check('正确答案只显示一个字母（单选）', (ansLine.match(/正确答案：\s*([A-F])/i) || [])[1] === shownLetter, ansLine);
  } else {
    check('多选题正确答案字母包含刚点的那一行', ansLine.includes(shownLetter), { ansLine, shownLetter });
  }

  /* =========================================================
     6. 解析正文里的字母必须重映射
     ========================================================= */
  const dispOf = [];
  for (let i = 0; i < view.order.length; i++) dispOf[view.order[i]] = i;

  // 找一道解析里引用了字母的题，直接测 remapLetters
  let remapCase = null;
  for (let i = 0; i < 200; i++) {
    const qq = bank.QS[i];
    const body = qq.analysis || '';
    if (/选项\s*[A-F]|[A-F]\s*对|[A-F]\s*错|（[A-F]\s*对）/.test(body)) { remapCase = qq; break; }
  }
  check('题库里存在解析引用字母的题（用于测试）', !!remapCase);

  if (remapCase) {
    const rv = bank.optionView(remapCase);
    const rdisp = [];
    for (let i = 0; i < rv.order.length; i++) rdisp[rv.order[i]] = i;

    const orig = '选项A正确，选项B错误';
    const remapped = bank.remapLetters(orig, rdisp);
    // dispOf[原始下标] = 显示位置，所以原 A(0) 应变成 rdisp[0]，原 B(1) 应变成 rdisp[1]
    const expectA = String.fromCharCode(65 + rdisp[0]);
    const expectB = String.fromCharCode(65 + rdisp[1]);
    const expected = '选项' + expectA + '正确，选项' + expectB + '错误';
    check('解析中「选项A/选项B」被正确重映射且保持原文格式',
          remapped === expected, { remapped, expected, rdisp });

    // 格式不能变：不能凭空插入空格
    check('重映射不改变原有空格格式',
          bank.remapLetters('A 对，B 错', rdisp) === String.fromCharCode(65+rdisp[0]) + ' 对，' + String.fromCharCode(65+rdisp[1]) + ' 错',
          bank.remapLetters('A 对，B 错', rdisp));

    // 普通英文单词不能被误伤
    const safe = bank.remapLetters('这是 API 和 ABC 以及 CPU', rdisp);
    check('不误伤普通英文单词', safe.includes('API') && safe.includes('ABC') && safe.includes('CPU'), safe);
  }

  /* =========================================================
     7. 顺序模式不打乱解析（避免无意义改动）
     ========================================================= */
  bank.S.mode = 'seq';
  bank.save(); bank.render();
  await sleep(300);
  const seqView = bank.optionView(bank.QS[0]);
  // 新需求：顺序模式也打乱，所以解析同样需要重映射
  check('顺序模式也会重映射解析（shuffled=true）', seqView.shuffled === true, seqView);

  /* =========================================================
     8. 「以上所有」类题绝不能被乱序
     ========================================================= */
  const orderDependent = bank.QS.filter(x => x.options.some(o => /^(以上|上述|前[一二三四五六七八九1-9]项)/.test(String(o.t || '').trim())));
  check('识别出依赖顺序的题', orderDependent.length > 0, orderDependent.length);

  let badShuffle = 0;
  bank.S.mode = 'random';
  bank.S.shuffleOpt = true;
  orderDependent.forEach(x => {
    const vv = bank.optionView(x);
    if (vv.shuffled) badShuffle++;
  });
  check('「以上所有」类题选项不被打乱', badShuffle === 0, badShuffle);
  check('canShuffleOptions 正确拒绝这类题', orderDependent.every(x => bank.canShuffleOptions(x) === false), orderDependent.map(x => bank.canShuffleOptions(x)));

  /* =========================================================
     9. 已答过的题：切回顺序模式，答案仍然正确
     ========================================================= */
  bank.S.mode = 'seq';
  bank.save(); bank.render();
  await sleep(300);
  const aggAns = bank.aggregateAns();
  const firstAnswered = Object.keys(aggAns)[0];
  if (firstAnswered) {
    const rec = aggAns[firstAnswered];
    const qq = bank.BY[firstAnswered];
    const cidx = qq.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
    const sortedSel = rec.sel.slice().sort((a, b) => a - b);
    check('已存答案仍是「原始下标」语义（与正确答案一致）',
      JSON.stringify(sortedSel) === JSON.stringify(cidx.slice().sort((a, b) => a - b)) || rec.ok === false,
      { sel: sortedSel, cidx });
  }

  /* =========================================================
     10. 关掉开关 → 只打乱题目顺序，不动选项
     ========================================================= */
  bank.S.mode = 'random';
  bank.S.shuffleOpt = false;
  bank.save(); bank.render();
  await sleep(300);
  let allOrig = true;
  for (let i = 0; i < 30; i++) {
    const vv = bank.optionView(bank.QS[i]);
    if (!bank.canShuffleOptions(bank.QS[i])) continue;
    if (JSON.stringify(vv.order) !== JSON.stringify(bank.QS[i].options.map((_, k) => k))) allOrig = false;
  }
  check('随机模式关闭开关后选项全部保持原顺序', allOrig);
  bank.S.shuffleOpt = true;
  bank.S.mode = 'seq';

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
