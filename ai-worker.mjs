import {pickMove} from './ai.mjs';
self.onmessage=(ev)=> {
  const {id,state,level}=ev.data;
  try {const move=pickMove(state,level);self.postMessage({id,move});}
  catch(e) {self.postMessage({id,error:e?.message||String(e)});}
};
