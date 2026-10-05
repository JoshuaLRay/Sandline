/** Served by the intake host so OAuth cookies and native audio remain first-party. */
export const REVIEW_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voice recordings · Sandline</title><link rel="stylesheet" href="/voice-review/style.css">
<script src="/voice-review/app.js" defer></script></head><body><main>
<header><p class="eyebrow">SANDLINE / VOICE CONTRIBUTIONS</p><h1>Saved voice recordings</h1>
<p>Listen to contributor recordings before choosing which voices to bring into the game.</p></header>
<nav><a id="login" class="button" href="/voice-review/login">Sign in with GitHub</a>
<button id="refresh" hidden>Refresh recordings</button><button id="logout" hidden>Sign out</button></nav>
<p id="status" role="status" aria-live="polite">Loading recordings…</p>
<section id="submissions" aria-label="Voice submissions"></section>
<nav id="pagination" hidden aria-label="Submission pages"><button id="previous">Previous</button><span id="page"></span><button id="next">Next</button></nav>
<footer>Private owner review. Listening here does not publish a recording or add it to the game.</footer>
</main></body></html>`;

export const REVIEW_STYLE = `
:root{color-scheme:dark;font:16px/1.6 system-ui,sans-serif;background:#101820;color:#f4eee0}
*{box-sizing:border-box}body{margin:0}main{max-width:900px;margin:auto;padding:40px 24px}
header{border-bottom:1px solid #40525b;margin-bottom:24px;padding-bottom:20px}h1{font-size:clamp(1.8rem,5vw,2.6rem);line-height:1.2;margin:.4rem 0 1rem}
.eyebrow{font-size:.75rem;letter-spacing:.16em;color:#b5c6cd}nav{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0}
button,.button{font:inherit;background:#d7b67b;color:#101820;border:0;border-radius:5px;padding:10px 16px;text-decoration:none;cursor:pointer}
button:disabled{opacity:.45;cursor:default}[hidden]{display:none!important}a{color:#e4c992}a:focus-visible,button:focus-visible{outline:3px solid #f4eee0;outline-offset:4px}
article{padding:22px;margin:20px 0;background:#203039;border:1px solid #40525b;border-radius:8px}h2{margin:0 0 6px;font-size:1.3rem}
.meta{color:#becdd3;margin:0 0 14px}.id{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;color:#b5c6cd}
.clip{border-top:1px solid #40525b;padding-top:14px;margin-top:14px}.clip h3{margin:0 0 8px;font-size:1rem}audio{display:block;width:100%;margin:8px 0}
.error{color:#ffc9aa}footer{color:#b5c6cd;margin-top:32px;font-size:.9rem}#page{flex:1;text-align:center}
`;

export const REVIEW_SCRIPT = `
const login=document.querySelector('#login'),refresh=document.querySelector('#refresh'),logout=document.querySelector('#logout');
const status=document.querySelector('#status'),list=document.querySelector('#submissions'),pagination=document.querySelector('#pagination');
let offset=0,loading=false;
const error=new URLSearchParams(location.search).get('error');
if(error)history.replaceState(null,'','/voice-review');
function element(tag,parent,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;parent.append(el);return el;}
function clear(){for(const audio of list.querySelectorAll('audio')){audio.pause();audio.removeAttribute('src');audio.load();}list.replaceChildren();pagination.hidden=true;}
function signedIn(value){login.hidden=value;refresh.hidden=!value;logout.hidden=!value;}
async function load(){
 if(loading)return;loading=true;refresh.disabled=true;logout.disabled=true;document.querySelector('#previous').disabled=true;document.querySelector('#next').disabled=true;clear();status.textContent='Loading recordings…';
 try{
  const res=await fetch('/voice-review/submissions?offset='+offset,{cache:'no-store'});
  if(res.status===401){signedIn(false);status.textContent=error==='owner'?'This page is restricted to the JoshuaLRay GitHub account.':error==='login'?'GitHub sign-in did not complete. Please try again.':'Sign in as JoshuaLRay to listen to saved recordings.';return;}
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Could not load recordings.');
  signedIn(true);
  if(offset>=data.total&&offset>0){offset=Math.max(0,Math.floor((data.total-1)/50)*50);loading=false;return load();}
  status.textContent=data.total===0?'No voice submissions have been saved yet.':data.total+' saved submission'+(data.total===1?'':'s')+'.';
  for(const submission of data.submissions){
   const card=element('article',list);element('h2',card,submission.name);
   const date=new Date(submission.agreedAt);element('p',card,(submission.complete?'Finished':'In progress')+' · '+(Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleString())+' · '+submission.clips.length+' sections').className='meta';
   element('p',card,'Submission '+submission.id).className='id';
   if(!submission.clips.length)element('p',card,'No sections uploaded yet.');
   for(const clip of submission.clips){
    const row=element('div',card);row.className='clip';element('h3',row,clip.pass.split('-').join(' '));
    const url='/voice-review/clips/'+submission.id+'/'+clip.pass;
    const audio=element('audio',row);audio.controls=true;audio.preload='none';audio.src=url;audio.setAttribute('aria-label',submission.name+' — '+clip.pass);
    audio.addEventListener('play',()=>{for(const other of list.querySelectorAll('audio'))if(other!==audio)other.pause();});
    const fallback=element('p',row);fallback.hidden=true;fallback.className='error';
    audio.addEventListener('error',()=>{fallback.hidden=false;fallback.textContent='Playback failed. Your session may have expired, or this browser may not support this recording. Sign in again or download the clip.';});
    const download=element('a',row,'Download recording');download.href=url;download.download=clip.pass+'.'+({'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg','audio/wav':'wav','audio/x-wav':'wav'}[clip.type]||'audio');
    element('span',row,' · '+Math.ceil(clip.bytes/1024)+' KB');
   }
  }
  pagination.hidden=data.total<=50;document.querySelector('#previous').disabled=offset===0;document.querySelector('#next').disabled=offset+50>=data.total;
  document.querySelector('#page').textContent='Page '+(Math.floor(offset/50)+1)+' of '+Math.ceil(data.total/50);
 }catch(e){status.textContent=e.message;}
 finally{loading=false;refresh.disabled=false;logout.disabled=false;}
}
refresh.onclick=()=>load();document.querySelector('#previous').onclick=()=>{offset=Math.max(0,offset-50);load();};document.querySelector('#next').onclick=()=>{offset+=50;load();};
logout.onclick=async()=>{logout.disabled=true;refresh.disabled=true;clear();try{const res=await fetch('/voice-review/logout',{method:'POST'});if(!res.ok)throw new Error('Could not sign out. Try again.');signedIn(false);status.textContent='Signed out. Sign in as JoshuaLRay to review recordings.';}catch(e){status.textContent=e.message;}finally{logout.disabled=false;refresh.disabled=false;}};
load();
`;

export const REVIEW_UNAVAILABLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voice review · Sandline</title></head><body><h1>Owner voice review is not configured yet</h1><p>Recordings remain private and contributions can still be uploaded. Configure the GitHub OAuth credentials and review origin on the intake host to enable owner playback.</p></body></html>`;
