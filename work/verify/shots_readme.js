/**
 * shots_readme.js — 为 GitHub README 生成页面截图
 *
 * 原则：
 *   1. 每张图都要有**真实感的数据**（有对有错、有错题、有成绩走势），
 *      否则截出来全是「已练 0 · 正确率 —」，看起来像空壳项目
 *   2. 统一 1280 宽、deviceScaleFactor=2（Retina 清晰度），再压成合理体积
 *   3. 一个页面一张图，命名与 README 章节一一对应
 *
 * 输出：docs/screenshots/*.png（相对仓库根）
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9960;
const OUT = path.resolve(__dirname, '..', '..', 'docs', 'screenshots');
const PROFILE = path.resolve(__dirname, 'readmeprof');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-breakpad', '--disable-crash-reporter', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 100; i++) { await sleep(250); try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch (e) { } }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails).slice(0, 160));
  };
  const send = (m, p) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 240) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (name, fullPage) => {
    const p = { format: 'png' };
    if (fullPage) p.captureBeyondViewport = true;
    const r = await send('Page.captureScreenshot', p);
    const buf = Buffer.from(r.result.data, 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log(`   → ${name}  (${Math.round(buf.length / 1024)} KB)`);
  };

  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2600);
  await ev(`(()=>{ window.confirm=()=>true; return 1; })()`);

  /* =========================================================
     造一套「用了两周」的真实数据
     ========================================================= */
  const seeded = await ev(`(() => {
    const b = window.__bank;
    b.BOARD_KEYS.forEach(k => { b.S.ansAll[k] = {}; });
    b.S.wrong = []; b.S.star = []; b.S.wcnt = {}; b.S.wlast = {}; b.S.streak = {};
    b.S.reveal = {}; b.S.memorizing = false;
    b.S.daily = {}; b.S.examHistory = [];

    const singles = b.QS.filter(x => x.type === '单选题');
    const multis  = b.QS.filter(x => x.type === '多选题');
    const okSel = q => q.options.map((o, k) => o.ok ? k : -1).filter(k => k >= 0);
    const badSel = q => [q.options.findIndex(o => !o.ok)];
    const now = Date.now();

    /* ---- 顺序刷题：做 86 题，对 71 错 15 ---- */
    singles.slice(0, 86).forEach((q, i) => {
      const ok = i % 6 !== 0;                        // 每 6 题错 1 道 ≈ 83%
      b.S.ansAll.seq[q.gid] = {
        sel: ok ? okSel(q) : badSel(q), ok,
        t: 6500 + (i * 791) % 9000,
        at: now - (86 - i) * 3600e3,
      };
      if (!ok) { b.S.wrong.unshift(q.gid); b.S.wcnt[q.gid] = 1; b.S.wlast[q.gid] = now - i * 3600e3; b.S.streak[q.gid] = 0; }
      else { b.S.streak[q.gid] = 1 + (i % 3); }
    });

    /* ---- 随机刷题：做 34 题 ---- */
    multis.slice(0, 20).forEach((q, i) => {
      const ok = i % 3 !== 0;
      b.S.ansAll.random[q.gid] = { sel: ok ? okSel(q) : badSel(q), ok, t: 9000, at: now - i * 1800e3 };
    });
    singles.slice(120, 134).forEach((q, i) => {
      const ok = i % 4 !== 0;
      b.S.ansAll.random[q.gid] = { sel: ok ? okSel(q) : badSel(q), ok, t: 7000, at: now - i * 1500e3 };
    });

    /* ---- 单选专项：48 题 ---- */
    singles.slice(100, 148).forEach((q, i) => {
      const ok = i % 5 !== 0;
      b.S.ansAll.single[q.gid] = { sel: ok ? okSel(q) : badSel(q), ok, t: 5000, at: now - i * 900e3 };
    });

    /* ---- 多选专项：26 题 ---- */
    multis.slice(24, 50).forEach((q, i) => {
      const ok = i % 3 !== 0;
      b.S.ansAll.multi[q.gid] = { sel: ok ? okSel(q) : badSel(q), ok, t: 12000, at: now - i * 900e3 };
    });

    /* ---- 错题攻坚：给池里前 18 道补上「在攻坚页做过」的记录 ----
       否则攻坚页概览卡「已做/做对/做错」全是 0，看着像坏了。
       真实用法里进过攻坚页就会留下记录。 */
    ;
    /* ---- 错题本：再补几道有错次的题，让排行有层次 ---- */
    const extraWrong = singles.slice(200, 212);
    extraWrong.forEach((q, i) => {
      const wi = b.S.wrong.indexOf(q.gid);
      if (wi < 0) b.S.wrong.unshift(q.gid);
      b.S.wcnt[q.gid] = 2 + (i % 4);                  // 2~5 次，形成排行梯度
      b.S.wlast[q.gid] = now - i * 7200e3;
      b.S.streak[q.gid] = 0;
    });
    b.S.wrong = b.S.wrong.slice(0, 34);

    /* 攻坚页记录：前 18 道里 6 道已在攻坚页重做对（连续 1~2 次），其余仍错 */
    b.S.wrong.slice(0, 18).forEach((g, i) => {
      const q = b.BY[g];
      if (!q) return;
      const ok = i < 6;
      b.S.ansAll.hard[g] = {
        sel: ok ? q.options.map((o,k)=>o.ok?k:-1).filter(k=>k>=0) : badSel(q),
        ok, t: 8000, at: now - i * 600e3,
      };
      if (ok) b.S.streak[g] = 1 + (i % 2);       // 1~2 次，还没到 3 次掌握
      else b.S.streak[g] = 0;
    });

    /* ---- 收藏 12 道 ----
       注意 singles 只有 273 道，原来写 slice(300,310) 取到空数组，
       截出来「收藏」只有 2 道（那 2 道来自 multis），看起来像功能坏了。 */
    b.S.star = singles.slice(250, 260).map(x => x.gid)
      .concat(multis.slice(60, 62).map(x => x.gid));

    /* ---- 成绩走势：最近 7 天 + 4 次考试 ---- */
    const day = off => {
      const d = new Date(now - off * 86400e3);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    };
    b.S.daily = {};
    const plan = [
      { off: 6, ans: 18, right: 12, examN: 0 },
      { off: 5, ans: 24, right: 17, examN: 0 },
      { off: 4, ans: 30, right: 23, examN: 1 },
      { off: 3, ans: 12, right: 9,  examN: 0 },
      { off: 2, ans: 36, right: 30, examN: 0 },
      { off: 1, ans: 28, right: 24, examN: 0 },
      { off: 0, ans: 22, right: 19, examN: 0 },
    ];
    plan.forEach(p => {
      b.S.daily[day(p.off)] = { ans: p.ans, right: p.right, ms: p.ans * 7200, examN: p.examN };
    });

    const scores = [ { off: 9, s: 68 }, { off: 6, s: 74 }, { off: 3, s: 81 }, { off: 1, s: 86 } ];
    b.S.examHistory = scores.map(x => ({
      at: new Date(now - x.off * 86400e3).toISOString(),
      score: x.s, full: 100, right: Math.round(x.s / 100 * 75),
      total: 75, elapsed: 4200, auto: false, passScore: 80,
      pass: x.s >= 80, single: Math.round(x.s * 0.5), multi: Math.round(x.s * 0.5),
    }));

    /* ---- 计时统计 ---- */
    b.S.stats = { day: day(0), dayMs: 22 * 7200, totalMs: 26 * 3600e3 };
    b.S.optRound = 3;

    /* ---- 进度位置：让各页面一打开就停在有内容的地方 ---- */
    b.S.mode = 'seq';
    b.S.pos = { seq: 12, random: 5, wrong: 0, star: 0, search: 0 };
    b.S.drill.single.pos = 6;
    b.S.drill.multi.pos = 3;
    b.S.drill.hard.pos = 0;

    b.save(); b.render();
    return {
      agg: b.aggregateCount(),
      wrong: b.S.wrong.length,
      star: b.S.star.length,
      rank: b.wrongRank().length,
      pool: b.drillPool('hard').length,
      boards: b.BOARD_KEYS.reduce((o,k)=>(o[k]=Object.keys(b.S.ansAll[k]||{}).length,o),{}),
    };
  })()`);
  console.log('   造数据完成:', JSON.stringify(seeded));

  const goto = async (tab) => {
    await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.textContent.includes(${JSON.stringify(tab)})); if(t) t.click(); return 1; })()`);
    await sleep(700);
  };

  /* =========================================================
     逐页截图
     ========================================================= */
  console.log('\n截图中...');

  await goto('顺序刷题');
  await sleep(400);
  await shot('01-seq.png');

  await goto('随机刷题');
  await shot('02-random.png');

  await goto('单选专项');
  await shot('03-single.png');

  await goto('多选专项');
  await shot('04-multi.png');

  await goto('错题攻坚');
  await shot('05-hard.png');

  await goto('错题本');
  await shot('06-wrongbook.png');

  await goto('收藏');
  await shot('07-star.png');

  await goto('模拟考试');
  await shot('08-exam-setup.png');

  /* 考试进行中：开考、答几题后截 */
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('开始考试')); if(b) b.click(); return 1; })()`);
  await sleep(900);
  await ev(`(async () => {
    const b = window.__bank, E = b.S.exam;
    for (let i = 0; i < 6; i++) {
      E.pos = i; b.save(); b.render();
      await new Promise(r => setTimeout(r, 120));
      const q = b.BY[E.gids[i]];
      const eo = E.optOrder[E.gids[i]] || q.options.map((_, k) => k);
      if (q.type === '多选题') {
        q.options.map((o,k)=>o.ok?k:-1).filter(k=>k>=0).forEach(oi => {
          const d = eo.indexOf(oi); if (d >= 0) document.querySelectorAll('.opt')[d].click();
        });
      } else {
        const oi = q.options.findIndex(o => o.ok);
        document.querySelectorAll('.opt')[eo.indexOf(oi)].click();
      }
      await new Promise(r => setTimeout(r, 100));
    }
    E.pos = 3; b.save(); b.render();
    return 1;
  })()`);
  await sleep(800);
  await shot('09-exam-running.png');

  /* 交卷 → 成绩单 */
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='交卷'); if(b) b.click(); return 1; })()`);
  await sleep(1000);
  await shot('10-exam-score.png');

  /* 逐题解析 */
  await ev(`(() => { const r=document.querySelector('.rrow'); if(r) r.click(); return 1; })()`);
  await sleep(800);
  await shot('11-exam-review.png');
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('返回成绩单')); if(b) b.click(); return 1; })()`);
  await sleep(600);

  await goto('统计');
  await shot('12-stats.png');

  /* 统计页的按难度维度 */
  await ev(`(() => { const b=[...document.querySelectorAll('.seg button')].find(x=>x.textContent==='按难度'); if(b) b.click(); return 1; })()`);
  await sleep(700);
  await shot('13-stats-diff.png');
  await ev(`(() => { const b=[...document.querySelectorAll('.seg button')].find(x=>x.textContent==='按题型'); if(b) b.click(); return 1; })()`);
  await sleep(500);

  await goto('成绩走势');
  await shot('14-trend.png');

  await goto('错题排行');
  await shot('15-rank.png');

  await goto('搜索');
  await ev(`(() => { const b = window.__bank; b.S.search='RAG'; b.S.pos.search=0; b.save(); b.render(); return 1; })()`);
  await sleep(800);
  await shot('16-search.png');

  /* 查看答案（单题揭示） */
  await goto('顺序刷题');
  await ev(`(async () => {
    const b = window.__bank;
    b.S.pos.seq = 200; b.save(); b.render();
    await new Promise(r => setTimeout(r, 400));
    const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '查看答案');
    if (btn) btn.click();
    return 1;
  })()`);
  await sleep(800);
  await shot('17-reveal-answer.png');

  /* 备份栏（在统计页底部） */
  await goto('统计');
  await ev(`(() => { const b=document.querySelector('.backup'); if(b) b.scrollIntoView({block:'center'}); return 1; })()`);
  await sleep(700);
  await shot('18-backup.png');

  /* =========================================================
     移动端（390px）
     ========================================================= */
  console.log('\n移动端截图...');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Page.navigate', { url: FILE });
  await sleep(2600);
  await ev(`(()=>{ window.confirm=()=>true; return 1; })()`);

  /* 移动端也要有数据 —— 重新种一遍（新页面 localStorage 还在，应该已保留） */
  const mobileState = await ev(`(() => {
    const b = window.__bank;
    return { agg: b.aggregateCount(), wrong: b.S.wrong.length, mode: b.S.mode };
  })()`);
  console.log('   移动端状态:', JSON.stringify(mobileState));

  await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.textContent.includes('顺序刷题')); if(t) t.click(); return 1; })()`);
  await sleep(900);
  await shot('19-mobile-seq.png');

  await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.textContent.includes('单选专项')); if(t) t.click(); return 1; })()`);
  await sleep(900);
  await shot('20-mobile-drill.png');

  console.log('\nJS 异常:', errs.length ? errs : '无');

  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png')).sort();
  const total = files.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`\n共 ${files.length} 张，合计 ${(total / 1024 / 1024).toFixed(2)} MB`);

  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { }
  process.exit(0);
})().catch(e => {
  console.error('FATAL', e.message);
  try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (x) { }
  process.exit(2);
});
