/* eslint-disable */
// @ts-nocheck
/**
 * The digit flip from Calfie (Frenchbear1/calfie, digits.js), as-is: when a
 * number on screen changes, each digit that differs rolls to its new value (up
 * when it grows, down when it shrinks); digits that stay the same don't move.
 * Same timing, blur and column spacing as the calculator. Use it through
 * <Flip> (flip.tsx).
 */
const engine=(()=>{
 'use strict';
 const memory=new Map();
 const reduce=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches}catch(_){return false}};
 const GROUP=/(\d)[,  '’](?=\d{3}(?:\D|$))/g;
 const num=s=>{const m=String(s).replace(/[−–]/g,'-').replace(GROUP,'$1').match(/-?\d+(?:[.,]\d+)?/);return m?parseFloat(m[0].replace(',','.')):NaN};
 if(typeof document!=='undefined'&&!document.getElementById('calfie-digits-css')){
  const st=document.createElement('style');st.id='calfie-digits-css';
  st.textContent='.df-r{--dfp:calc(.34em + var(--ov-v,0em));box-sizing:content-box!important;position:relative;display:inline-grid;vertical-align:baseline;font-variant-numeric:tabular-nums;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 var(--dfp),#000 calc(100% - var(--dfp)),transparent);mask-image:linear-gradient(to bottom,transparent,#000 var(--dfp),#000 calc(100% - var(--dfp)),transparent)}.df-r>df-x{grid-area:1/1;display:block;white-space:pre;width:max-content}.df-r>df-x.df-out{position:absolute;grid-area:auto;top:var(--dfp);left:.6em;right:.6em;width:auto;text-align:center}.df-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.df-v{white-space:pre}.df-v,.df-r>df-x,.df-sr{padding:0!important;margin:0!important}.df-r{padding:var(--dfp) .6em!important;margin:calc(var(--dfp)*-1) -.6em!important}.df-v,.df-r,.df-r>df-x,.df-sr{min-width:0!important;font:inherit!important;text-align:inherit!important;border:0!important;background:none!important}';
  (document.head||document.documentElement).append(st);
 }
 const EASE='cubic-bezier(.22,.8,.3,1)',CLOSE='cubic-bezier(.45,0,.25,1)';
 /* the soft blur while a digit moves; the answer line goes without it (lighter on the phone when a long number rolls) */
 let BLUR='blur(2.5px)';const fx=(k,b)=>{if(BLUR)k.filter=b;return k};
 /* Number animation speed from the theme (builder › Type › Number animation): 100% is the normal pace, 200% twice as quick,
    50% half as quick, and Off shows every change at once. */
 const speed=()=>1;
 let DUR=280,K=1;
 /* Which column each character belongs to. The ones digit lines up with the ones digit, the tenths with the tenths and so on, so going from 1 to 1.25 keeps the 1 where it is and the new .25 simply grows in beside it (instead of every digit shifting a column). Text without a number is lined up from the right. */
 /* Typing (the new number starts with the old one, or the other way round for delete): characters keep their place counted from
    the left, so the digits already there stay put and only the new digit rolls in (or the last one rolls away). A thousands
    separator is keyed by how many characters sit before it, so when it moves it closes in one spot and opens in the other. */
 const bare=t=>t.replace(GROUP,'$1');
 const keysLeft=chars=>{const text=chars.join(''),keys=[];let n=0;for(let j=0;j<chars.length;j++){const g=/[,  '’]/.test(chars[j])&&/\d/.test(chars[j-1]||'')&&/^\d{3}(?:\D|$)/.test(text.slice(j+1));keys.push(g?'g':'c'+n);if(!g)n++}let gi=0;for(let j=keys.length-1;j>=0;j--)if(keys[j]==='g')keys[j]='g'+(gi++);return keys};
 const typing=(a,b)=>{a=bare(a);b=bare(b);return a!==b&&(b.startsWith(a)||a.startsWith(b))&&!/^-?0$/.test(a)&&!/^-?0$/.test(b)};
 const keysOf=chars=>{
  const text=chars.join(''),m=/^(\D*?)(\d{1,3}(?:[,\u00a0\u202f'’]\d{3})+|\d+)(?:([.,]\d+))?([\s\S]*)$/.exec(text),n=chars.length;
  if(!m)return chars.map((_,j)=>'i'+(n-1-j));
  const P=[...m[1]].length,I=[...m[2]].length,F=m[3]?[...m[3]].length:0,keys=[];
  for(let j=0;j<P;j++)keys.push('p'+(P-1-j));for(let j=0;j<I;j++)keys.push('i'+(I-1-j));for(let j=0;j<F;j++)keys.push('f'+j);
  for(let j=keys.length;j<n;j++)keys.push('s'+(j-P-I-F));return keys;
 };
 /* widths are animated in em, so a line that changes size while it rolls (the answer shrinking to fit) never leaves a column too wide or too narrow */
 const em=(cell,w)=>{let f=16;try{f=parseFloat(getComputedStyle(cell).fontSize)||16}catch(_){}return (w/f).toFixed(4)+'em'};
 /* the width of the digit itself: a column has room around it (so a digit on its way in or out is never cut off) that is not part of it */
 /* (its laid-out width, so a line that is being scaled on screen at the moment is not measured scaled) */
 const widthNow=cell=>{try{const w=parseFloat(getComputedStyle(cell).width);if(Number.isFinite(w))return w;const cs=getComputedStyle(cell);return cell.getBoundingClientRect().width-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0)}catch(_){return 0}};
 const glyph=ch=>{const g=document.createElement('df-x');g.textContent=ch;return g};
 const stop=st=>{if(!st)return;for(const c of st.cols)for(const g of c.glyphs)try{g.__a?.cancel()}catch(_){}};
 /* no animation: the element shows exactly this text */
 function plain(el,text){
  stop(el.__df);
  const vis=document.createElement('df-x');vis.className='df-v';vis.setAttribute('aria-hidden','true');
  const sr=document.createElement('df-x');sr.className='df-sr';sr.textContent=text;
  const chars=[...text],ks=keysOf(chars);
  const cols=chars.map((ch,j)=>{const cell=document.createElement('df-x');cell.className='df-r';const g=glyph(ch);cell.append(g);vis.append(cell);return {cell,glyphs:[g],ch,k:ks[j]}});
  el.textContent='';el.append(vis,sr);
  el.__df={vis,sr,cols,text};
  el.__dfText=text;
 }
 /* whatever a piece looks like right now becomes where its way out starts */
 function leave(col,g,sh,delay,dur,done){
  let from=fx({transform:'translateY(0)',opacity:'1'},'blur(0px)');
  try{if(g.__a){const cs=getComputedStyle(g);from=fx({transform:cs.transform==='none'?'translateY(0)':cs.transform,opacity:cs.opacity},cs.filter==='none'?'blur(0px)':cs.filter)}}catch(_){}
  try{g.__a?.cancel()}catch(_){}
  g.__out=true;
  const a=g.animate([from,fx({transform:'translateY('+(-sh)+'%)',opacity:0},BLUR)],{duration:dur,delay,easing:EASE,fill:'forwards'});
  g.__a=a;
  a.finished.then(()=>{if(g.__a!==a)return;g.remove();const i=col.glyphs.indexOf(g);if(i>=0)col.glyphs.splice(i,1);done?.()},()=>{});
 }
 function enter(g,sh,delay,dur){
  const a=g.animate([fx({transform:'translateY('+sh+'%)',opacity:0},BLUR),fx({transform:'translateY(0)',opacity:1},'blur(0px)')],{duration:dur,delay,easing:EASE,fill:'backwards'});
  g.__a=a;a.finished.then(()=>{if(g.__a===a){try{a.cancel()}catch(_){}g.__a=null}},()=>{});
 }
 function set(el,text,o){
  const all=!!o?.all;
  if(!el)return;
  text=String(text);
  const st=el.__df,prev=el.__dfText;
  if(prev===text&&!all)return;
  const sp=o&&Number.isFinite(o.speed)?Math.max(0,Math.min(3,o.speed)):speed();K=sp>0?1/sp:1;DUR=Math.round(280*K);BLUR=o?.blur===false?'':'blur(2.5px)';
  if(prev===undefined||!st||st.vis.parentNode!==el||reduce()||sp<=0||!el.isConnected||!el.getClientRects().length||typeof el.animate!=='function'){plain(el,text);return}
  const b=[...text],up=typeof o?.up==='boolean'?o.up:!(num(text)<num(prev)),sh=up?85:-85;
  el.__dfText=text;st.text=text;st.sr.textContent=text;
  const keyFn=!all&&typing(prev,text)?keysLeft:keysOf,old=st.cols,kb=keyFn(b);
  {const ko=keyFn([...prev]);if(ko.length===old.length)old.forEach((c,i)=>{c.k=ko[i]})}
  const byKey=new Map(old.map(c=>[c.k,c])),used=new Set(),cells=new Array(b.length);
  /* Every column (and every one still closing from an earlier change) restarts from exactly where it is on screen, its width and its
     slide on one shared timeline from now. Then each digit travels in a straight line from where it is to where it ends up, so no
     gap opens between neighbours however fast the number changes (separate timelines left gaps, mostly around the commas). */
  const going=(st.gone||[]).filter(c=>c.cell.isConnected),before=[...old,...going];
  const at=new Map(),cw=new Map();
  const busy=before.some(c=>c.cell.__w?.playState==='running');
  for(const c of before){at.set(c.cell,c.cell.getBoundingClientRect().left);cw.set(c.cell,widthNow(c.cell))}
  for(const c of before){try{c.cell.__w?.cancel()}catch(_){}c.cell.__w=null;try{c.cell.__f?.cancel()}catch(_){}c.cell.__f=null}
  for(let j=0;j<b.length;j++){
   /* the right-to-left ripple is for a whole new number; typing changes one or two columns and they move together with their room opening */
   const k=kb[j],c=b[j],col=byKey.get(k),delay=all?Math.min(110,(b.length-1-j)*20)*K:0;
   if(col){
    used.add(k);cells[j]=col;
    if(col.ch===c&&!all)continue;
    const now=performance.now(),quick=col.t&&now-col.t<220*K;col.t=now;
    /* Changing faster than the roll: a digit that has only just started coming in is simply changed in place (it is already on its way,
       so the number keeps up with the finger at once and nothing piles up); only one older digit is still rolling out behind it. */
    const live=col.glyphs.find(g=>!g.__out);
    let progress=1;try{if(live&&live.__a){const p=live.__a.effect.getComputedTiming().progress;progress=p===null||p===undefined?0:p}}catch(_){}
    if(live&&live.__a&&progress<.6){live.textContent=c;col.ch=c;continue}
    /* otherwise the digit that is showing rolls out and the new one rolls in (a little quicker while the column is busy) */
    const dur=quick?Math.round(190*K):DUR;
    /* busy column: older digits that are still rolling out are dropped, so there is never more than one leaving and one arriving */
    if(quick)for(const g of [...col.glyphs])if(g.__out){try{g.__a?.cancel()}catch(_){}g.remove();col.glyphs.splice(col.glyphs.indexOf(g),1)}
    for(const g of [...col.glyphs])if(!g.__out){g.classList.add('df-out');leave(col,g,sh,delay,dur)}
    const g=glyph(c);col.cell.append(g);col.glyphs.push(g);col.ch=c;enter(g,sh,delay,dur);
    while(col.glyphs.length>3){const x=col.glyphs.shift();try{x.__a?.cancel()}catch(_){}x.remove()}
    continue}
   /* a column that was not there: it grows open to its width while its character rolls in */
   const cell=document.createElement('df-x');cell.className='df-r';const g=glyph(c);cell.append(g);
   cells[j]={cell,glyphs:[g],ch:c,k,fresh:true,delay};
  }
  /* put the new columns in their place, working from the right so each one has a neighbour to sit before */
  let ref=null;const fresh=new Set();
  for(let j=b.length-1;j>=0;j--){
   const col=cells[j];
   if(col.fresh){st.vis.insertBefore(col.cell,ref);enter(col.glyphs[0],sh,col.delay,DUR);fresh.add(col);delete col.fresh;delete col.delay}
   else if(col.cell.nextElementSibling!==ref&&!(ref===null&&!col.cell.nextElementSibling))st.vis.insertBefore(col.cell,ref);
   ref=col.cell;
  }
  /* columns that are going stay where they were among their neighbours (a deleted last digit leaves from the end, a comma from
     its own spot), instead of being pushed to the front while the others are put in order */
  {let anchor=null;for(const col of old){if(used.has(col.k)){anchor=col.cell;continue}if(!col.cell.isConnected)continue;if(anchor){if(anchor.nextSibling!==col.cell)anchor.after(col.cell)}else if(st.vis.firstChild!==col.cell)st.vis.prepend(col.cell);anchor=col.cell}}
  /* columns that are gone roll out and close up, then leave */
  let n=0;const leaving=[...going];
  for(const col of old){
   if(used.has(col.k))continue;
   const delay=all?Math.min(110,(n++)*20)*K:0;
   /* the column leaves once its digit is gone AND its room has closed (pressed again quickly, the closing restarts from where it is
      and runs on after the digit has gone; taking the column out then dropped the rest of its width in one frame, a jump) */
   for(const g of [...col.glyphs])if(!g.__out)leave(col,g,sh,delay,DUR,()=>{if(!col.glyphs.length&&col.cell.__w?.playState!=='running')col.cell.remove()});
   /* closed is its resting width: when the next change cancels its closing animation, a column that has already shut stays shut
      (it sprang back open for a frame while its digit was still fading out) */
   if(!col.glyphs.length)col.cell.remove();else{col.cell.style.width='0px';leaving.push(col)}
  }
  st.gone=leaving;
  /* A change that only takes columns away (backspace) closes up on a gentle in-and-out curve, so the room closes as the digit leaves
     instead of snapping shut at the start while the digit is still on its way out (opening uses the quick curve, as the digit arrives). */
  /* Changed again while columns are still moving (backspace held or tapped fast): they carry on on the quick curve, since the gentle one
     starts from standing still and, restarted on every press, made the closing stall and lurch. */
  const SLIDE=!o?.quick&&!busy&&!fresh.size&&leaving.length>going.length?CLOSE:EASE;
  /* widths: from what each column measures now to its own width (0 for one that is going), in em so a line that changes size
     meanwhile stays in step; a new column opens from 0 */
  const wa=[];
  for(const col of [...cells,...leaving]){if(!col.cell.isConnected)continue;const from=fresh.has(col)?0:(cw.get(col.cell)??widthNow(col.cell)),to=leaving.includes(col)?0:widthNow(col.cell);wa.push([col,from,to])}
  for(const [col,from,to] of wa){if(Math.abs(from-to)<.3)continue;
   try{const a=col.cell.animate([{width:em(col.cell,from)},{width:em(col.cell,to)}],{duration:DUR,easing:SLIDE,fill:to===0?'both':'backwards'});col.cell.__w=a;if(to!==0)a.finished.then(()=>{if(col.cell.__w===a){try{a.cancel()}catch(_){}col.cell.__w=null}},()=>{});else a.finished.then(()=>{if(col.cell.__w===a&&!col.glyphs.length)col.cell.remove()},()=>{})}catch(_){}}
  /* then every column slides from where it was on screen (in the element's own units: on screen it may be scaled at the moment) */
  let sx=1;try{const ow=el.offsetWidth;if(ow>0){const q=el.getBoundingClientRect().width/ow;if(q>.2&&q<5)sx=q}}catch(_){}
  for(const [col] of wa){const x=at.get(col.cell);if(x===undefined)continue;const dx=(x-col.cell.getBoundingClientRect().left)/sx;
   if(Math.abs(dx)>.5){try{col.cell.__f=col.cell.animate([{transform:'translateX('+dx+'px)'},{transform:'none'}],{duration:DUR,easing:SLIDE,fill:'backwards'})}catch(_){}}}
  st.cols=cells;
 }
 function mount(el,key,text){
  text=String(text);
  const prev=memory.get(key);memory.set(key,text);
  if(prev!==undefined&&prev!==text){plain(el,prev);requestAnimationFrame(()=>set(el,text))}
  else plain(el,text);
  return el;
 }
 const reset=prefix=>{for(const k of [...memory.keys()])if(!prefix||k.startsWith(prefix))memory.delete(k)};
 return {set,mount,reset,from:plain,typing,bare,speed};
})();

export const FlipDigits = engine;
