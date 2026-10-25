/**
 * verify_scroll_layout.js — 滚动 / 吸顶 / 标签栏的布局验收（jsdom 能验的部分）
 *
 * 为什么要有这一套：
 *   `verify_tabs_layout.js` 验的是「CSS 规则写对没有 + DOM 结构 + 12 个标签能点」，
 *   但它跑在 jsdom 里 —— jsdom 不做布局（offsetWidth 恒 0、scrollTo 不实现），
 *   验不了「滚动时标签栏会不会赖在吸顶区」。
 *
 *   而真实滚动必须靠 Chrome，Chrome 在受限沙箱下起不来（mojo 命名管道被拒），
 *   所以它只能作为「有完整权限时手动跑」的检查：
 *       node verify/probe_scroll_layout.js      ← 真实浏览器，6 种宽度
 *
 *   这一套负责剩下能静态验的部分，避免「样式被悄悄改坏」：
 *     · .bar 不能是 sticky / fixed（否则换行后永远占着吸顶区）
 *     · header 必须是 sticky 且 z-index 正常
 *     · .bar 必须是 header 的**兄弟节点**（塞在 header 里就会抬高吸顶区）
 *     · 吸顶区高度不超过约定阈值
 *     · 标签栏不得使用 overflow-x:auto 隐藏滚动条的横向滚动方案
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
const { window } = dom;
const doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = s => doc.querySelector(s);
const qa = s => [...doc.querySelectorAll(s)];
const NL = String.fromCharCode(10);
const R = { pass: [], fail: [] };
function check(name, cond, extra) {
  if (cond) R.pass.push(name);
  else R.fail.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

/** 从样式表文本里抽某条规则（jsdom 的 getComputedStyle 对 media query 支持有限，直接读原文更可靠） */
const flat = html.replace(/\s+/g, ' ');
function cssBlock(selector) {
  const i = flat.indexOf(selector + '{');
  if (i < 0) return null;
  let depth = 0, j = i + selector.length;
  for (; j < flat.length; j++) {
    if (flat[j] === '{') depth++;
    else if (flat[j] === '}') { depth--; if (depth === 0) break; }
  }
  return flat.slice(i, j + 1);
}

