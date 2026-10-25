/**
 * probe_reset_mobile.js — 窄屏下「重置本板块」按钮的排版（真实浏览器）
 */
const fs=require('fs'),path=require('path');
const {spawn,execSync}=require('child_process');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE='file:///D:/program/%E9%A2%98%E5%BA%93/%E9%98%BF%E9%87%8C%E4%BA%91ACP%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E7%A6%BB%E7%BA%BF%E9%A2%98%E5%BA%93.html';
const PORT=9921, OUT=path.resolve(__dirname,'screens'), PROFILE=path.resolve(__dirname,'resetmprof');
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
  let id=0;const pend=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(m,p)=>new Promise(r=>{const n=++id;pend.set(n,r);ws.send(JSON.stringify({id:n,method:m,params:p}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:undefined;};
  await send('Runtime.enable',{});await send('Page.enable',{});
  let bad=0;
  for(const w of [320,360,390,768,1280]){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:844,deviceScaleFactor:1,mobile:w<700});
    await send('Page.navigate',{url:FILE}); await sleep(1900);
    await ev(`(()=>{window.confirm=()=>true;const b=window.__bank;b.S.ans={};b.S.wrong=[];b.S.wcnt={};b.S.streak={};
      b.QS.filter(x=>x.type==='单选题').slice(0,4).forEach(q=>{b.S.wrong.push(q.gid);b.S.wcnt[q.gid]=1});
      b.S.mode='seq';b.S.pos.seq=3;b.save();b.render();return 1})()`);
    await sleep(500);
    const m=await ev(`(()=>{
      const out={};
      const findBtn=()=>[...document.querySelectorAll('button')].find(x=>/^重置(本板块|本轮)$/.test(x.textContent.trim()));
      const btn=findBtn();
      const row=btn?btn.parentElement:null;
      out.hasBtn=!!btn;
      if(btn){
        const r=btn.getBoundingClientRect();
        out.btn={w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top)};
        out.btnText=btn.textContent.trim();
        // 按钮是否被裁（超出视口宽度）
        out.clipped = r.right > document.documentElement.clientWidth + 1 || r.left < -1;
        // 这一行是否换行（子元素 top 不同）
        if(row) out.rowWrapped = new Set([...row.children].map(c=>Math.round(c.getBoundingClientRect().top))).size>1;
        // 按钮是否可点（不被遮挡）：取中心点做 elementFromPoint
        const cx=r.left+r.width/2, cy=r.top+r.height/2;
        const hit=document.elementFromPoint(cx,cy);
        out.clickable = hit===btn || (btn.contains(hit));
      }
      out.hOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      return out;
    })()`);
    const ok = m.hasBtn && !m.clipped && m.clickable && !m.hOverflow;
    if(!ok) bad++;
    console.log(`【${m.hasBtn?'':''}${w}px】${ok?'✅':'❌'} 按钮=${JSON.stringify(m.btnText)} 尺寸=${JSON.stringify(m.btn)} 被裁=${m.clipped} 换行=${m.rowWrapped} 可点=${m.clickable} 横向溢出=${m.hOverflow}`);

    // 各板块都检查一遍
    for(const [tab,label] of [['随机刷题','重置本板块'],['错题本','重置本板块'],['收藏','重置本板块'],['单选专项','重置本专项']]){
      await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(x=>x.textContent.includes(${JSON.stringify(tab)}));if(t)t.click();return 1})()`);
      await sleep(450);
      const r=await ev(`(()=>{
        const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});
        if(!btn) return {missing:true, btns:[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>t.includes('重置'))};
        const rc=btn.getBoundingClientRect();
        const hit=document.elementFromPoint(rc.left+rc.width/2, rc.top+rc.height/2);
        return {w:Math.round(rc.width),clipped:rc.right>document.documentElement.clientWidth+1,
                clickable:hit===btn||btn.contains(hit),
                hOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      })()`);
      const okl = !r.missing && !r.clipped && r.clickable && !r.hOverflow;
      if(!okl) bad++;
      console.log(`    ${tab}: ${okl?'✅':'❌'} ${JSON.stringify(r)}`);
    }
    if(w===390){
      await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(x=>x.textContent.includes('顺序刷题'));if(t)t.click();return 1})()`);
      await sleep(500);
      const s=await send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(OUT,'reset_mobile_390.png'),Buffer.from(s.result.data,'base64'));
      console.log('    → reset_mobile_390.png');
    }
  }
  try{execSync(`taskkill /PID ${proc.pid} /T /F`,{stdio:'ignore'});}catch(e){}
  console.log(bad?`\n❌ ${bad} 处排版问题`:'\n✅ 各宽度排版正常');
  process.exit(bad?1:0);
})().catch(e=>{console.error('FATAL',e.message);try{execSync(`taskkill /PID ${proc.pid} /T /F`,{stdio:'ignore'});}catch(x){}process.exit(2);});
