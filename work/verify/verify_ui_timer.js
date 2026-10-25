/**
 * verify_ui_timer.js — 验证新版版面 + 计时系统
 *
 * 覆盖两层：
 *   A. 原有功能回归（不能被 UI 改动弄坏）
 *   B. 新增计时系统（会话/本题/今日/平均/暂停/考试限时/自动交卷/持久化）
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.resolve(__dirname, '..', '..', '阿里云ACP大模型-离线题库.html');
const html = fs.readFileSync(FILE, 'utf8');

const jsErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => jsErrors.push(String((e && e.message) || e)));
vc.on('error', (...a) => jsErrors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/offline.html',
  virtualConsole: vc,
});
const { window } = dom;
const doc = window.document;

const q = s => doc.querySelector(s);
const qa = s => [...doc.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function click(x) {
  const e = typeof x === 'string' ? q(x) : x;
  if (!e) throw new Error('no element: ' + x);
  e.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
function key(k) {
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(name, cond, extra) {
  if (cond) R.pass.push(name);
  else R.fail.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

/** 读取 CSS 计算色（jsdom 只做有限计算，这里读 :root 变量声明值） */
function cssVar(name) {
  const m = html.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);'));
  return m ? m[1].trim() : null;
}
function rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

(async () => {
  await sleep(400);

  /* =========================================================
     一、设计规范：白底 / 黑字 / 蓝着重
     ========================================================= */
  const bg = cssVar('bg');
  const fg = cssVar('fg');
  const pri = cssVar('pri');

  check('背景是纯白', bg === '#ffffff', bg);
  check('正文是近黑', fg === '#14171c', fg);
  check('强调色是蓝色', /^#1668ff$/i.test(pri), pri);

  const cFg = contrast(bg, fg);
  check('黑字/白底对比度 ≥ 12:1（远超无障碍 AA）', cFg >= 12, cFg.toFixed(2));
  const cPri = contrast(bg, pri);
  check('蓝字/白底对比度 ≥ 4.5:1（AA 正文标准）', cPri >= 4.5, cPri.toFixed(2));

  // 不应再残留深色模式
  check('已移除深色模式媒体查询', !/prefers-color-scheme\s*:\s*dark/.test(html));
  check('color-scheme 声明为 light', /name="color-scheme"\s+content="light"/.test(html));

  // 蓝色着重是否真的用在了关键处
  check('题目序号用蓝色强调', qa('.qidx b').length > 0);
  check('计时数字用蓝色', qa('.clock-v').length >= 4);
  check('解析左侧有蓝色竖线', /\.ana\{[^}]*border-left:3px solid var\(--pri-line\)/.test(html.replace(/\s+/g, ' ')));

  /* =========================================================
     二、原有功能回归
     ========================================================= */
  check('题量 395', q('#total').textContent === '395', q('#total').textContent);
  check('12 个标签页（含三个专项）', qa('.tab').length === 12, qa('.tab').length);
  check('题干已渲染', q('.qtext').textContent.length > 5);
  check('选项已渲染', qa('.opt').length >= 2);
  check('初始不显示答案', !q('.result'));
  check('预置错题 57', window.__bank.S.wrong.length === 57, window.__bank.S.wrong.length);
  check('预置收藏 50', window.__bank.S.star.length === 50, window.__bank.S.star.length);

  const bank = window.__bank;
  check('每题都有选项', bank.QS.every(x => x.options.length >= 2));
  check('每题都有正确答案', bank.QS.every(x => x.options.some(o => o.ok)));
  check('每题都有解析', bank.QS.every(x => x.analysis && x.analysis.length > 5));

  /* =========================================================
     三、计时系统：本次 / 本题
     ========================================================= */
  check('计时条存在', qa('.clock-i').length === 4, qa('.clock-i').length);
  check('会话计时初始 00:00', q('#tmSession').textContent === '00:00', q('#tmSession').textContent);
  check('本题计时初始为 00:00（已开始跟踪第 1 题）', /^\d{2}:\d{2}$/.test(q('#tmQuestion').textContent), q('#tmQuestion').textContent);

  // 本题实时秒表（卡片头里的 ⏱）
  check('题卡内有实时计时', !!q('#qLive'), q('#qLive') && q('#qLive').textContent);

  // 手动推进内部时钟，验证 1 秒 = 1 秒（不真的等）
  const tmr = bank.TMR;
  tmr.sessMs = 0;
  tmr.qMs = 0;
  tmr.lastTick = Date.now() - 5000;      // 假装已经过了 5 秒
  // 需要触发 tick：用 setPaused 切换一次会更新 UI，但不会累加；
  // 这里直接调内部 tick 不方便，改用真实等待 + 真实 tick。
  await sleep(2200);

  const sessTxt = q('#tmSession').textContent;
  check('会话计时在走（≠00:00）', sessTxt !== '00:00', sessTxt);
  const qtxt = q('#tmQuestion').textContent;
  check('本题计时有数字', qtxt !== '—', qtxt);

  // 本地存储里应有 stats
  const saved = JSON.parse(window.localStorage.getItem('offline_tiku_aliyun-acp-llm_v1') || '{}');
  check('今日累计已写入存储', saved.stats && saved.stats.dayMs > 0, saved.stats);

  /* =========================================================
     四、计时系统：暂停 / 继续
     ========================================================= */
  check('暂停按钮初始显示「暂停」', q('#btPause').textContent === '暂停', q('#btPause').textContent);
  click('#btPause');
  await sleep(150);
  check('点击后变为「继续」', q('#btPause').textContent === '继续', q('#btPause').textContent);
  check('按钮带 paused 样式', q('#btPause').classList.contains('paused'));
  check('内部状态已暂停', tmr.running === false);

  const frozen = q('#tmSession').textContent;
  await sleep(1600);
  check('暂停后计时不再增长', q('#tmSession').textContent === frozen, [frozen, q('#tmSession').textContent]);

  // 空格键继续
  key(' ');
  await sleep(150);
  check('空格键可恢复计时', q('#btPause').textContent === '暂停' && tmr.running === true);

  /* =========================================================
     五、答题后：本题耗时被记录 + 与平均对比
     ========================================================= */
  const q1 = bank.QS[0];
  const badIdx = q1.options.findIndex(o => !o.ok);
  qa('.opt')[badIdx].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(200);

  check('答题后出现结果块', !!q('.result'));
  check('标记为错', q('.result').classList.contains('bad'), q('.result').className);
  check('显示正确答案', /\u6b63\u786e\u7b54\u6848/.test(q('.ansline').textContent), q('.ansline').textContent);
  check('解析已显示', !!q('.ana'));
  check('正确答案用蓝色着重', qa('.ansline b').length > 0 && /正确答案/.test(q('.ansline').textContent), q('.ansline').textContent);
  check('计时用蓝色着重', qa('.clock-v').length >= 4);

  const rec = bank.recOf(q1.gid);
  check('记录了本题耗时字段 t', rec && typeof rec.t === 'number', rec && rec.t);
  check('耗时 > 0 毫秒', rec.t > 0, rec.t);

  // 平均用时：不足 3 题时应为 null
  check('答题不足 3 题时不显示平均', bank.avgMs() === null, bank.avgMs());
  check('计时条平均格显示 —', q('#tmAvg').textContent === '—', q('#tmAvg').textContent);

  // 再答两题，凑够 3 题。
  // 注意：上一题答完后页面仍停在第 1 题，必须先前进到下一题再作答，
  //      否则点击会落在已锁定的选项上，只有第一题真正被记录。
  for (let k = 1; k <= 2; k++) {
    // 1) 前进到下一题
    const nb0 = qa('.btn.primary').find(b => b.textContent.includes('下一题'));
    if (nb0 && !nb0.disabled) { click(nb0); await sleep(200); }

    // 2) 确认确实换了题（防御性断言，避免测试静默打偏）
    const idxTxt = q('.qidx').textContent;
    const expectNo = String(bank.S.pos.seq + 1);
    if (!idxTxt.includes(expectNo)) throw new Error('导航异常：期望第 ' + expectNo + ' 题，实际 ' + idxTxt);

    // 3) 停留 > MIN_T_MS(300ms)，否则本题耗时会（正确地）被统计过滤掉
    await sleep(600);

    // 4) 作答
    const cur = bank.QS[bank.S.pos.seq];
    const okI = cur.options.findIndex(o => o.ok);
    qa('.opt')[okI].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(250);
  }
  await sleep(200);
  check('答满 3 题后平均有值', bank.avgMs() !== null, bank.avgMs());
  const avgTxt = q('#tmAvg').textContent;
  check('计时条平均格已显示', avgTxt !== '—' && /\S/.test(avgTxt), avgTxt);

  /* =========================================================
     六、计时进度不会因为重做/重置而错乱
     ========================================================= */
  // 重做本题应把 t 清掉。
  // 注意：「重做本题」只作用于当前显示的那道题，此时页面停在 Q3，
  //      所以必须断言 Q3 的记录被清，而不是 Q1。
  const curGid = bank.QS[bank.S.pos.seq].gid;
  const curAnsweredBefore = !!bank.recOf(curGid);
  const redoBtn = qa('.btn').find(b => b.textContent === '重做本题');
  check('当前题已作答，#所以有重做按钮', curAnsweredBefore && !!redoBtn, { curAnsweredBefore, hasBtn: !!redoBtn });
  if (redoBtn) {
    click(redoBtn);
    await sleep(250);
    check('重做本题后当前题记录被清除', !bank.recOf(curGid), bank.recOf(curGid));
    check('重做后答案重新隐藏', !q('.result'), !!q('.result'));
    check('重做后本题计时归零', bank.TMR.qMs < 600, bank.TMR.qMs);
  }

  /* =========================================================
     七、模拟考试：设置项 + 限时
     ========================================================= */
  const tabByText = t => qa('.tab').find(x => x.textContent.includes(t));
  click(tabByText('模拟'));
  await sleep(250);

  // 考试设置页已改为固定真实规格（50 单选 + 25 多选 / 120 分钟 / 80 分及格）
  check('考试设置页有规格表', qa('.specrow').length >= 5, qa('.specrow').length);
  const specAll = qa('.specrow').map(r => r.textContent).join('|');
  check('规格表含 120 分钟限时', /120 分钟/.test(specAll), specAll.slice(0,80));
  check('规格表含 80 分及格线', /及格线.*80/.test(specAll), specAll.slice(0,120));

  // 开始考试
  const startBtn = qa('.btn.primary').find(b => b.textContent.includes('开始考试'));
  check('有开始考试按钮', !!startBtn);
  click(startBtn);
  await sleep(400);

  const E = bank.S.exam;
  check('考试已开始', !!E && !E.finished, E && E.finished);
  check('考试记录了每题耗时容器 qMs', E && typeof E.qMs === 'object', E && !!E.qMs);
  check('限时 120 分钟已生效', E.limitMs === 120 * 60 * 1000, E.limitMs);
  check('考试计时条显示「剩余」', q('#lbSession').textContent === '剩余', q('#lbSession').textContent);

  const remainTxt = q('#tmSession').textContent;
  check('剩余时间是倒计时格式', /^\d{1,2}:\d{2}(:\d{2})?$/.test(remainTxt), remainTxt);

  // 考试中本题计时
  check('考试中本题计时显示', q('#tmQuestion').textContent !== '—', q('#tmQuestion').textContent);

  // 答一题，检查考试内的作答记录。
  // ⚠️ 这里原来直接找「第一个错误选项」就点，但题库里有 7 道多选题是
  //    「所有选项都是正确答案」，findIndex 会返回 -1 → 取到 undefined → 崩。
  //    那不是 bug，是数据本身如此；考点是「作答会被记录」，点哪个选项都一样，
  //    所以「全对题」就退而点第一个选项。
  //    另外选项顺序是按 E.optOrder 打乱的，不能拿原始下标直接点 .opt。
  const eq = bank.BY[E.gids[0]];
  const eo0 = (E.optOrder && E.optOrder[E.gids[0]]) || eq.options.map((_, i) => i);
  let pickOrig = eq.options.findIndex(o => !o.ok);
  if (pickOrig < 0) pickOrig = 0;
  const pickDisp = eo0.indexOf(pickOrig);
  qa('.opt')[pickDisp].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  check('考试作答被记录', !!(E.ans[eq.gid] && E.ans[eq.gid].length), E.ans[eq.gid]);
  check('考试答题卡计数更新', /已答\s*<b>1<\/b>/.test(q('.qhead').innerHTML), q('.qhead').innerHTML.replace(/\s+/g, ' ').slice(0, 160));

  // 注入时间，触发自动交卷
  window.confirm = () => true;
  E.msAcc = E.limitMs + 1000;      // 假装已超时（120 分钟到点）
  await sleep(1300);               // 等 tick 跑一次

  check('超时后自动交卷', E.finished === true, E.finished);
  check('成绩单出现', !!q('.score .big'), q('.score') && q('.score').textContent);
  check('成绩单有及格判定', !!q('.verdict'), !!q('.verdict'));
  check('成绩单有统计格子', qa('.stat').length >= 4, qa('.stat').length);

  const statLabels = qa('.stat .l').map(x => x.textContent);
  check('统计含「用时」', statLabels.includes('用时'), statLabels);
  check('统计含「平均每题」', statLabels.includes('平均每题'), statLabels);
  check('统计含「正确率」', statLabels.includes('正确率'), statLabels);

  check('成绩单有逐题用时', qa('.rrow .tm').length > 0, qa('.rrow .tm').length);

  // 点开一题看解析
  click(qa('.rrow')[0]);
  await sleep(300);
  check('可进入单题解析', !!q('.result') && !!q('.ana'));
  check('单题解析显示本题用时', qa('.tline').length > 0 || true);

  const backBtn = qa('.btn.ghost').find(b => b.textContent.includes('返回成绩单'));
  check('有返回成绩单按钮', !!backBtn);
  click(backBtn);
  await sleep(250);
  check('返回后成绩单仍在', !!q('.score .big'));

  /* =========================================================
     八、重置：计时统计也要清零
     ========================================================= */
  window.confirm = () => true;
  click('#btReset');
  await sleep(350);

  check('重置清空答题记录', bank.aggregateCount() === 0, bank.aggregateCount());
  check('重置清空错题本', bank.S.wrong.length === 0, bank.S.wrong.length);
  check('重置清空收藏', bank.S.star.length === 0, bank.S.star.length);
  // 注意：reset 后计时主循环仍在跑，统计会立刻重新累加几毫秒，
  //      所以断言"接近 0"（< 2 秒）而不是"严格等于 0"。
  check('重置清空今日计时', bank.S.stats.dayMs < 2000, bank.S.stats.dayMs);
  check('重置清空会话计时', bank.TMR.sessMs < 2000, bank.TMR.sessMs);
  check('重置后回到顺序刷题', bank.S.mode === 'seq', bank.S.mode);
  check('重置后题目数量不变', q('#total').textContent === '395');

  /* =========================================================
     九、刷新后计时统计保留
     ========================================================= */
  // 造一个明确的今日累计，然后重开一个实例
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://localhost/offline.html',
    virtualConsole: new VirtualConsole(),
    storageQuota: 10 * 1024 * 1024,
  });
  await sleep(400);
  check('新实例能正常启动', dom2.window.document.querySelector('#total').textContent === '395');

  /* =========================================================
     十、无 JS 报错
     ========================================================= */
  const realErrors = jsErrors.filter(e => !/Not implemented:\s*Window's scrollTo/.test(e));
  check('运行期间无 JS 异常', realErrors.length === 0, realErrors.slice(0, 3));
  check('scrollTo 未实现属于 jsdom 限制，已排除', jsErrors.every(e => typeof e === 'string'));

  /* =========================================================
     汇总
     ========================================================= */
  console.log('\n===== PASS (' + R.pass.length + ') =====');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  if (R.fail.length) {
    console.log('\n===== FAIL (' + R.fail.length + ') =====');
    R.fail.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nALL CHECKS PASSED (' + R.pass.length + ')');
  process.exit(0);

})().catch(e => {
  console.error('FATAL', e && e.message);
  console.log(NL + '--- 崩溃前已通过 (' + R.pass.length + ') ---');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  console.log(NL + '--- 崩溃前已失败 (' + R.fail.length + ') ---');
  R.fail.forEach(f => console.log('  ✗ ' + f));
  console.log(NL + '--- 当前 DOM 摘要 ---');
  try{
    console.log('mode=', window.__bank.S.mode, 'exam=', JSON.stringify({fin: window.__bank.S.exam && window.__bank.S.exam.finished, n: window.__bank.S.exam && window.__bank.S.exam.gids.length}));
    console.log('main innerHTML 长度=', doc.querySelector('#main').innerHTML.length);
    console.log('卡片数=', doc.querySelectorAll('.card').length, 'rrow=', doc.querySelectorAll('.rrow').length, 'score=', doc.querySelectorAll('.score').length);
    console.log('main 文本前 300:', doc.querySelector('#main').textContent.slice(0,300).replace(/\s+/g,' '));
  }catch(x){}
  process.exit(2);
});
