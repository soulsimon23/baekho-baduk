/**
 * Baekho Baduk v1.1 — offline, dependency-free tactical Go opponent.
 * Deliberately NOT KataGo or a trained neural-network engine.
 * Levels 8–10 use bounded adversarial reply/counter-reply reading.
 */
import {BLACK, neighbors, groupAt, allGroups, tryMove} from './go-core.mjs';

const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const distance=(a,b,n)=>Math.abs(a%n-b%n)+Math.abs((a/n|0)-(b/n|0));
const now=()=>typeof performance==='undefined'?Date.now():performance.now();

/** True-eye approximation (not a complete life-and-death test). */
function solidEye(board,n,idx,color){
  const nb=neighbors(idx,n);
  if(!nb.every(p=>board[p]===color)) return false;
  const x=idx%n,y=(idx/n)|0;
  let bad=0,inside=0;
  for(const dx of [-1,1])for(const dy of [-1,1]){
    const a=x+dx,b=y+dy;
    if(a<0||a>=n||b<0||b>=n)continue;
    inside++;
    if(board[b*n+a]===-color)bad++;
  }
  return inside===4?bad<=1:bad===0;
}

function buildContext(s){
  const n=s.size,c=s.turn,own=[],enemy=[],
    ownAtari=new Map(),enemyAtari=new Map(),ownWeak=new Map(),enemyWeak=new Map();
  for(let i=0;i<s.board.length;i++){
    if(s.board[i]===c)own.push(i);
    else if(s.board[i]===-c)enemy.push(i);
  }
  for(const g of allGroups(s.board,n)){
    if(g.liberties.length>2)continue;
    const isOwn=g.color===c;
    const map=g.liberties.length===1?(isOwn?ownAtari:enemyAtari):(isOwn?ownWeak:enemyWeak);
    for(const p of g.liberties)map.set(p,Math.max(map.get(p)||0,g.stones.length));
  }
  return {own,enemy,ownAtari,enemyAtari,ownWeak,enemyWeak};
}

function basicScore(s,idx,next,ctx){
  const n=s.size,c=s.turn,x=idx%n,y=(idx/n)|0,
    edge=Math.min(x,y,n-1-x,n-1-y),
    captured=next.captures[c===BLACK?'black':'white']-s.captures[c===BLACK?'black':'white'];
  const g=groupAt(next.board,n,idx),adj=neighbors(idx,n);
  let friend=0,foe=0;
  for(const p of adj){if(s.board[p]===c)friend++;else if(s.board[p]===-c)foe++;}
  const eye=solidEye(s.board,n,idx,c);
  if(eye && captured===0 && !ctx.ownAtari.has(idx))return -280;
  if(friend===adj.length && captured===0)return -170;

  let dSelf=99,dOpp=99;
  for(const p of ctx.own){const d=distance(p,idx,n);if(d<dSelf)dSelf=d;if(dSelf===1)break;}
  for(const p of ctx.enemy){const d=distance(p,idx,n);if(d<dOpp)dOpp=d;if(dOpp===1)break;}
  let v=0;
  // Urgent tactical features: real captures, escape and atari threats.
  v+=Math.min(12,captured)*34;
  if(ctx.ownAtari.has(idx)){
    // Only reward a genuine escape, not a move that remains in atari.
    v+=Math.min(11,ctx.ownAtari.get(idx))* (g.liberties.length>=2?27:1);
  }
  v+=Math.min(8,ctx.enemyAtari.get(idx)||0)*13;
  v+=Math.min(5,ctx.enemyWeak.get(idx)||0)*2;
  if(g.liberties.length===1)v-=captured?34:120;
  else if(g.liberties.length===2)v-=20;
  else if(g.liberties.length===3)v-=3;
  if(foe && friend)v+=14;
  if(foe && !friend && g.liberties.length<=2)v-=17;
  if(friend>=3&&!foe&&captured===0)v-=15;

  if(edge===0)v-=35;
  else if(edge===1)v-=18;
  else if(edge===2)v+=6;
  else if(edge===3)v+=11;
  else if(edge===4)v+=6;
  else v+=2;

  if(s.moveNumber<Math.max(9,n)){
    const a=n===9?2:3,b=n-1-a;
    let dc=99;
    for(const [cx,cy] of [[a,a],[a,b],[b,a],[b,b]])dc=Math.min(dc,Math.abs(cx-x)+Math.abs(cy-y));
    v+=Math.max(0,(n===9?8:13)-dc*(n===9?1.5:2.5));
  }
  if(ctx.own.length===0)v+=(dOpp>=4?5:-8);
  else{
    if(dSelf>=3&&dSelf<=6)v+=12;
    if(dSelf===2)v+=7;
    if(dSelf===1&&!foe)v-=7;
    if(dSelf>=10)v-=Math.min(17,dSelf-9);
  }
  if(ctx.enemy.length){
    if(dOpp>=2&&dOpp<=4)v+=8;
    if(dOpp===1&&friend===0)v-=9;
  }
  if(!foe&&ctx.enemy.length&&s.moveNumber>20){
    let ownNear=0,enemyNear=0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      if(Math.abs(dx)+Math.abs(dy)>3)continue;
      const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=n||yy>=n)continue;
      const val=s.board[yy*n+xx];if(val===c)ownNear++;else if(val===-c)enemyNear++;
    }
    if(ownNear>=6&&enemyNear===0)v-=38;
    if(enemyNear>=7&&ownNear===0)v-=18;
  }
  // Connecting separated friendly groups often saves stones from later cuts.
  const adjacent=new Set();
  if(friend>=2){
    for(const p of adj)if(s.board[p]===c){
      const g0=groupAt(s.board,n,p);
      adjacent.add(Math.min(...g0.stones));
    }
    if(adjacent.size>=2)v+=13;
  }
  return v;
}

