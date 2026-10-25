/**
 * shots_reveal_rate.js — 真实浏览器截图：查看答案行为 + 正确率徽标位置
 * 输出 verify/screens/reveal_*.png
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = 'file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT = 9911;
const OUT = path.resolve(__dirname, 'screens');
const PROFILE = path.resolve(__dirname, 'revealprof');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-breakpad','--disable-crash-reporter','--disable-extensions',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'], { stdio:'ignore' });

(async () => {
  for (let i=0;i<100;i++){ await sleep(250); try{ if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; }catch(e){} }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x=>x.type==='page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage = e => { const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails).slice(0,200)); };
  const send=(m,p)=>new Promise(r=>{const n=++id;pend.set(n,r);ws.send(JSON.stringify({id:n,method:m,params:p}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,300)};
    return r.result&&r.result.result?r.result.result.value:undefined;};
  const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(OUT,n),Buffer.from(r.result.data,'base64')); console.log('   →', n);};

  await send('Runtime.enable',{}); await send('Page.enable',{});

  for (const c of [{w:390,mobile:true,tag:'mobile'},{w:1280,mobile:false,tag:'desktop'}]) {
    await send('Emulation.setDeviceMetricsOverride',{width:c.w,height:900,deviceScaleFactor:2,mobile:c.mobile});
    await send('Page.navigate',{url:FILE}); await sleep(2200);

    // 造数据：做 8 题，6 对 2 错
    await ev(`(() => {
      const b=window.__bank;
      b.S.ans={}; b.S.wrong=[]; b.S.wcnt={}; b.S.streak={}; b.S.reveal={}; b.S.memorizing=false;
      const singles=b.QS.filter(x=>x.type==='单选题');
      singles.slice(0,8).forEach((q,i)=>{
        const ok = i<6;
        const cor = q.options.map((o,k)=>o.ok?k:-1).filter(k=>k>=0);
        b.S.ans[q.gid]={sel: ok?cor:[q.options.findIndex(o=>!o.ok)], ok, t:4000+i*200};
        if(!ok) b.noteWrong(q.gid);
      });
      b.S.mode='seq'; b.S.pos.seq=9; b.save(); b.render();
      return 1;
    })()`);
    await sleep(700);

    // 未作答的题（第 10 题）
    console.log(`\n【${c.tag} ${c.w}px】`);
    await shot(`reveal_${c.tag}_1_rate_badge.png`);

    const info = await ev(`(() => {
      const b=window.__bank;
      const r=document.querySelector('.qrate');
      const idx=document.querySelector('.qidx');
      const head=document.querySelector('.qhead');
      if(!r) return {noBadge:true};
      const rr=r.getBoundingClientRect(), ir=idx.getBoundingClientRect(), hr=head.getBoundingClientRect();
      return {
        text:r.textContent,
        sameRow: Math.abs(rr.top-ir.top) < 8,
        insideHead: rr.top >= hr.top-2 && rr.bottom <= hr.bottom+2,
        headH: Math.round(hr.height),
        badgeW: Math.round(rr.width), badgeH: Math.round(rr.height),
        memorizing: b.S.memorizing,
      };
    })()`);
    console.log('   正确率徽标:', JSON.stringify(info));

    // 点「查看答案」，确认只影响本题
    await ev(`(() => {
      const b=window.__bank;
      const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='查看答案');
      if(btn) btn.click();
      return 1;
    })()`);
    await sleep(600);
    const after = await ev(`(() => {
      const b=window.__bank;
      return {
        memorizing: b.S.memorizing,
        revealKeys: Object.keys(b.S.reveal||{}).length,
        hasResult: !!document.querySelector('.result'),
        memorizeBtnOn: document.getElementById('btMemorize').classList.contains('on'),
        hasContinue: [...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='继续作答'),
      };
    })()`);
    console.log('   点查看答案后:', JSON.stringify(after));
    await shot(`reveal_${c.tag}_2_after_reveal.png`);

    // 切下一题，确认恢复
    await ev(`(() => {
      const b=[...document.querySelectorAll('button')].find(x=>/下一题/.test(x.textContent));
      if(b) b.click(); return 1;
    })()`);
    await sleep(600);
    const next = await ev(`(() => {
      const b=window.__bank;
      return { revealKeys:Object.keys(b.S.reveal||{}).length, hasResult:!!document.querySelector('.result'),
               memorizing:b.S.memorizing };
    })()`);
    console.log('   切下一题后:', JSON.stringify(next));
    await shot(`reveal_${c.tag}_3_next_question.png`);
  }

  console.log('\nJS 异常:', errs.length ? errs : '无');
  try{execSync(`taskkill /PID ${proc.pid} /T /F`,{stdio:'ignore'});}catch(e){}
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);try{execSync(`taskkill /PID ${proc.pid} /T /F`,{stdio:'ignore'});}catch(x){}process.exit(2);});
