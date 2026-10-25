/**
 * verify_drill_edges.js — 三个专项练习的边界情况
 *
 * 与 verify_drill.js 的区别：那套查「功能对不对」，这套查「会不会崩 / 会不会卡死」。
 *   1. 攻坚池边练边缩小，pos 越界时会被夹回范围内（不会空白页）
 *   2. 全部掌握的池子清空后，显示空态而不是报错
 *   3. 跳转输入框的越界值（0 / 超大值）被拒绝，进度不动
 *   4. 多选题漏选判为错
 *   5. 攻坚页「做对」的计数语义：重做答对但未满 3 次时才会涨
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.resolve(__dirname, '..', '..', '阿里云ACP大模型-离线题库.html');
const html = fs.readFileSync(FILE, 'utf8');

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = String((e && e.message) || e);
  if (!/Not implemented:\s*Window's (scrollTo|createObjectURL)/.test(m)) errs.push(m);
});
vc.on('error', (...a) => errs.push('console.error ' + a.join(' ')));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://localhost/offline.html', virtualConsole: vc,
});
const w = dom.window, d = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const click = x => (typeof x === 'string' ? d.querySelector(x) : x)
  .dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));

const R = { pass: [], fail: [] };
const ck = (n, c, x) => (c ? R.pass : R.fail).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));

(async () => {
  await sleep(400);
  const b = w.__bank;
  w.confirm = () => true;
  const singles = b.QS.filter(q => q.type === '单选题');
  const reset = () => { b.BOARD_KEYS.forEach(k => { b.S.ansAll[k] = {}; }); b.S.wrong = []; b.S.wcnt = {}; b.S.streak = {}; };

  /* ---------- 1. 攻坚池边练边缩小 ---------- */
  reset();
  const g = [];
  for (let i = 0; i < 5; i++) { g.push(singles[i].gid); b.noteWrong(singles[i].gid); }
  b.S.mode = 'hard'; b.save(); b.render(); await sleep(300);
  ck('攻坚池 5 题', b.drillPool('hard').length === 5, b.drillPool('hard').length);

  const st = b.S.drill.hard;
  st.pos = 4; b.save(); b.render(); await sleep(300);
  ck('pos 指向第 5 题', st.pos === 4, st.pos);

  for (let i = 0; i < 3; i++) b.noteRight(g[4]);   // 当前这题掌握 → 池子缩到 4
  b.render(); await sleep(300);
  ck('池子缩到 4', b.drillPool('hard').length === 4, b.drillPool('hard').length);
  ck('pos 被夹回范围内（不越界）', st.pos <= 3, st.pos);
  ck('页面没崩（题卡还在）', d.querySelectorAll('.opt').length >= 2, d.querySelectorAll('.opt').length);
  const idxTxt = [...d.querySelectorAll('.qidx')].map(x => x.textContent).join(' ');
  ck('题号显示为 第 4 / 4', /第\s*4\s*\/\s*4/.test(idxTxt), idxTxt);

  /* ---------- 2. 池子清空 → 空态 ---------- */
  reset();
  const q0 = singles[100].gid;
  b.noteWrong(q0); b.noteRight(q0);
  b.S.mode = 'hard'; b.save(); b.render(); await sleep(300);
  ck('攻坚池剩 1 题', b.drillPool('hard').length === 1, b.drillPool('hard').length);
  b.noteRight(q0); b.noteRight(q0);
  b.render(); await sleep(300);
  ck('全部掌握后池子为空', b.drillPool('hard').length === 0);
  ck('显示空态文案', /没有待攻克的题了/.test(d.body.textContent));
  ck('空态不渲染题卡', d.querySelectorAll('.opt').length === 0, d.querySelectorAll('.opt').length);

  /* ---------- 3. 跳转越界被拒绝 ---------- */
  b.S.mode = 'single'; b.S.drill.single.pos = 0; b.save(); b.render(); await sleep(300);
  const inp = d.querySelector('.drillctrl .jump input');
  const go = d.querySelector('.drillctrl .jump .btn');
  inp.value = '99999'; click(go); await sleep(250);
  ck('跳转超大值被拒绝', b.S.drill.single.pos === 0, b.S.drill.single.pos);
  inp.value = '0'; click(go); await sleep(250);
  ck('跳转 0 被拒绝', b.S.drill.single.pos === 0, b.S.drill.single.pos);

  /* ---------- 4. 多选题漏选判错 ---------- */
  reset();
  const multi = b.QS.filter(q => q.type === '多选题')[0];
  b.S.mode = 'multi'; b.save(); b.render(); await sleep(400);
  click([...d.querySelectorAll('.opt')][0]);
  await sleep(200);
  const submit = [...d.querySelectorAll('button')].find(x => /提交/.test(x.textContent));
  if (submit) { click(submit); await sleep(400); }
  const rec = b.recOf(multi.gid);
  ck('多选题产生作答记录', !!rec, rec && Object.keys(rec));
  ck('漏选判为错', rec && rec.ok === false, rec && rec.ok);

  /* ---------- 5. 攻坚页「做对」的计数语义 ---------- */
  reset();
  const q = singles[0];
  b.noteWrong(q.gid);
  const s1 = b.drillStats('hard');
  ck('只错过没重做时，已做/做对/做错都是 0（按作答记录算）',
     s1.done === 0 && s1.right === 0 && s1.wrong === 0, s1);
  b.setRec(q.gid, { sel: [0], ok: true, t: 3000 }, 'hard');   // 在攻坚页重做并答对
  const s2 = b.drillStats('hard');
  ck('重做答对后「做对」才变 1', s2.done === 1 && s2.right === 1, s2);
  ck('未满 3 次仍在池里', b.drillPool('hard').length === 1, b.drillPool('hard').length);
  ck('错后连续对数为 0', (b.S.streak[q.gid] || 0) === 0, b.S.streak[q.gid]);
  b.noteRight(q.gid);
  ck('对 1 次仍在池', b.drillPool('hard').length === 1, b.masteryOf(q.gid));
  b.noteRight(q.gid);
  ck('对 2 次仍在池', b.drillPool('hard').length === 1, b.masteryOf(q.gid));
  ck('对 2 次等级 = 巩固中', b.masteryOf(q.gid) === 'learning', b.masteryOf(q.gid));
  b.noteRight(q.gid);
  ck('连续 3 次后移出池', b.drillPool('hard').length === 0, b.masteryOf(q.gid));
  ck('移出后等级 = 已掌握', b.masteryOf(q.gid) === 'mastered', b.masteryOf(q.gid));

  /* ---------- 6. 无异常 ---------- */
  ck('全程无 JS 异常', errs.length === 0, errs.slice(0, 3));

  const NL = String.fromCharCode(10);
  console.log(NL + '===== PASS (' + R.pass.length + ') =====');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  if (R.fail.length) {
    console.log(NL + '===== FAIL (' + R.fail.length + ') =====');
    R.fail.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log(NL + 'ALL CHECKS PASSED (' + R.pass.length + ')');
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.message); process.exit(2); });
