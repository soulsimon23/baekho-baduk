/** Baekho Baduk core — board and basic Korean territory scoring. No network dependencies. */
export const BLACK = 1, WHITE = -1, EMPTY = 0;
export const opponent = c => -c;
export const labelColor = c => c === BLACK ? '흑' : '백';
export function neighbors(i, n) {
  const x = i % n, y = (i / n) | 0, a = [];
  if (x > 0) a.push(i-1); if (x < n-1) a.push(i+1);
  if (y > 0) a.push(i-n); if (y < n-1) a.push(i+n);
  return a;
}
export function groupAt(board, n, start) {
  const color = board[start];
  if (!color) return {color:0,stones:[],liberties:[]};
  const seen = new Set([start]), liberties = new Set(), stones=[], queue=[start];
  for (let k=0;k<queue.length;k++) {
    const i=queue[k]; stones.push(i);
    for (const j of neighbors(i,n)) {
      if (board[j]===0) liberties.add(j);
      else if (board[j]===color && !seen.has(j)) {seen.add(j);queue.push(j);}
    }
  }
  return {color,stones,liberties:[...liberties]};
}
export function allGroups(board,n) {
  const result=[], seen=new Uint8Array(n*n);
  for (let i=0;i<n*n;i++) if(board[i] && !seen[i]) {
    const g=groupAt(board,n,i); for (const s of g.stones) seen[s]=1; result.push(g);
  }
  return result;
}
export function handicapPoints(n, h) {
  if (h<2) return [];
  const m=n===9?2:3, z=n-1-m, c=(n-1)/2;
  const A=[z,m], B=[m,z], C=[z,z], D=[m,m],
        E=[m,c], F=[z,c], G=[c,m], H=[c,z], I=[c,c];
  const presets={2:[A,B],3:[A,B,C],4:[A,B,C,D],5:[A,B,C,D,I],
    6:[A,B,C,D,E,F],7:[A,B,C,D,E,F,I],8:[A,B,C,D,E,F,G,H],9:[A,B,C,D,E,F,G,H,I]};
  return (presets[h]||[]).map(([x,y])=>y*n+x);
}
export function starPoints(n) {
  if (n===9) return [[2,2],[2,6],[6,2],[6,6],[4,4]];
  const p=n===13?[3,6,9]:[3,9,15];
  return p.flatMap(x=>p.map(y=>[x,y]));
}
export function newGame({size=19,handicap=0,humanColor=BLACK,level=5}={}) {
  size=[9,13,19].includes(+size)?+size:19;
  handicap=Math.max(0,Math.min(9,Math.floor(+handicap)||0));
  level=Math.max(1,Math.min(10,Math.floor(+level)||5));
  const board=Array(size*size).fill(0);
  for (const p of handicapPoints(size,handicap)) board[p]=BLACK;
  return {size,board,turn:handicap>=2?WHITE:BLACK,ko:-1,passes:0,
    captures:{black:0,white:0},komi:handicap?0.5:6.5,handicap,
    humanColor:humanColor===WHITE?WHITE:BLACK,level,moveNumber:0,lastMove:null,
    moves:[],result:null};
}
export function tryMove(s, idx, {record=true}={}) {
  const n=s.size, c=s.turn, b=s.board;
  if (!Number.isInteger(idx)||idx<0||idx>=b.length||b[idx]||idx===s.ko||s.result) return null;
  const next=b.slice(); next[idx]=c;
  let taken=0, lastCaptured=-1;
  const inspected=new Set();
  for (const j of neighbors(idx,n)) if(next[j]===-c&&!inspected.has(j)) {
    const g=groupAt(next,n,j);
    for(const p of g.stones) inspected.add(p);
    if(g.liberties.length===0) {
      taken+=g.stones.length;lastCaptured=g.stones[0];
      for(const p of g.stones) next[p]=EMPTY;
    }
  }
  const mine=groupAt(next,n,idx);
  if(mine.liberties.length===0) return null; // suicide forbidden
  // Simple ko rule: one-stone capture and the placed stone has just one liberty.
  const ko=(taken===1&&mine.stones.length===1&&mine.liberties.length===1)?lastCaptured:-1;
  const cap={...s.captures}; cap[c===BLACK?'black':'white']+=taken;
  return {...s,board:next,turn:-c,ko,passes:0,captures:cap,
    moveNumber:s.moveNumber+1,lastMove:idx,
    moves:record?[...s.moves,{color:c,point:idx,captures:taken}]:s.moves};
}
export function passTurn(s, {record=true}={}) {
  if (s.result) return null;
  return {...s,turn:-s.turn,ko:-1,passes:s.passes+1,
    moveNumber:s.moveNumber+1,lastMove:null,
    moves:record?[...s.moves,{color:s.turn,pass:true}]:s.moves};
}
export function countTerritory(board,n) {
  const seen=new Uint8Array(n*n), regions=[], tally={black:0,white:0,neutral:0};
  for(let i=0;i<n*n;i++) if(board[i]===0&&!seen[i]) {
    const points=[], edge=new Set(), queue=[i]; seen[i]=1;
    for(let k=0;k<queue.length;k++) {
      const p=queue[k];points.push(p);
      for(const j of neighbors(p,n)) {
        if(board[j]===0&&!seen[j]) {seen[j]=1;queue.push(j);}
        else if(board[j]!==0) edge.add(board[j]);
      }
    }
    const owner=edge.size===1?[...edge][0]:0;
    if(owner===BLACK) tally.black+=points.length;
    else if(owner===WHITE) tally.white+=points.length;
    else tally.neutral+=points.length;
    regions.push({points,owner});
  }
  return {tally,regions};
}
/** Dead stones are virtually removed and credited as prisoners to the other player. */
export function scoreGame(s, dead=[]) {
  const b=s.board.slice(), deadSet=new Set(dead), removed={black:0,white:0};
  for(const i of deadSet) {
    if(!Number.isInteger(i)||i<0||i>=b.length) continue;
    if(b[i]===BLACK) removed.white++; else if(b[i]===WHITE) removed.black++;
    b[i]=EMPTY;
  }
  const {tally,regions}=countTerritory(b,s.size);
  const blackPrisoners=s.captures.black+removed.black;
  const whitePrisoners=s.captures.white+removed.white;
  const black=tally.black+blackPrisoners, white=tally.white+whitePrisoners+s.komi;
  return {black,white,blackTerritory:tally.black,whiteTerritory:tally.white,
    blackPrisoners,whitePrisoners,komi:s.komi,neutral:tally.neutral,
    winner:black>white?BLACK:white>black?WHITE:0,margin:Math.abs(black-white),regions};
}
export function toSGF(s) {
  const alphabet='abcdefghijklmnopqrstuvwxyz';
  const points=handicapPoints(s.size,s.handicap).map(i=>`[${alphabet[i%s.size]}${alphabet[Math.floor(i/s.size)]}]`).join('');
  const ab=points?`AB${points}`:'';
  const moves=s.moves.map(m=>` ;${m.color===BLACK?'B':'W'}[${m.pass?'':alphabet[m.point%s.size]+alphabet[Math.floor(m.point/s.size)]}]`).join('');
  const result=s.result?`RE[${s.result.winner===BLACK?'B':s.result.winner===WHITE?'W':'0'}+${s.result.reason==='resign'?'R':s.result.margin??'0'}]`:'';
  return `(;GM[1]FF[4]CA[UTF-8]AP[BaekhoBaduk:1.1]SZ[${s.size}]KM[${s.komi}]RU[Korean]HA[${s.handicap}]${ab}${result}${moves})`;
}
