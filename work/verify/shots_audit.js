/**
 * shots_audit.js — 对抗性审查修复的真浏览器验收（5 项）
 */
const fs=require('fs'),path=require('path');
const {spawn,execSync}=require('child_process');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE='file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT=9950, OUT=path.resolve(__dirname,'screens'), PROFILE=path.resolve(__dirname,'auditprof');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(OUT,{recursive:true});
const proc=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
 '--disable-breakpad','--disable-crash-reporter','--disable-extensions',
 '--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'about:blank'],{stdio:'ignore'});
(async()=>{
  for(let i=0;i<100;i++){await sleep(250);try{if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok)break;}catch(e){}}
  const t=(await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x=>x.type==='page');
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const pend=new Map();const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown')errs.push(JSON.stringify(m.params.exceptionDetails).slice(0,160));};
  const send=(m,p)=>new Promise(r=>{const n=++id;pend.set(n,r);ws.send(JSON.stringify({id:n,method:m,params:p}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails)return{__err:JSON.stringify(r.result.exceptionDetails).slice(0,200)};
    return r.result&&r.result.result?r.result.result.value:undefined;};
  const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(OUT,n),Buffer.from(r.result.data,'base64'));console.log('   →',n);};

  await send('Runtime.enable',{});await send('Page.enable',{});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:FILE});await sleep(2400);
  await ev(`(()=>{window.confirm=()=>true;return 1})()`);

  let bad=0;
  const rep=(ok,msg,x)=>{if(!ok)bad++;console.log(`   ${ok?'✅':'❌'} ${msg}${x!==undefined?' :: '+JSON.stringify(x):''}`);};
  const goto=async tab=>{await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(x=>x.textContent.includes(${JSON.stringify(tab)}));if(t)t.click();return 1})()`);await sleep(550);};

  console.log('\n【1】移出错题本：真的移出、不动掌握度');
  await goto('错题本');
  const r1=await ev(`(()=>{
    const b=window.__bank;
    const gid=b.S.wrong[0];
    b.setRec(gid,{sel:[0],ok:false,t:800,at:Date.now()},'wrong');
    b.S.pos.wrong=0;b.save();b.render();
    /* 注意：这里必须返回**完整 gid**。前面截断成 8 位去查 S.wcnt 会拿不到（undefined），
       那是测试自己的 bug，不是产品问题。 */
    return {gid,short:gid.slice(0,8),n0:b.S.wrong.length,st0:b.S.streak[gid]||0,wc0:b.S.wcnt[gid]};
  })()`);
  await sleep(500);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='移出错题本');if(b)b.click();return 1})()`);
  await sleep(600);
  const r1b=await ev(`(()=>{const b=window.__bank;const g=${JSON.stringify(r1.gid)};
    return {n1:b.S.wrong.length,inWrong:b.S.wrong.indexOf(g)>=0,st1:b.S.streak[g]||0,wc1:b.S.wcnt[g],
            stillInPool:b.drillPool('hard').some(x=>x.gid===g)}})()`);
  console.log('   错题本:',r1.n0,'→',r1b.n1);
  rep(!r1b.inWrong,'真的移出了（按钮不再说谎）');
  rep(r1b.st1===r1.st0,'掌握度没被误加',{before:r1.st0,after:r1b.st1});
  rep(r1b.wc1===r1.wc0,'历史错次保留',{before:r1.wc0,after:r1b.wc1});
  rep(r1b.stillInPool,'仍在攻坚池（移出≠掌握）');
  await shot('audit_1_remove_from_wrongbook.png');

  console.log('\n【2】统计页「错题本」数与实际一致');
  await goto('统计');
  const r2=await ev(`(()=>{
    const b=window.__bank;
    const labels=[...document.querySelectorAll('.stat .l')].map(x=>x.textContent);
    const vals=[...document.querySelectorAll('.stat .v')].map(x=>x.textContent);
    const i=labels.indexOf('错题本');
    return {labels,shown:i>=0?vals[i]:null,actual:b.S.wrong.length+' 题'};
  })()`);
  rep(r2.shown===r2.actual,'统计页「错题本」= 实际数量',r2);
  await shot('audit_2_stats_metric.png');

  console.log('\n【3】切板块本题计时归零');
  await goto('顺序刷题');
  await sleep(2000);
  const r3=await ev(`(async()=>{
    const b=window.__bank;
    const before=b.TMR.qMs;
    const t=[...document.querySelectorAll('.tab')].find(x=>x.textContent.includes('单选专项'));
    t.click();
    await new Promise(r=>setTimeout(r,120));
    const right=b.TMR.qMs;
    await new Promise(r=>setTimeout(r,1000));
    return {before,right,later:b.TMR.qMs};
  })()`);
  console.log('   切前:',r3.before,'ms → 切后立刻:',r3.right,'ms → 1秒后:',r3.later,'ms');
  rep(r3.right<300,'切板块后归零，不叠加旧用时',r3);
  await shot('audit_3_timer_reset.png');

  console.log('\n【4】全对题在练习页有明确提示');
  const r4=await ev(`(async()=>{
    const b=window.__bank;
    const q=b.QS.find(x=>x.type==='多选题'&&!x.options.some(o=>!o.ok));
    b.S.mode='multi';
    b.S.drill.multi.pos=b.drillPool('multi').findIndex(x=>x.gid===q.gid);
    b.save();b.render();
    await new Promise(r=>setTimeout(r,500));
    const hint=document.querySelector('.hint');
    return {q:q.q.slice(0,40),allOk:q.options.every(o=>o.ok),hint:hint?hint.textContent.slice(0,60):null};
  })()`);
  console.log('   题目:',r4.q);
  rep(!!r4.hint,'给了「需全选」的说明',r4.hint);
  await shot('audit_4_allcorrect_hint.png');

  console.log('\n【5】答对 3 次移出后位置不乱跳');
  /* 正确期望要说清楚：
     · 移出的**就是当前这道题**时，位置不变、原地显示「下一道题」——这是对的，
       因为被移出的题已经不在列表里了，不可能还显示它。
     · 移出的是**位置之前**的题时，位置要前移一位，否则会跳到下一题（那才是 bug）。
     下面两个场景分开验。 */
  const r5=await ev(`(async()=>{
    const b=window.__bank;
    const out={};

    /* 场景 A：移出当前这道题 → 位置不变、不越界、显示下一道 */
    b.S.mode='wrong';b.S.wrong=b.S.wrong.slice(0,10);b.S.pos.wrong=5;b.save();b.render();
    await new Promise(r=>setTimeout(r,350));
    let list=b.modeList();
    const posA=b.S.pos.wrong, gidA=list[posA].gid, nextGid=list[posA+1]?list[posA+1].gid:null;
    b.S.streak[gidA]=2; b.noteRight(gidA); b.save(); b.render();
    await new Promise(r=>setTimeout(r,350));
    out.A={pos0:posA,pos1:b.S.pos.wrong,len:b.modeList().length,
           outOfRange:b.S.pos.wrong>=b.modeList().length,
           showsNext:!!nextGid && b.modeList()[b.S.pos.wrong].gid===nextGid};

    /* 场景 B：移出位置**之前**的题 → 位置前移一位，仍指向原来那道题 */
    b.S.mode='wrong';b.S.wrong=b.S.wrong.slice(0,10);b.S.pos.wrong=5;b.save();b.render();
    await new Promise(r=>setTimeout(r,350));
    list=b.modeList();
    const posB=b.S.pos.wrong, keepGid=list[posB].gid, beforeGid=list[2].gid;
    b.S.streak[beforeGid]=2; b.noteRight(beforeGid); b.save(); b.render();
    await new Promise(r=>setTimeout(r,350));
    out.B={pos0:posB,pos1:b.S.pos.wrong,
           stillSame:!!b.modeList()[b.S.pos.wrong] && b.modeList()[b.S.pos.wrong].gid===keepGid};
    return out;
  })()`);
  console.log('   A 移出当前题:',JSON.stringify(r5.A));
  console.log('   B 移出前面的题:',JSON.stringify(r5.B));
  rep(!r5.A.outOfRange,'A: 移出当前题后不越界',r5.A);
  rep(r5.A.showsNext,'A: 原地显示「下一道题」（被移出的题已不存在，这是唯一合理行为）',r5.A);
  rep(r5.B.stillSame,'★ B: 移出前面的题后，仍停留在原来那道题（不前跳）',r5.B);
  await shot('audit_5_position_after_mastery.png');

  console.log('\nJS 异常:',errs.length?errs:'无');
  console.log(bad?`\n❌ ${bad} 项不符`:'\n✅ 全部符合预期');
  try{execSync(`taskkill /PID ${proc.pid} /T /F`,{stdio:'ignore'});}catch(e){}
  process.exit(bad?1:0);
})().catch(e=>{console.error('FATAL',e.message);try{execSync(`taskkill /PID ${proc.pid} /T /F`,{stdio:'ignore'});}catch(x){}process.exit(2);});
