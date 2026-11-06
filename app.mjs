import {BLACK,WHITE,labelColor,opponent,newGame,tryMove,passTurn,groupAt,starPoints,scoreGame,toSGF} from './go-core.mjs';
const $=id=>document.getElementById(id);
const screens=['home','setup','game','result'];
const SAVE_KEY='baekho-baduk-v1';
const DEFAULT={size:19,humanColor:BLACK,level:5,handicap:0};
let settings={...DEFAULT},game=null,history=[],mode='home',dead=new Set(),preview=null,
    waiting=false,worker=null,jobId=0,message='',savedScreen='game';
const fmt=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:1});

function loadData(){
  try{
    const settingsJSON=localStorage.getItem(SAVE_KEY+'-settings');
    if(settingsJSON)settings={...DEFAULT,...JSON.parse(settingsJSON)};
    const saved=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
    if(saved?.game && Array.isArray(saved.game.board) && saved.game.board.length===saved.game.size**2){
      game=saved.game;history=Array.isArray(saved.history)?saved.history:[];
      savedScreen=saved.mode==='score'?'score':'game';
      dead=new Set(saved.dead||[]);
    }
  }catch(e){console.warn('Saved data unavailable',e);}
  $('home-resume').hidden=!game||Boolean(game?.result);
}
function saveData(){
  try{
    localStorage.setItem(SAVE_KEY+'-settings',JSON.stringify(settings));
    if(game&&!game.result){localStorage.setItem(SAVE_KEY,JSON.stringify({game,history:history.slice(-16),mode,dead:[...dead]}));}
    else localStorage.removeItem(SAVE_KEY);
  }catch(e){console.warn('Local save failed',e);}
  $('home-resume').hidden=!game||Boolean(game?.result);
}
function screen(name){
  for(const s of screens){const el=$(s+'-screen');el.classList.toggle('active',s===name);}
  window.scrollTo(0,0);
}
function stopAI(){jobId++;waiting=false;if(worker){worker.terminate();worker=null;}}
function settingsFromUI(){
  settings.size=+document.querySelector('#board-size-options .selected').dataset.value;
  settings.humanColor=+document.querySelector('#color-options .selected').dataset.value;
  settings.level=+$('level-range').value;
  settings.handicap=+$('handicap-range').value;
}
function populateSettings(){
  document.querySelectorAll('#board-size-options button').forEach(b=>b.classList.toggle('selected',+b.dataset.value===settings.size));
  document.querySelectorAll('#color-options button').forEach(b=>b.classList.toggle('selected',+b.dataset.value===settings.humanColor));
  $('level-range').value=settings.level;$('handicap-range').value=settings.handicap;updateSetupLabels();
}
function updateSetupLabels(){
  const level=+$('level-range').value,handicap=+$('handicap-range').value;
  $('level-value').textContent=level;$('handicap-value').textContent=handicap;
  $('komi-note').textContent=handicap===0?'호선 · 흑 선착수 · 백 덤 6.5집':handicap===1?'1점(정선) · 접돌 배치 없음 · 백 덤 0.5집':`${handicap}점 접바둑 · 흑 접돌 ${handicap}개 · 백 선착수 · 백 덤 0.5집`;
  const note=level<=2?'입문용: 착수 선택에 변화를 주어 실수를 허용합니다.':level>=8?'강화 AI: 상대 응수와 일부 재응수를 탐색합니다. 전문 신경망 AI는 아닙니다.':'오프라인 전술 AI: 단수·따내기·연결을 고려합니다. 급수는 보장하지 않습니다.';
  $('level-note').textContent=note;
}
function start(){
  stopAI();settingsFromUI();game=newGame(settings);history=[];mode='game';dead.clear();preview=null;
  message='대국이 시작되었습니다. 즐겁게 한 수씩 두세요!';saveData();showGame();
}
function showGame(){screen('game');render();if(mode!=='score'&&!game.result&&game.turn!==game.humanColor)queueAI();}
function enterScore(){stopAI();mode='score';preview=null;dead.clear();message='사석을 선택한 후 계가를 확정하세요.';saveData();render();}
function doMove(idx){
  if(!game||mode!=='game'||waiting||game.turn!==game.humanColor)return;
  const next=tryMove(game,idx);
  if(!next){message='이곳은 착수할 수 없습니다. 다른 곳을 선택해 주세요.';render();return;}
  history.push(game);game=next;preview=null;message='AI가 다음 수를 생각합니다.';saveData();render();queueAI();
}
function choosePass(){
  if(!game||mode!=='game'||waiting||game.turn!==game.humanColor)return;
  history.push(game);game=passTurn(game);preview=null;
  if(game.passes>=2){enterScore();return;}
  message='패스했습니다. AI 차례입니다.';saveData();render();queueAI();
}
function queueAI(){
  if(!game||mode!=='game'||game.turn===game.humanColor||waiting)return;
  waiting=true;message='백호 AI가 다음 수를 생각 중이에요…';render();
  const id=++jobId;
  try{
    worker=new Worker('./ai-worker.mjs',{type:'module'});
    worker.onmessage=ev=>{if(ev.data.id!==jobId||id!==jobId)return;const {move,error}=ev.data;stopAI();
      if(error){message='AI 오류: '+error;render();return;}
      if(!game||mode!=='game')return;
      history.push(game);
      if(move?.pass){game=passTurn(game);message='AI가 패스했습니다.';}
      else {const next=tryMove(game,move.point);if(!next){history.pop();message='AI 착수에 문제가 발생했습니다.';render();return;}
        game=next;const searchInfo=move?.searched?` · 전술 탐색 ${move.searched}개 후보`:'';message=`AI가 ${pointName(move.point)}에 두었습니다. (${move?.elapsedMs??'?'}ms${searchInfo})`;}
      if(game.passes>=2){enterScore();return;}
      saveData();render();
    };
    worker.onerror=async ev=>{
      if(id!==jobId)return;stopAI();console.error('AI worker error',ev);
      message='AI 작업을 시작할 수 없습니다. 브라우저 서버(HTTPS)에서 실행 중인지 확인하세요.';render();
    };
    worker.postMessage({id,state:game,level:game.level});
  }catch(e){stopAI();message='이 환경에서는 AI Worker를 실행할 수 없습니다.';render();}
}
function undo(){
  if(!game||mode!=='game'||!history.length)return;
  stopAI();let restored=history.pop();
  // If an AI reply was just played, take back the user's previous move too.
  if(restored.turn!==game.humanColor&&history.length)restored=history.pop();
  game=restored;preview=null;message='이전 수로 되돌렸습니다.';saveData();render();
  if(game.turn!==game.humanColor)queueAI();
}
function resign(){
  if(!game||mode!=='game'||!window.confirm('정말 기권하시겠습니까?'))return;
  stopAI();game.result={winner:-game.humanColor,reason:'resign',margin:0};mode='result';saveData();showResult();
}
function onBoardTap(ev){
  if(!game)return;
  const svg=$('go-board'),pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;
  const ctm=svg.getScreenCTM();if(!ctm)return;
  const local=pt.matrixTransform(ctm.inverse());
  const n=game.size, step=674/(n-1), x=Math.round((local.x-43)/step),y=Math.round((local.y-43)/step);
  if(x<0||x>=n||y<0||y>=n)return;
  const idx=y*n+x;
  if(mode==='score') {
    if(!game.board[idx])return;
    const group=groupAt(game.board,n,idx).stones;
    const isDead=group.every(p=>dead.has(p));
    for(const p of group)if(isDead)dead.delete(p);else dead.add(p);
    saveData();render();return;
  }
  if(mode!=='game'||waiting||game.turn!==game.humanColor)return;
  if(game.board[idx]){message='이미 돌이 놓인 자리입니다.';render();return;}
  if(n!==19){doMove(idx);return;}
  preview=idx;message='착수 위치를 확인해 주세요.';render();
}
function pointName(idx){
  const n=game.size,x=idx%n,y=(idx/n)|0;
  const col='ABCDEFGHJKLMNOPQRST'.slice(0,n);
  return `${col[x]}${n-y}`;
}
function svgNode(tag,attrs={},parent=$('go-board')){
  const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));
  parent.appendChild(e);return e;
}
function renderBoard(){
  if(!game)return;
  const svg=$('go-board'),n=game.size,step=674/(n-1);svg.replaceChildren();
  const defs=svgNode('defs');
  let grad=svgNode('radialGradient',{id:'blackGradient',cx:'30%',cy:'22%',r:'75%'},defs);
  svgNode('stop',{offset:'0%', 'stop-color':'#67706a'},grad);svgNode('stop',{offset:'38%', 'stop-color':'#303b36'},grad);svgNode('stop',{offset:'100%','stop-color':'#0d1713'},grad);
  grad=svgNode('radialGradient',{id:'whiteGradient',cx:'25%',cy:'18%',r:'80%'},defs);
  svgNode('stop',{offset:'0%','stop-color':'#fff'},grad);svgNode('stop',{offset:'65%','stop-color':'#f5f4eb'},grad);svgNode('stop',{offset:'100%','stop-color':'#c3bfb0'},grad);
  for(let i=0;i<n;i++){
    const p=43+i*step;
    svgNode('line',{x1:43,y1:p,x2:717,y2:p,stroke:'#755b39','stroke-width':n===19?1.5:1.8,opacity:'.85'});
    svgNode('line',{x1:p,y1:43,x2:p,y2:717,stroke:'#755b39','stroke-width':n===19?1.5:1.8,opacity:'.85'});
  }
  for(const [x,y] of starPoints(n))svgNode('circle',{cx:43+x*step,cy:43+y*step,r:n===19?4.6:5.3,fill:'#755836'});
  const letters='ABCDEFGHJKLMNOPQRST';
  for(let i=0;i<n;i++) {
    const p=43+i*step;
    const lab=svgNode('text',{x:p,y:25,'text-anchor':'middle','font-size':n===19?15:18,fill:'#8f663a','font-weight':'600'});lab.textContent=letters[i];
    const num=svgNode('text',{x:25,y:p+5,'text-anchor':'middle','font-size':n===19?15:18,fill:'#8f663a','font-weight':'600'});num.textContent=n-i;
  }
  const rad=step*.455;
  for(let i=0;i<n*n;i++)if(game.board[i]){
    const cx=43+(i%n)*step,cy=43+Math.floor(i/n)*step,c=game.board[i];
    const isDead=mode==='score'&&dead.has(i);
    svgNode('circle',{cx:cx+1.1,cy:cy+2.3,r:rad+0.1,fill:'#4a2e15',opacity:'.26'});
    svgNode('circle',{cx,cy,r:rad,fill:c===BLACK?'url(#blackGradient)':'url(#whiteGradient)',stroke:c===BLACK?'#0a1b13':'#b4a993','stroke-width':1.2,opacity:isDead?'.48':1});
    if(isDead){svgNode('path',{d:`M ${cx-rad*.55} ${cy-rad*.55} L ${cx+rad*.55} ${cy+rad*.55} M ${cx+rad*.55} ${cy-rad*.55} L ${cx-rad*.55} ${cy+rad*.55}`,stroke:'#c54743','stroke-width':Math.max(3,step*.11),'stroke-linecap':'round'});}
  }
  if(mode==='game'&&game.lastMove!==null){
    const i=game.lastMove,c=game.board[i],cx=43+(i%n)*step,cy=43+Math.floor(i/n)*step;
    svgNode('circle',{cx,cy,r:Math.max(4,rad*.29),fill:'none',stroke:c===BLACK?'#fcf3d0':'#a34d32','stroke-width':Math.max(2,rad*.11)});
  }
  if(mode==='game'&&preview!==null&&!game.board[preview]){
    const cx=43+(preview%n)*step,cy=43+Math.floor(preview/n)*step;
    svgNode('circle',{cx,cy,r:rad,fill:game.turn===BLACK?'#182a22':'#fff',opacity:'.52',stroke:'#296a48','stroke-width':3});
    svgNode('circle',{cx,cy,r:rad+8,fill:'none',stroke:'#39734b','stroke-width':3,'stroke-dasharray':'7,6'});
  }
}
function render(){
  if(!game)return;
  $('game-metadata').textContent=`${game.size}줄 · AI ${game.level}단계 · ${game.handicap===0?'호선':game.handicap+'점'}`;
  const aiName=c=>c===game.humanColor?'나':'AI 백호';
  $('top-player-name').textContent=`백 · ${aiName(WHITE)}`;
  $('bottom-player-name').textContent=`흑 · ${aiName(BLACK)}`;
  $('top-player-captures').textContent=`잡은 돌 ${game.captures.white}개 · 덤 ${fmt(game.komi)}집`;
  $('bottom-player-captures').textContent=`잡은 돌 ${game.captures.black}개`;
  $('top-turn-dot').classList.toggle('on',mode==='game'&&game.turn===WHITE);
  $('bottom-turn-dot').classList.toggle('on',mode==='game'&&game.turn===BLACK);
  $('game-message').textContent=message;
  $('confirm-row').hidden=mode!=='game'||preview===null;
  if(preview!==null)$('preview-coordinate').textContent=pointName(preview)+' 선택';
  $('scoring-tools').hidden=mode!=='score';$('game-actions').hidden=mode==='score';
  $('tap-tip').hidden=mode==='score';
  $('tap-tip').textContent=game.size===19?'19줄 바둑판에서는 위치를 선택한 다음 착수를 확인합니다.':'바둑판의 교차점을 터치하면 바로 착수합니다.';
  $('undo-move').disabled=!history.length;
  $('pass-move').disabled=waiting||game.turn!==game.humanColor;
  $('resign-move').disabled=waiting;
  renderBoard();
  if(mode==='score')updateScorePreview();
}
function updateScorePreview(){
  const s=scoreGame(game,[...dead]);
  $('score-preview').innerHTML=`흑 <b>${fmt(s.black)}집</b> (집 ${s.blackTerritory} + 사석 ${s.blackPrisoners})<br>백 <b>${fmt(s.white)}집</b> (집 ${s.whiteTerritory} + 사석 ${s.whitePrisoners} + 덤 ${fmt(s.komi)})<br>공배 ${s.neutral}칸 · ${s.winner?`${labelColor(s.winner)} ${fmt(s.margin)}집 우세`:'동점'}`;
}
function resumePlay(){mode='game';dead.clear();game={...game,passes:0};message='대국을 계속합니다.';saveData();render();if(game.turn!==game.humanColor)queueAI();}
function finishScore(){
  if(mode!=='score')return;
  const s=scoreGame(game,[...dead]);game.result={winner:s.winner,margin:s.margin,reason:'points',score:s,dead:[...dead]};
  mode='result';saveData();showResult();
}
function showResult(){
  if(!game?.result)return;
  screen('result');const r=game.result;
  $('result-label').textContent=r.winner===game.humanColor?'축하합니다!':'함께해 주셔서 고마워요!';
  $('result-main').textContent=r.reason==='resign'?`${labelColor(r.winner)} 불계승`:r.winner?`${labelColor(r.winner)} ${fmt(r.margin)}집 승`:'무승부';
  $('result-sub').textContent=r.reason==='resign'?'기권으로 대국이 종료되었습니다.':'한국식 계가 · 집 + 잡은 돌';
  const lines=r.score?[
    ['흑 집',fmt(r.score.blackTerritory)+'집'],['흑 잡은 돌',fmt(r.score.blackPrisoners)+'개'],
    ['백 집',fmt(r.score.whiteTerritory)+'집'],['백 잡은 돌',fmt(r.score.whitePrisoners)+'개'],
    ['백 덤',fmt(r.score.komi)+'집'],['흑 최종',fmt(r.score.black)+'집'],['백 최종',fmt(r.score.white)+'집']
  ]:[['승리',labelColor(r.winner)],['종료 사유','기권']];
  $('score-table').replaceChildren();
  for(const [a,b] of lines){const line=document.createElement('div'),left=document.createElement('span'),right=document.createElement('strong');left.textContent=a;right.textContent=b;line.append(left,right);$('score-table').append(line);}
}
async function exportSGF(){
  if(!game)return;
  const sgf=toSGF(game),filename=`baekho-${game.size}x${game.size}-${new Date().toISOString().slice(0,10)}.sgf`,file=new File([sgf],filename,{type:'application/x-go-sgf'});
  try{if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({files:[file],title:'아기 백호 바둑 기보'});return;}}
  catch(e){if(e?.name==='AbortError')return;}
  const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function initEvents(){
  $('home-new').onclick=()=>{populateSettings();screen('setup');};
  $('home-resume').onclick=()=>{if(game){mode=savedScreen;message='이어하기로 돌아왔습니다.';showGame();}};
  $('setup-back').onclick=()=>screen('home');
  $('start-game').onclick=start;
  for(const id of ['board-size-options','color-options'])$(id).onclick=e=>{
    const b=e.target.closest('button[data-value]');if(!b)return;
    for(const child of $(id).querySelectorAll('button'))child.classList.toggle('selected',child===b);
  };
  $('level-range').oninput=updateSetupLabels;$('handicap-range').oninput=updateSetupLabels;
  $('game-home').onclick=()=>{stopAI();savedScreen=mode;saveData();screen('home');};
  $('go-board').addEventListener('click',onBoardTap);
  $('confirm-move').onclick=()=>{if(preview!==null)doMove(preview);};
  $('cancel-preview').onclick=()=>{preview=null;message='다른 위치를 골라 주세요.';render();};
  $('undo-move').onclick=undo;$('pass-move').onclick=choosePass;$('resign-move').onclick=resign;
  $('save-sgf').onclick=exportSGF;$('resume-play').onclick=resumePlay;$('finish-score').onclick=finishScore;
  $('result-back').onclick=$('result-home').onclick=()=>screen('home');
  $('result-rematch').onclick=()=>{settings={size:game.size,handicap:game.handicap,humanColor:game.humanColor,level:game.level};populateSettings();start();};
  $('result-export').onclick=exportSGF;
  const guide=$('guide-dialog');
  $('home-guide').onclick=()=>guide.showModal();
  $('guide-close').onclick=$('guide-ok').onclick=()=>guide.close();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveData();});
}
loadData();initEvents();populateSettings();screen('home');
if('serviceWorker' in navigator && ['http:','https:'].includes(location.protocol)){
  navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Offline installation unavailable',e));
}