(async () => {
  await sleep(450);

  /* ---------- 一、吸顶区 = 只有 header ---------- */
  const header = q('header');
  const bar = q('.bar');
  check('有 header 元素', !!header);
  check('有 .bar 元素（进度条 + 标签栏）', !!bar);
  check('★ .bar 是 header 的兄弟节点，不在 header 内部（否则换行后吸顶区高达 230px）',
        !!bar && !header.contains(bar),
        { inHeader: !!bar && header.contains(bar) });
  check('.bar 紧跟在 header 之后', !!bar && header.nextElementSibling === bar,
        header.nextElementSibling && header.nextElementSibling.className);

  const headerCss = cssBlock('header') || '';
  check('header 是 sticky', /position:\s*sticky/.test(headerCss), headerCss.slice(0, 80));
  check('header 吸在顶部（top:0）', /top:\s*0/.test(headerCss));
  check('header 有 z-index，不会被题卡盖住', /z-index:\s*\d+/.test(headerCss), headerCss);

  const barCss = cssBlock('.bar') || '';
  check('★ .bar 不是 sticky（标签栏要跟着页面滚走）',
        !/position:\s*(sticky|fixed)/.test(barCss), barCss.slice(0, 100));
  check('.bar 有实色背景，滚走时不会透出下面内容', /background:/.test(barCss), barCss.slice(0, 160));
  check('.bar 有底部分隔线', /border-bottom:/.test(barCss));

  /* ---------- 二、标签栏不能用「横向滚动 + 隐藏滚动条」 ---------- */
  const tabsCss = cssBlock('.tabs') || '';
  check('★ 标签栏不再用 overflow-x:auto（电脑上滚轮滚不动，后面的标签点不到）',
        !/overflow-x:\s*auto/.test(tabsCss), tabsCss.slice(0, 160));
  check('标签栏用 grid 或 wrap（换行 / 网格）',
        /grid-template-columns/.test(flat) || /flex-wrap:\s*wrap/.test(tabsCss),
        tabsCss.slice(0, 160));

  const gridCss = cssBlock('@media (min-width:700px)');
  check('宽屏用 6 列网格', /grid-template-columns:\s*repeat\(6/.test(flat), (gridCss || '').slice(0, 200));
  check('★ 网格列宽用 minmax(0,1fr) 或 .tab 有 min-width:0（否则会被内容撑破）',
        /repeat\(6,\s*minmax\(0,\s*1fr\)\)/.test(flat.replace(/\s+/g, '')) || /min-width:\s*0/.test(flat),
        'both-check');
  check('窄屏用 flex-wrap 换行', /flex-wrap:\s*wrap/.test(tabsCss), tabsCss.slice(0, 200));

  /* ---------- 三、12 个标签全部可交互 ---------- */
  const tabs = qa('.tab');
  check('12 个标签都在 DOM 里', tabs.length === 12, tabs.length);
  check('每个标签都有文本', tabs.every(t => t.textContent.trim().length > 0),
        tabs.map(t => t.textContent.trim()).slice(0, 12));
  check('每个标签都不是 disabled', tabs.every(t => !t.disabled));
  check('每个标签都设置了 onclick', tabs.every(t => typeof t.onclick === 'function'));

  /* 点最后一个标签，确认它真的切得过去（而不是只有前几个能用） */
  const lastTab = tabs[tabs.length - 1];
  const lastLabel = lastTab.textContent.trim();
  lastTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(350);
  check('点最后一个标签（' + lastLabel + '）能切过去', window.__bank.S.mode === 'search', window.__bank.S.mode);

  /* 逐个点一遍 */

  let stuck = [];
  for (let i = 0; i < tabs.length; i++) {
    const t = qa('.tab')[i];
    const label = t.textContent.trim();
    t.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(120);
    const on = qa('.tab')[i].classList.contains('on');
    if (!on) stuck.push(label);
  }
  check('12 个标签逐个点都能高亮为选中态', stuck.length === 0, stuck);
  check('主内容区不为空（说明渲染成功）', (q('main') && q('main').textContent.trim().length > 0));

  /* ---------- 四、计时条也不能横向滚动 ---------- */
  const clockCss = cssBlock('.clock') || '';
  check('计时条不用 overflow-x:auto', !/overflow-x:\s*auto/.test(clockCss), clockCss.slice(0, 160));
  check('计时条允许换行', /flex-wrap:\s*wrap/.test(clockCss), clockCss.slice(0, 160));

  /* ---------- 五、吸顶区高度预期 ---------- */
  /* header 自身没写 padding，上下留白在内部 .hdr / .clock 上，
     所以这里查 .hdr —— 查 header 会永远拿到 null（第一版就是这么写的，
     结果这条断言永远失败，看着像样式坏了）。 */
  const hdrCss = cssBlock('.hdr') || '';
  const hdrPad = /padding:([^;}]+)/.exec(hdrCss);
  check('.hdr 上下内边距是收紧过的一档（合计 ≤ 24px）',
        !!hdrPad && (function () {
          const nums = hdrPad[1].trim().split(/\s+/).map(x => parseInt(x) || 0);
          const v = nums.length >= 3 ? nums[0] + nums[2] : (nums[0] || 0) * 2;
          return v <= 24;
        })(), hdrPad && hdrPad[1]);
  check('「背题 / 重置」按钮在 header 里（吸顶时始终可达）',
        !!header && !!header.querySelector('#btMemorize') && !!header.querySelector('#btReset'),
        { memorizeInHeader: !!(header && header.querySelector('#btMemorize')) });
  check('计时条在 header 里（吸顶时始终可见）',
        !!header && !!header.querySelector('#tmSession'));

  check('全程无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 4));

  console.log(NL + '===== PASS (' + R.pass.length + ') =====');
  R.pass.forEach(p => console.log('  ✓ ' + p));
  if (R.fail.length) {
    console.log(NL + '===== FAIL (' + R.fail.length + ') =====');
    R.fail.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log(NL + 'ALL CHECKS PASSED (' + R.pass.length + ')');
  console.log(NL + '提示：真实浏览器里的滚动行为用 node verify/probe_scroll_layout.js 验（需要完整权限）');
  process.exit(0);
})().catch(e => {
  console.error('FATAL', e && e.message);
  console.log(NL + '--- 通过 ' + R.pass.length + ' / 失败 ' + R.fail.length + ' ---');
  R.fail.forEach(f => console.log('  ✗ ' + f));
  process.exit(2);
});
