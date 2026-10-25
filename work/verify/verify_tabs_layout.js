/**
 * verify_tabs_layout.js — 标签栏布局：12 个标签必须全都能点到
 *
 * 背景：原来是 overflow-x:auto + 隐藏滚动条的横向滚动。
 * 手机上能划动，但**电脑上鼠标滚轮不横向滚**，后面的标签直接被切掉点不到。
 * 现在改成 flex-wrap 换行。这套测试防止以后有人改回去。
 *
 * jsdom 不做真实布局（offsetWidth 都是 0），所以这里查的是「样式规则 +
 * DOM 结构 + 可点击性」，真实视觉效果靠 shots_tabs.js 截图。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.resolve(__dirname, '..', '..', '阿里云ACP大模型-离线题库.html');
const html = fs.readFileSync(FILE, 'utf8');

const jsErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = String((e && e.message) || e);
  if (!/Not implemented:\s*Window's (scrollTo|createObjectURL)/.test(m)) jsErrors.push(m);
});
vc.on('error', (...a) => jsErrors.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://localhost/offline.html', virtualConsole: vc,
});
const w = dom.window, d = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const qa = s => [...d.querySelectorAll(s)];

const R = { pass: [], fail: [] };
const ck = (n, c, x) => (c ? R.pass : R.fail).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));

/* 从 <style> 里抠出 .tabs 和 .tab 的规则体 */
function cssRules(selector) {
  const style = d.querySelector('style').textContent;
  const blocks = style.match(/[^{}]*\{[^{}]*\}/g) || [];
  const out = [];
  for (const b of blocks) {
    const i = b.indexOf('{');
    const sel = b.slice(0, i).trim();
    if (sel.split(',').map(x => x.trim()).includes(selector)) {
      out.push(b.slice(i + 1, b.lastIndexOf('}')));
    }
  }
  return out.join(';');
}