function rankedMoves(s,limit=361){
  const ctx=buildContext(s),arr=[];
  for(let i=0;i<s.board.length;i++)if(!s.board[i]&&i!==s.ko){
    const next=tryMove(s,i,{record:false});if(!next)continue;
    arr.push({idx:i,score:basicScore(s,i,next,ctx),next});
  }
  arr.sort((a,b)=>b.score-a.score);
  return arr.slice(0,limit);
}

const searchOptions={
  8:{root:5,replies:4,counters:0,budget:350},
  9:{root:8,replies:5,counters:1,budget:700},
  10:{root:11,replies:6,counters:2,budget:1150},
};

/** Conservative adversarial reading, calibrated in heuristic score units. */
function searchHighLevel(s,ranked,level){
  const cfg=searchOptions[level];if(!cfg)return {searched:0,iterations:0};
  const start=now();let searched=0,iterations=0;
  // Retain all candidates, only re-evaluate the best moves with tactical reading.
  for(const candidate of ranked.slice(0,cfg.root)){
    if(searched && now()-start>cfg.budget)break;
    const opponentColor=candidate.next.turn;
    const replies=rankedMoves(candidate.next,cfg.replies);
    let worst=0;
    for(const reply of replies){
      iterations++;
      const lost=reply.next.captures[opponentColor===BLACK?'black':'white']-
        candidate.next.captures[opponentColor===BLACK?'black':'white'];
      // The stone just placed can be captured immediately, including snapbacks.
      const rootCaptured=reply.next.board[candidate.idx]!==s.turn;
      let threat=Math.max(0,reply.score-17)*0.25 + lost*30 + (rootCaptured?52:0);
      // If the opponent puts our new group in atari, that is also a tactical risk.
      if(!rootCaptured){
        const g=groupAt(reply.next.board,s.size,candidate.idx);
        if(g.liberties.length===1)threat+=18;
      }
      // At 9–10, read a best defensive reply: avoid over-penalizing a threat
      // which can immediately be recaptured/answered profitably.
      if(cfg.counters && (lost>0||rootCaptured||threat>=21)){
        const counters=rankedMoves(reply.next,cfg.counters);
        if(counters.length){
          const counter=counters[0];
          const regained=counter.next.captures[s.turn===BLACK?'black':'white']-
            reply.next.captures[s.turn===BLACK?'black':'white'];
          const recapture=counter.next.board[candidate.idx]===s.turn;
          threat-=Math.min(32,Math.max(0,counter.score-25)*0.13+regained*22+(recapture?12:0));
        }
      }
      worst=Math.max(worst,threat);
    }
    candidate.searchScore=candidate.score-worst;
    searched++;
  }
  for(const m of ranked)if(m.searchScore===undefined)m.searchScore=m.score-10;
  ranked.sort((a,b)=>(b.searchScore-a.searchScore)||(b.score-a.score));
  return {searched,iterations};
}

/**
 * Offline opponent. Level 8–10 searches enemy responses and (9–10) counter-responses.
 * It is a bounded heuristic, NOT a professional or neural network strength claim.
 */
export function pickMove(s,level=s.level,random=Math.random){
  level=clamp(Math.floor(level||5),1,10);
  const started=now(),ranked=rankedMoves(s);
  if(!ranked.length)return {pass:true,reason:'no-legal-move',elapsedMs:Math.round(now()-started)};
  let search={searched:0,iterations:0};
  if(level>=8 && s.moveNumber>=2)search=searchHighLevel(s,ranked,level);
  const best=ranked[0].searchScore??ranked[0].score;
  if(s.moveNumber>Math.max(70,s.size*s.size*.42)&&best< -13)
    return {pass:true,reason:'no-productive-move',elapsedMs:Math.round(now()-started),...search};
  const temperature=[0,28,23,19,15,12,9,7,3,1,0][level];
  let chosen;
  if(temperature===0)chosen=ranked[0];
  else{
    const sample=ranked.slice(0,Math.min(ranked.length,Math.max(6,26-level*2)));
    let max=-Infinity;
    for(const m of sample){
      const u=clamp(random(),0.00001,0.99999);
      const value=(m.searchScore??m.score)-temperature*Math.log(-Math.log(u));
      if(value>max){max=value;chosen=m;}
    }
  }
  return {point:chosen.idx,reason:search.searched?'tactical-search':'heuristic',strength:level,
    elapsedMs:Math.round(now()-started),...search};
}
