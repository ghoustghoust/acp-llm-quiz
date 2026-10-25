/**
 * probe_scroll_layout.js — 标签栏 / 吸顶区 的滚动行为（真实浏览器）
 *
 * 【为什么重写】上一版叫 probe_scroll_fix.js，判断写成：
 *     barScrolledAway = bar.bottom < header.bottom
 *   但题目页只有一道题，可滚距离常常只有 80–130px，而标签栏高 113–133px，
 *   页面根本滚不到「标签栏完全离开吸顶区」那个位置。
 *   于是它永远报 ❌，看起来像 bug，其实只是没滚到那儿 —— 典型的假阴性。
 *
 * 现在的判断分三种情况：
 *   ✅ 完全滚出去了
 *   ➖ 可滚距离不足以滚完，且标签栏不是 sticky（会跟着内容走）→ 正常
 *   ❌ 标签栏是 sticky / 固定住的，永远赖在吸顶区下面 → 真的会挤压正文
 */
const path = require('path');
const { spawn, execSync } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9915;
const PROFILE = path.resolve(__dirname, 'scrollprof');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-breakpad', '--disable-crash-reporter', '--disable-extensions',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 100; i++) { await sleep(250); try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch (e) { } }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  await send('Runtime.enable', {}); await send('Page.enable', {});

  let bad = 0;
  for (const w of [320, 360, 390, 700, 768, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: w < 700 });
    await send('Page.navigate', { url: FILE });
    await sleep(1800);
    const m = await ev(`(async () => {
      const out = {};
      const hdr = () => document.querySelector('header').getBoundingClientRect();
      const bar = () => document.querySelector('.bar').getBoundingClientRect();
      const doc = document.documentElement;
      out.headerH = Math.round(hdr().height);
      out.barH = Math.round(bar().height);
      out.tabRows = new Set([...document.querySelectorAll('.tab')].map(t => Math.round(t.getBoundingClientRect().top))).size;
      out.barPosition = getComputedStyle(document.querySelector('.bar')).position;
      out.headerPosition = getComputedStyle(document.querySelector('header')).position;
      out.maxScroll = doc.scrollHeight - window.innerHeight;
      window.scrollTo(0, out.maxScroll);
      await new Promise(r => setTimeout(r, 350));
      const b2 = bar(), h2 = hdr();
      out.scrolledTo = Math.round(window.scrollY);
      out.barTopAtMax = Math.round(b2.top);
      out.barBottomAtMax = Math.round(b2.bottom);
      out.headerBottomAtMax = Math.round(h2.bottom);
      out.fullyScrolledAway = b2.bottom <= h2.bottom;
      out.headerSticky = getComputedStyle(document.querySelector('header')).position === 'sticky';
      out.headerAtTop = Math.round(h2.top) === 0;
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 250));
      out.scrollWidth = doc.scrollWidth;
      out.clientWidth = doc.clientWidth;
      out.hOverflow = doc.scrollWidth > doc.clientWidth;
      out.tabs = document.querySelectorAll('.tab').length;
      out.tabsClipped = [...document.querySelectorAll('.tab')].filter(t => {
        const r = t.getBoundingClientRect(); return r.width === 0 || r.height === 0;
      }).length;
      return out;
    })()`);

    const barNotSticky = m.barPosition !== 'sticky' && m.barPosition !== 'fixed';
    let scrollVerdict;
    if (m.fullyScrolledAway) scrollVerdict = '✅ 已完全滚出吸顶区';
    else if (m.maxScroll < m.barH && barNotSticky) scrollVerdict = '➖ 页面可滚距离 ' + m.maxScroll + 'px < 标签栏 ' + m.barH + 'px，滚不满属正常';
    else if (!barNotSticky) scrollVerdict = '❌ 标签栏是 ' + m.barPosition + '，会一直赖在吸顶区下面';
    else scrollVerdict = '❌ 还有 ' + Math.max(0, m.barBottomAtMax - m.headerBottomAtMax) + 'px 压在 header 下面';

    const ok = !/^❌/.test(scrollVerdict) &&
               m.headerSticky && m.headerAtTop && barNotSticky &&
               !m.hOverflow && m.tabsClipped === 0;
    if (!ok) bad++;

    console.log(`\n【${w}px】${ok ? '✅' : '❌'} header ${m.headerH}px(sticky=${m.headerSticky}) · 标签栏 ${m.barH}px / ${m.tabRows} 行(position=${m.barPosition})`);
    console.log(`  可滚 ${m.maxScroll}px，滚到底(${m.scrolledTo}px)时：标签栏 ${m.barTopAtMax}..${m.barBottomAtMax}，header 底 ${m.headerBottomAtMax}`);
    console.log(`  滚动行为: ${scrollVerdict}`);
    console.log(`  header 吸顶: ${m.headerSticky && m.headerAtTop ? '✅' : '❌'} · 横向溢出: ${m.hOverflow ? '❌' : '✅ 无'} · 12 标签被裁: ${m.tabsClipped}`);
  }

  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { }
  console.log('\n' + (bad ? '❌ ' + bad + ' 个尺寸有问题' : '✅ 全部尺寸通过'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (x) { } process.exit(2); });