(async () => {
  await sleep(400);
  const bank = w.__bank;

  /* ---------- 1. 12 个标签都在，文本齐全 ---------- */
  const tabs = qa('.tab');
  ck('标签总数为 12', tabs.length === 12, tabs.length);
  const labels = tabs.map(t => t.textContent.replace(/\d+$/, '').trim());
  const EXPECT = ['顺序刷题','随机刷题','单选专项','多选专项','错题攻坚',
                  '错题本','收藏','模拟考试','统计','成绩走势','错题排行','搜索'];
  EXPECT.forEach(name => {
    ck('有「' + name + '」标签', tabs.some(t => t.textContent.includes(name)),
       tabs.map(t => t.textContent));
  });

  /* ---------- 2. 关键：不能再是「隐藏滚动条的横向滚动」 ---------- */
  // .tabs 在 media query 里还有一条覆盖规则，所以要合并全部同名规则再断言
  const tabsCssAll = cssRules('.tabs');
  ck('.tabs 使用 flex-wrap:wrap（换行，不裁切）',
     /\.tabs\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(d.querySelector('style').textContent),
     tabsCssAll);
  const tabsCss = tabsCssAll;
  ck('.tabs 不再用 overflow-x:auto', !/overflow-x\s*:\s*auto/.test(tabsCss), tabsCss);
  ck('.tabs 不再隐藏滚动条', !/scrollbar-width\s*:\s*none/.test(tabsCss), tabsCss);

  const tabCss = cssRules('.tab');
  ck('.tab 不允许被压缩变形（flex:none）', /flex\s*:\s*none/.test(tabCss), tabCss);
  ck('.tab 文字不换行（nowrap，保持胶囊形状）', /white-space\s*:\s*nowrap/.test(tabCss), tabCss);

  /* 全局不应再有「隐藏滚动条的横向滚动容器」 */
  const wholeCss = d.querySelector('style').textContent;
  ck('样式里不再有 scrollbar-width:none 的隐藏滚动条',
     !/scrollbar-width\s*:\s*none/.test(wholeCss), 'found');
  ck('计时条也改成换行（原 .clock 的横向滚动已移除）',
     /\.clock\{[^}]*flex-wrap\s*:\s*wrap/.test(wholeCss), cssRules('.clock'));

  /* ---------- 2b. 标签栏必须搬出吸顶 header ----------
     换行后 12 个标签要占 2–3 行。如果还放在 position:sticky 的 header 里，
     吸顶区会高达 230px（实测 390px 宽），往下翻时正文可看区域被吃掉近 1/3。
     所以 .bar（进度条 + 标签）必须是 header 的**兄弟节点**。 */
  const bar = d.querySelector('.bar');
  ck('.bar 存在', !!bar);
  ck('.bar 不在 <header> 里（否则吸顶区过高）',
     !!bar && bar.closest('header') === null,
     bar && bar.closest('header') ? 'inside header' : 'outside');
  ck('.bar 是 header 的紧邻兄弟节点',
     !!bar && bar.previousElementSibling && bar.previousElementSibling.tagName === 'HEADER',
     bar && bar.previousElementSibling && bar.previousElementSibling.tagName);
  ck('.bar 有自己的白底（搬出 header 后不能透出下层内容）',
     /\.bar\{[^}]*background\s*:\s*var\(--bg\)/.test(wholeCss), cssRules('.bar'));

  /* ---------- 2c. 宽屏用 6 列网格排成整齐 2 行 ---------- */
  ck('有 ≥700px 的媒体查询（宽屏网格）',
     /@media\s*\(min-width:\s*700px\)/.test(wholeCss));
  ck('宽屏用 6 列 grid（12 个标签正好 2 行且等宽）',
     /@media[^{]*\(min-width:\s*700px\)[\s\S]*?grid-template-columns\s*:\s*repeat\(6/.test(wholeCss),
     'grid rule');
  ck('网格列用 minmax(0,1fr)（默认 auto 会被内容撑破导致横向溢出）',
     /grid-template-columns\s*:\s*repeat\(6\s*,\s*minmax\(0\s*,\s*1fr\)\)/.test(wholeCss),
     'minmax');
  ck('宽屏 .tab 有 min-width:0（同上，防撑破）',
     /@media[^{]*\(min-width:\s*700px\)[\s\S]*?\.tab\{[^}]*min-width\s*:\s*0/.test(wholeCss),
     'tab min-width');

  /* ---------- 3. 每个标签都能点到（不是被裁掉的） ---------- */
  let clickable = 0;
  for (const t of tabs) {
    if (t.onclick !== null && typeof t.onclick === 'function') clickable++;
  }
  ck('12 个标签都绑定了点击事件', clickable === 12, clickable);

  /* 逐个点一遍，确认都能切换（验证没有被遮挡/裁切导致点不到） */
  const modes = [];
  for (const t of tabs) {
    t.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(60);
    modes.push(bank.S.mode);
  }
  const EXPECT_MODES = ['seq','random','single','multi','hard','wrong','star',
                        'exam','stats','trend','rank','search'];
  ck('12 个标签点过去，模式依次正确', JSON.stringify(modes) === JSON.stringify(EXPECT_MODES),
     { got: modes, want: EXPECT_MODES });

  /* ---------- 4. 手机端：也要换行，且缩小尺寸 ---------- */
  ck('有 ≤600px 的媒体查询', /@media\s*\(max-width:\s*600px\)/.test(wholeCss));
  ck('手机端标签内边距缩小（不占满屏）',
     /@media[^{]*\(max-width:\s*600px\)[\s\S]*?\.tab\{[^}]*padding\s*:\s*6px 11px/.test(wholeCss),
     'media block');
  ck('有 ≤380px 窄屏兜底（更小字号 + 隐藏数字徽标）',
     /@media\s*\(max-width:\s*380px\)/.test(wholeCss) &&
     /\.tab \.n\{display\s*:\s*none\}/.test(wholeCss), 'narrow block');

  /* ---------- 5. 还能正常渲染内容 ---------- */
  const t = tabs[0];
  t.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(300);
  ck('回到顺序刷题后能渲染出题卡', qa('.opt').length >= 2, qa('.opt').length);
  const wrapCss = cssRules('.wrap') + cssRules('body') + cssRules('html');
  ck('页面主体没有横向滚动容器',
     !/overflow-x\s*:\s*(auto|scroll)/.test(wrapCss), wrapCss);

  ck('全程无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3));

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
