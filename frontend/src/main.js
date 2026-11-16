import { createDrawingState, drawingSaveErrorMessage } from './drawing-state.js';
import './style.css';
import { api, setUserKeys, clearUserKeys, keyStatus } from './api.js';
import { drawingBoardMarkup, createDrawingBoard } from './drawing-board.js';
import { quickReplies, drawingReplyFlags, BINGO_TEXT, DAILY_LIMIT_TEXT } from './quick-replies.js';
import { SpeechPlayer, WELCOME_TEXT } from './speech.js';
import { installSpeechMouth } from './speech-mouth.js';
import { normalizeEmotion } from './emotions.js';
import { BackgroundMusic } from './background-music.js';
import { stageBackground } from './stage-background.js';
import { createExpressionAnimation } from './expression-animation.js';
import { headActions, headActionPose } from './head-actions.js';
import { grassActionPose } from './grass-action.js';
import { createIdleLook } from './idle-look.js';
import { createPropEffects } from './prop-effects.js';
import { createAccessoryState } from './accessory-state.js';
import { createAppearanceTransition } from './appearance-transition.js';
import { createEyeLocator, gazeTarget } from './gaze.js';
import { hitsModel, tapRegion, tapPose } from './interaction.js';
import * as PIXI from 'pixi.js';
import { modelProfile } from './model-profile.js';
import { PencilLine, Trash2, LoaderCircle } from 'lucide';
import { createIcons, ArrowUpRight, Send, Volume2, VolumeX, Settings2, Download, Eraser, RotateCcw, Maximize, Minimize, Plus, Minus, X, Sparkles, Mic, MessageCircle, SlidersHorizontal, Check, ChevronRight, Smile, Heart, Frown, CircleHelp, Laugh, Cloud, Ellipsis, Hand, Pointer, Wheat, UserRound, Glasses, Circle, ArrowDownRight, CookingPot, Droplets, Annoyed } from 'lucide';

const iconSet = { ArrowUpRight, Send, Volume2, VolumeX, Settings2, Download, Eraser, RotateCcw, Maximize, Minimize, Plus, Minus, X, Sparkles, Mic, MessageCircle, SlidersHorizontal, Check, ChevronRight, Smile, Heart, Frown, CircleHelp, Laugh, Cloud, Ellipsis, Hand, Pointer, Wheat, UserRound, Glasses, Circle, ArrowDownRight, CookingPot, Droplets, Annoyed };
iconSet.PencilLine=PencilLine;
iconSet.Trash2=Trash2;
iconSet.LoaderCircle=LoaderCircle;
const icons = () => createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.6, 'aria-hidden': 'true', focusable: 'false' } });
const facePaths={
  goofy:'<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1.8"/><circle cx="16" cy="9" r="1.8"/><path d="M6 14q6 7 12 0H6Zm4 0v3h4v-3m-2 0v3"/>',
  worried:'<circle cx="12" cy="12" r="9"/><path d="m6 9 3-1m6 0 3 1M8 11h.01M16 11h.01m-7 6q3-3 6 0"/>',
  flower:'<path d="M12 8C5-2 0 9 8 12C-2 19 9 24 12 16C19 26 24 15 16 12C26 5 15 0 12 8Z"/><circle cx="12" cy="12" r="3"/>',
  tilt:'<path d="m7 4 11 4-5 14L2 18Z M7 10h.01M13 12h.01m-6 3 4 1M18 3q5 3 3 8m-3-2 3 2 2-3"/>',
  nod:'<path d="m16 4 3-3 3 3m-3-3v12m-3-3 3 3 3-3"/><circle cx="9" cy="15" r="7"/><path d="M6 13h.01M12 13h.01m-6 4q3 2 6 0"/>',
  shake:'<path d="m4 2-3 3 3 3M1 5h22m-3-3 3 3-3 3"/><circle cx="12" cy="17" r="6"/><path d="M9 16h.01M15 16h.01m-5 4h4"/>',
  startled:'<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9" r="1"/><circle cx="15.5" cy="9" r="1"/><ellipse cx="12" cy="15" rx="2" ry="2.5"/>',
  sadness:'<circle cx="12" cy="12" r="9"/><path d="m6 8 3-1m6 0 3 1M8 10v1m8-1v1m-6 5q2-2 4 0"/>',
  'curious':'<circle cx="12" cy="12" r="9"/><path d="M8 8v2m8-2v2M7 13h10a5 5 0 0 1-10 0Z"/>',
  playful:'<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M7 13h10M10 13v3a2 2 0 0 0 4 0v-3M12 14v2"/>',
  blush:'<circle cx="12" cy="12" r="9"/><path d="m7 9 2 1m8-1-2 1m-6 5q3 2 6 0M6 12v1m2-1v1m8-1v1m2-1v1"/>',
  angry:'<path d="M5 9a7 7 0 0 1 14 0c4 1 3 7 0 8a8 8 0 0 1-14 0c-3-1-4-7 0-8Z M8 9h.01M16 9h.01M10 14h4"/>',
};
const i = name => facePaths[name]?`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${facePaths[name]}</svg>`:`<i data-lucide="${name}"></i>`;
const $ = s => document.querySelector(s);
const avatar = '/model/大肥鱼.png';
let settings = { voice: true, follow: true, volume: .7, body: 0, bgm: true, bgmVolume: .18 };
let affection = 60;
let affectionFlashPending=false, affectionAnimation;
let messages = [];
let pendingGameCompletion=null;
try { settings = { ...settings, ...JSON.parse(localStorage.getItem('whale-settings') || '{}') }; messages = JSON.parse(localStorage.getItem('whale-messages') || '[]'); } catch { /* New session when storage is unavailable. */ }
try { const storedAffection=localStorage.getItem('whale-affection'); affection = storedAffection===null?60:Math.max(0,Math.min(300,Number(storedAffection)||0)); } catch { /* Affection starts at 60 if storage is unavailable. */ }
// Each page starts with voice enabled and the standard body, even with old settings.
settings.body = 0;
settings.voice = true;
if (!Array.isArray(messages)) messages = [];
messages = messages.filter(m => ['user','assistant'].includes(m.role) && typeof m.text === 'string').slice(-100).map(m=>m.role==='assistant'?{...m,emotion:normalizeEmotion(m.emotion)}:m);
if (!messages.length) messages = [{ role: 'assistant', text: WELCOME_TEXT, emotion: 'neutral' }];
let busy = false, waitingReply = false, currentExpression = 'neutral', model, pixi, zoom = 1, offset = {x:0,y:0}, speaking = false;
let backend = null, serviceReady = false, retryTurn = null;
const bgm = new BackgroundMusic({ enabled: settings.bgm, volume: settings.bgmVolume });
const speech = new SpeechPlayer({ onSpeaking: value => { speaking = value; bgm.setSpeaking(value); }, onError: text => toast(text), onContext: context => bgm.connectContext(context) });
let welcomePending=true;
function tryPlayWelcome() {
  if(!welcomePending || !serviceReady || !model)return;
  const welcome=messages.length===1&&messages[0].role==='assistant'&&messages[0].text===WELCOME_TEXT?messages[0]:null;
  if(!settings.voice || !welcome){welcomePending=false;return;}
  // Wait for actual BGM playback, session/cache access, and the lip-sync model.
  if(!settings.bgm || bgm.audio.paused || bgm.audio.readyState<3 || bgm.volume<=0 || busy || speaking)return;
  welcomePending=false;
  speech.unlock();
  void speak(welcome);
}
let actionUntil = 0, actionTimer, activeAction = null, heldAction = null, actionRevision=0, actionFinishListener;
let actionStarted = 0, grassSwayStarted = -Infinity, grassSwayBase = null;
let waveAtChest = false;
const idleLook=createIdleLook();
let idleSurprise=false, idleLean=false;
const idleEvents=new AbortController();
const resetIdleLook=()=>{idleLook.reset();syncIdleSurprise(false);};
function syncIdleSurprise(enabled, lean=false) {
  if(idleSurprise===enabled&&idleLean===lean)return;
  idleSurprise=enabled;idleLean=lean;
  // A transient layer: never change held actions or the user's prop selection.
  syncAppearance(false);
  $('#mood').textContent=enabled?'惊讶':expressions.find(([key])=>key===currentExpression)?.[2]||'平静';
}
for(const event of ['pointerdown','pointerup','pointercancel','click','wheel','keydown','input','scroll']){
  window.addEventListener(event,resetIdleLook,{capture:true,passive:true,signal:idleEvents.signal});
}
document.addEventListener('visibilitychange',resetIdleLook,{signal:idleEvents.signal});
window.addEventListener('pageshow',resetIdleLook,{signal:idleEvents.signal});
window.addEventListener('focus',resetIdleLook,{signal:idleEvents.signal});
const appearanceTransition=createAppearanceTransition(320);
let appearance={}, switchStarted=-Infinity;
let gazePointer = null;
let locateInteractionEyes, tapReaction=null, tapRestoreTimer, lastTap=-Infinity, expressionRevision=0;
function reactToTap(point, keyboard=false) {
  if(!model || performance.now()-lastTap<650)return;
  if(!keyboard && !hitsModel(model,new PIXI.Point(point.x,point.y)))return;
  const eyes=locateInteractionEyes?.();
  const region=keyboard?'head':tapRegion(point,eyes);
  const previous=tapReaction?.previous??currentExpression;
  clearTimeout(tapRestoreTimer);
  lastTap=performance.now();
  tapReaction={region,started:lastTap,side:eyes&&point.x<eyes.x?-1:1,previous};
  const expression=region==='face'?'curious':'smile';
  setExpression(expression);
  const revision=expressionRevision;
  tapRestoreTimer=setTimeout(()=>{tapReaction=null;if(expressionRevision===revision)setExpression(previous);},1900);
  if(!keyboard){const ripple=document.createElement('span');ripple.className='tap-ripple';ripple.style.left=`${point.x}px`;ripple.style.top=`${point.y}px`;host.append(ripple);setTimeout(()=>ripple.remove(),500);}
}
function syncActions() {
  document.querySelectorAll('[data-motion]').forEach(button=>{
    const selected=heldAction===button.dataset.motion;
    button.classList.toggle('selected',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
}
function playAction(group, hold=false) {
  if (!model) return toast('模型尚未加载完成');
  // Once the hand reaches the chest, cancel through the authored return clip.
  // Fading its layer switch directly to zero skips the matching hand poses.
  const returningWave=group==='Rest' && activeAction==='Wave' && waveAtChest;
  waveAtChest=false;
  clearTimeout(actionTimer);grassSwayStarted=-Infinity;grassSwayBase=null;
  const manager=model.internalModel.motionManager;
  if(actionFinishListener)manager.off('motionFinish',actionFinishListener);
  actionFinishListener=null;
  const revision=++actionRevision;
  manager.stopAllMotions();
  heldAction=hold && group!=='Rest'?group:null;
  activeAction=returningWave?'Wave':group==='Rest'?null:group;
  actionStarted=performance.now();
  actionUntil=activeAction?Infinity:0;
  syncActions();
  if(group==='Rest'&&!returningWave)return;
  const finish=()=>{
    if(revision!==actionRevision)return;
    actionUntil=0;activeAction=null;heldAction=null;waveAtChest=false;syncActions();
  };
  if(group==='Lean' || headActions.has(group)){
    if(!hold)actionTimer=setTimeout(finish,group==='Nod'?1600:1800);
    return;
  }
  const returns={Wave:'Rest',Point:'RestPoint',Grass:'RestGrass'};
  const start=async(name,onFinish)=>{
    try {
      // Resolve the resource before starting so a cancelled first load cannot
      // start an obsolete animation after the user has selected another card.
      // Preload the return, including held chest poses that the user can cancel.
      const [motion]=await Promise.all([
        manager.loadMotion(name,0),
        name==='Wave'||(!hold&&['Point','Grass'].includes(name))?manager.loadMotion(returns[name],0):Promise.resolve(),
      ]);
      if(revision!==actionRevision)return;
      if(!motion)throw new Error('Motion unavailable');
      if(['Wave','Rest','Point','RestPoint','Grass','RestGrass'].includes(name)){
        // These short clips contain their own easing and hand-layer switch.
        // A long engine fade delays that switch and leaves a partial end pose.
        motion.setFadeInTime(.12);
        motion.setFadeOutTime(0);
      }
      if(name==='Rest')waveAtChest=false;
      if(name==='RestGrass')grassSwayStarted=-Infinity;
      const started=await model.motion(name,0,3,{loop:false});
      if(revision!==actionRevision)return;
      if(!started){finish();toast('动作未能播放，请重试');return;}
      if(name==='Grass'){
        // Overlap the entrance's last 200ms instead of waiting one more
        // frame for motionFinish before beginning the wrist movement.
        grassSwayStarted=performance.now()+Math.max(0,motion.getDuration()*1000-200);
        grassSwayBase=null;
      }
      actionFinishListener=()=>{
        actionFinishListener=null;
        if(revision===actionRevision)onFinish();
      };
      manager.once('motionFinish',actionFinishListener);
    } catch {
      if(revision===actionRevision){finish();toast('动作加载失败，请重试');}
    }
  };
  start(returningWave?'Rest':group,returningWave?finish:()=>{
    // Keep the final hand parameters saved by the motion. The reset layer
    // excludes the selected hand until the user cancels or switches cards.
    if(group==='Wave')waveAtChest=true;
    if(hold)return;
    actionTimer=setTimeout(()=>start(returns[group]||'Rest',finish),group==='Grass'?Math.max(0,2800-(performance.now()-grassSwayStarted)):500);
  });
}
const save = () => { try { localStorage.setItem('whale-settings',JSON.stringify(settings)); if(!backend){localStorage.setItem('whale-messages',JSON.stringify(messages.slice(-100)));localStorage.setItem('whale-affection',String(affection));} } catch {} };

$('#app').innerHTML = `
<main class="room">
  <section class="stage" aria-label="Live2D 角色舞台">
    ${stageBackground()}
    <header class="brand"><img class="brand-mark" src="/favicon.svg" alt="" width="43" height="43"><div><span class="brand-title">鲸语</span></div></header>
    <div class="character-label"><span class="status-dot"></span><span id="mood">平静</span></div>
    <div id="canvas-wrap" tabindex="0" role="button" aria-label="角色互动，点击触发表情和动作，拖动调整位置"></div>
    <div id="loading" class="loading"><span class="loading-ring"></span><p>模型加载中…</p><small>正在加载模型资源</small></div>

    <div class="stage-bottom"><button class="glass-button" id="reset-view">${i('rotate-ccw')}<span>复位视角</span></button><div class="zoom-controls"><button id="zoom-out" title="缩小" aria-label="缩小">${i('minus')}</button><span id="zoom-label">100%</span><button id="zoom-in" title="放大" aria-label="放大">${i('plus')}</button><button id="fullscreen" title="全屏" aria-label="全屏">${i('maximize')}</button></div></div>
  </section>
  <aside class="panel" aria-label="角色互动面板">
    <div class="panel-header"><div class="tabs" role="tablist"><button class="tab active" id="chat-tab" role="tab" aria-selected="true" aria-controls="chat-view">${i('message-circle')}对话</button><button class="tab" id="actions-tab" role="tab" aria-selected="false" aria-controls="actions-view">${i('sliders-horizontal')}操作</button></div><button id="reconnect" class="glass-button" type="button" hidden>重新连接</button></div>
    <section id="chat-view" class="tab-view" role="tabpanel" aria-labelledby="chat-tab">
      <div class="chat-tools"><span id="count">新的相遇</span><button class="affection-badge" id="affection-badge" aria-label="查看好感度" aria-haspopup="dialog">${i('heart')}<span id="affection-value">60</span></button><div><button id="export" title="导出对话" aria-label="导出对话">${i('download')}</button><button id="clear" title="清空对话" aria-label="清空对话">${i('trash-2')}</button><button id="settings" title="对话设置" aria-label="对话设置">${i('settings-2')}</button></div></div>
      <div class="messages" id="messages" role="log" aria-live="polite"></div>
      <div class="suggestions" id="suggestions"><button>你真可爱</button><button>今天有点累</button><button>我有一个好点子</button><button>没token了怎么办</button><button>来玩你画我猜吧</button></div>
      <form id="chat-form" class="composer"><button id="drawing-toggle" class="drawing-toggle" type="button" aria-label="打开画板" title="打开画板" aria-expanded="false" aria-controls="drawing-view" aria-haspopup="dialog">${i('pencil-line')}</button><textarea id="input" rows="1" maxlength="1000" placeholder="输入消息……" aria-label="聊天消息"></textarea><button class="send" type="submit" aria-label="发送消息" title="发送消息">${i('send')}</button></form>
      ${drawingBoardMarkup()}
    </section>
    <section id="actions-view" class="tab-view actions-view" role="tabpanel" aria-labelledby="actions-tab" hidden>

      <div class="section-heading"><h3>表情</h3><button class="reset-effects" id="reset-effects">全部复原</button></div><div class="expression-grid" id="expression-grid"></div>
      <div class="section-heading"><h3>道具</h3></div><div class="expression-grid" id="accessory-grid"></div>
      <div class="section-heading"><h3>动作</h3></div><div class="expression-grid" id="motion-grid"><button class="expression" data-motion="Wave"><span>${i('hand')}</span>抚胸</button><button class="expression" data-motion="Point"><span>${i('pointer')}</span>竖食指</button><button class="expression" data-motion="Grass"><span>${i('wheat')}</span>挑逗</button><button class="expression" data-motion="Lean"><span>${i('arrow-down-right')}</span>前倾</button><button class="expression" data-motion="Tilt"><span>${i('tilt')}</span>歪头</button><button class="expression" data-motion="Nod"><span>${i('nod')}</span>点头</button><button class="expression" data-motion="Shake"><span>${i('shake')}</span>摇头</button></div>
      <div class="section-heading"><h3>体型</h3></div><div class="body-options"><button data-body="0">标准体型</button><button data-body="0.4">小巧体型</button><button data-body="1">Q 版体型</button></div>
    </section>
  </aside>
</main>
<dialog id="settings-dialog"><div class="dialog-header"><div><h2 tabindex="-1" autofocus>设置</h2></div><button class="close-dialog" aria-label="关闭">${i('x')}</button></div><label class="setting-row"><span>目光跟随<small>让她的视线跟随你的鼠标</small></span><input type="checkbox" id="follow-setting" role="switch"></label><label class="setting-row"><span>自动朗读<small id="voice-source">使用设备语音</small></span><input type="checkbox" id="voice-setting" role="switch"></label><label class="volume-setting">朗读音量 <input id="volume-setting" type="range" min="0" max="1" step=".05"></label><label class="setting-row"><span>背景音乐</span><input type="checkbox" id="bgm-setting" role="switch"></label><label class="volume-setting">音乐音量 <input id="bgm-volume-setting" type="range" min="0" max="1" step=".01"></label><button id="credentials-open" class="glass-button" hidden type="button">我的 API Key</button><p class="model-credits">DeepSeek-chan（大肥鱼）<br>原画及拆分：神宫凉子<br>Live2D：霓虹猫_NeonNeko<br>模型来源：神宫凉子<br>BGM来源：黑耀耀_officialてす</p><button class="primary close-dialog">完成</button></dialog>
<dialog id="clear-dialog"><div class="dialog-header"><h2 tabindex="-1" autofocus>恢复初始状态？</h2><button class="close-dialog" aria-label="关闭">${i('x')}</button></div><p>清空聊天、游戏进度和今日游戏次数，好感度恢复 60，角色与页面设置恢复默认，已填写的 API Key 会保留。你也可以先导出对话留念。</p><div class="dialog-actions"><button class="glass-button" id="cancel-clear">再聊一会</button><button class="primary" id="confirm-clear">清空对话</button></div></dialog>
<dialog id="affection-dialog" class="affection-dialog"><div class="dialog-header"><h2 tabindex="-1" autofocus>和她的默契</h2><button class="close-dialog" aria-label="关闭">${i('x')}</button></div><p id="affection-title"></p><div class="affection-track"><span id="affection-progress"></span></div><p id="affection-detail"></p><section class="affection-history" aria-labelledby="affection-history-title"><h3 id="affection-history-title">最近互动</h3><ul id="affection-history"></ul><p id="affection-history-empty">还没有好感度变化</p></section></dialog>
<dialog id="credentials-dialog"><div class="dialog-header"><h2 tabindex="-1" autofocus>我的 API Key</h2><button class="close-dialog" aria-label="关闭">${i('x')}</button></div><form id="credentials-form" autocomplete="off"><p>对话 Key：前往 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">DeepSeek 开放平台</a>，登录后创建 API Key。</p><p>语音 Key（可选）：前往 <a href="https://console.volcengine.com/speech/new/setting/apikeys?ResourceID=volc.seedicl.default&amp;projectName=default" target="_blank" rel="noopener noreferrer">豆包语音控制台</a>，登录后开通「语音合成」，再创建 API Key。未填写时，仅播放已有缓存语音。</p><p>Key 仅在当前页面内存中使用，刷新或离开页面后需要重新填写；试用后请去对应平台删除API Key以免泄露。</p><label for="llm-key">DeepSeek API key</label><input id="llm-key" type="password" autocomplete="off" spellcheck="false" maxlength="512" placeholder="填写你的对话 Key"><label id="tts-key-label" for="tts-key">豆包语音 API Key</label><input id="tts-key" type="password" autocomplete="off" spellcheck="false" maxlength="512" placeholder="填写你的语音 Key"><p class="credentials-note">可以去<a href="https://github.com/ckx123alter/Live2D-CompanionAI" target="_blank" rel="noopener noreferrer">github</a>收藏并下载到本地运行哦o(*￣▽￣*)ブ</p><div class="dialog-actions"><button type="button" class="glass-button" id="credentials-delete">删除 Key</button><button type="submit" class="primary">在当前页面使用</button></div></form></dialog>
<dialog id="login-dialog"><form id="login-form"><h2>访问口令</h2><label for="access-password">请输入分享者提供的口令</label><input id="access-password" type="password" autocomplete="current-password" maxlength="256" required><p id="login-error" role="alert"></p><button class="primary" type="submit">进入聊天</button></form></dialog>
<div id="toast" role="status"></div>`;

const expressions = [
  ['neutral','smile','平静',null],
  ['smile','laugh','开心','＞＜'],
  ['playful','playful','俏皮',{TongueOut:1,ParamEyeLOpen:0}],
  ['curious','curious','好奇',{eyeOpenValue:1,ParamMouthForm:1,ParamMouthOpenY:.7}],
  ['goofy','goofy','呆萌',{key9:1,ParamEyeLOpen:1.3,ParamEyeROpen:1.3,ParamMouthForm:1,ParamMouthOpenY:1}],
  ['thinking','ellipsis','思考',{key3:1,key8:1}],
  ['startled','startled','惊讶',{ParamEyeLOpen:1.5,ParamEyeROpen:1.5,ShockL:1,ShockR:1,ParamMouthForm:-1,ParamMouthOpenY:.55}],
  ['loving','heart','心动','爱心眼'],
  ['shy','blush','害羞',{key7:1,ParamBrowLY:-.2,ParamBrowRY:-.2,ParamBrowLY2:-.3,ParamBrowRY2:-.3,ParamBrowLY3:0,ParamBrowRY3:0,ParamMouthForm:.25}],
  ['worried','worried','担忧',{key2:1,hideTears:1,eyeOpenLimit:.85,ParamMouthForm:-.65,ParamMouthOpenY:.12}],
  ['aggrieved','frown','委屈',{key2:1,ParamMouthForm:-.7,ParamMouthOpenY:.25}],
  ['sadness','sadness','悲伤',{eyeOpenLimit:.35,ParamBrowLY:-.75,ParamBrowRY:-.75,ParamBrowLY2:0,ParamBrowRY2:0,ParamBrowLY3:0,ParamBrowRY3:0,ParamMouthForm:-.8,ParamMouthOpenY:.1}],
  ['guilty','droplets','心虚','流冷汗'],
  ['speechless','annoyed','无语','屑屑眼'],
  ['angry','angry','生气',{CheeckPuff:1,ParamBrowLY:-.75,ParamBrowRY:-.75,ParamBrowLY2:0,ParamBrowRY2:0,ParamBrowLY3:0,ParamBrowRY3:0,ParamMouthForm:-1,ParamMouthOpenY:.05}],
  ['yandere','cloud','病娇',{key1:1,ParamMouthForm:.8,ParamMouthOpenY:.1}]
];
$('#expression-grid').innerHTML = expressions.map(([key,symbol,name]) => `<button data-expression="${key}" class="expression ${key === 'neutral' ? 'selected':''}"><span>${i(symbol)}</span>${name}</button>`).join('');
const accessories=[['pot','cooking-pot','锅盆',{key10:1}],['glasses','glasses','黑框眼镜',{key11:1}],['monocle','circle','单片眼镜',{key12:1}],['flowers','flower','花朵',{}]];
const accessoryState=createAccessoryState(accessories.map(([key])=>key));
const enabledAccessories=accessoryState.enabled;
$('#accessory-grid').innerHTML=accessories.map(([key,symbol,name])=>`<button data-accessory="${key}" class="expression" aria-pressed="false"><span>${i(symbol)}</span>${name}</button>`).join('');
function syncAccessories(){document.querySelectorAll('[data-accessory]').forEach(b=>{const enabled=enabledAccessories.has(b.dataset.accessory);b.classList.toggle('selected',enabled);b.setAttribute('aria-pressed',String(enabled));});syncAppearance(false);}
const controlledExpressionIds=[...Array.from({length:13},(_,n)=>`key${n+1}`),'TongueOut','CheeckPuff','Mouthpucker','ParamMouthForm','LeanInput','ShockL','ShockR'];
const browIds=['ParamBrowLY','ParamBrowRY','ParamBrowLY2','ParamBrowRY2','ParamBrowLY3','ParamBrowRY3'];
function syncAppearance(react=true) {
  const values=idleSurprise?{...expressions.find(([key])=>key==='startled')[3],LeanInput:idleLean?-30:0}:{...expressionValues};
  if(idleSurprise&&model){
    const core=model.internalModel.coreModel;
    for(const id of ['ParamEyeLOpen','ParamEyeROpen']){
      const index=core.getModel().parameters.ids.indexOf(id);
      if(index>=0)values[id]=core.getParameterMaximumValue(index);
    }
  }
  const targets={...values,
    eyeOpenValue:values.eyeOpenValue??1, eyeValueWeight:Number(values.eyeOpenValue!=null),
    eyeOpenLimit:values.eyeOpenLimit??1.5, eyeLimitWeight:Number(values.eyeOpenLimit!=null),
    mouthWeight:Number(values.ParamMouthOpenY!=null),
    sweatWeight:Number(!idleSurprise&&currentExpression==='guilty'), thinkingWeight:Number(!idleSurprise&&currentExpression==='thinking'),
    flowerWeight:Number(enabledAccessories.has('flowers'))};
  for(const id of browIds)targets[`${id}Weight`]=Number(values[id]!=null);
  for(const id of ['ParamEyeLOpen','ParamEyeROpen'])targets[`${id}Weight`]=Number(values[id]!=null);
  for(const [key,,,params] of accessories)for(const [id,value] of Object.entries(params))targets[id]=enabledAccessories.has(key)?value:0;
  if(idleSurprise)targets.key10=1;
  const now=performance.now();
  if(appearanceTransition.set(targets,now) && react && model && !tapReaction && now-switchStarted>=650)switchStarted=now;
}
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),Math.max(2800,Math.min(10000,text.length*110))); }
function renderMessages() {
  const list = $('#messages');
  let changed=false;
  const drawingReplies=drawingReplyFlags(messages,pendingGameCompletion);
  let latestDrawingReply=null;
  messages.forEach((m,index) => {
    const readable=m.role==='assistant' && !(backend?.tts==='server'&&!m.id&&m.text!==WELCOME_TEXT);
    const signature=JSON.stringify([m.role,m.text,Boolean(drawingReplies[index]),readable]);
    if(drawingReplies[index])latestDrawingReply=m;
    const existing=list.children[index];
    if(existing?.messageSignature===signature) {
      existing.messageData=m;
      const play=existing.querySelector('.read-message');
      if(play)play.disabled=waitingReply||play.getAttribute('aria-busy')==='true';
      return;
    }
    const row = document.createElement('div'); row.className=`message ${m.role}`;
    row.messageSignature=signature;row.messageData=m;
    if (m.role==='assistant') { const img=document.createElement('img'); img.src=avatar; img.alt='她'; img.className='avatar'; row.append(img); }
    const content=document.createElement('div'); content.className='message-content'; const bubble=document.createElement('div'); bubble.className='bubble'; bubble.textContent=m.text; content.append(bubble);
    if(drawingReplies[index]) {
      bubble.classList.add('drawing-invitation');
      const enter=document.createElement('button');enter.type='button';enter.className='drawing-enter';
      enter.title='进入你画我猜';enter.setAttribute('aria-label','进入你画我猜');
      enter.setAttribute('aria-haspopup','dialog');enter.setAttribute('aria-controls','drawing-view');
      enter.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13L19 12Z" fill="currentColor"/></svg>';
      enter.onclick=()=>openDrawing();bubble.append(enter);
    }
    if(readable) {
      const play=document.createElement('button');
      play.className='read-message'; play.title='朗读这条消息'; play.setAttribute('aria-label','朗读这条消息');
      play.innerHTML=i('volume-2'); play.disabled=waitingReply;
      play.onclick=async()=>{
        if(waitingReply||play.disabled)return;
        speech.unlock();
        const showPending=pending=>{
          play.disabled=pending||waitingReply;
          play.setAttribute('aria-busy',String(pending));
          play.innerHTML=i(pending?'loader-circle':'volume-2');icons();
        };
        showPending(true);
        try {await speak(row.messageData,{replay:true,onReady:()=>showPending(false)});}
        finally {showPending(false);}
      };
      content.append(play);
    }
    row.append(content);
    if(existing)list.replaceChild(row,existing);else list.append(row);
    changed=true;
  });
  drawingBoard.showReply(latestDrawingReply);
  if(waitingReply&&!list.children[messages.length]?.classList.contains('typing')) {
    const el=document.createElement('div');el.className='typing';el.innerHTML='<span></span><span></span><span></span>';el.setAttribute('aria-label','加载中');
    const existing=list.children[messages.length];
    if(existing)list.replaceChild(el,existing);else list.append(el);
    changed=true;
  }
  while(list.children.length>messages.length+Number(waitingReply)){list.lastElementChild.remove();changed=true;}
  $('#count').textContent=`已对话 ${messages.filter(m=>m.role==='user').length} 次`;
  $('#affection-value').textContent=String(affection);
  renderAffectionDetails();
  if(affectionFlashPending){
    affectionFlashPending=false;
    affectionAnimation?.cancel();
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    affectionAnimation=$('#affection-badge').animate(reduced?[
      {backgroundColor:'#b77e9733'},{backgroundColor:'#b77e970b'}
    ]:[
      {opacity:1,backgroundColor:'#b77e970b'},
      {opacity:.35,backgroundColor:'#e4aec344'},
      {opacity:1,backgroundColor:'#e4aec344'},
      {opacity:.35,backgroundColor:'#e4aec344'},
      {opacity:1,backgroundColor:'#b77e970b'}
    ],{duration:720,easing:'ease-in-out'});
  }
  if(changed){icons();requestAnimationFrame(()=>list.scrollTo({top:list.scrollHeight,behavior:'smooth'}));}
}
function replyAction(message) {
  return message.text==='唔......触及到我的知识盲区了。'?'Shake':message.action;
}
function performReply(message) {
  const action=replyAction(message);
  clearTimeout(tapRestoreTimer); tapReaction=null;
  accessoryState.applyReply(message.props);syncAccessories();
  setExpression(normalizeEmotion(message.emotion));
  // Reply gestures replace a manually held pose and finish in the default pose.
  // playAction without hold also clears the selected action card.
  if(model && ['Wave','Point','Grass','Lean','Tilt','Nod','Shake','Rest'].includes(action)) playAction(action);
}
function speak(message, {replay=false,onReady=()=>{}}={}) {
  welcomePending=false;
  const special=message.text===quickReplies['答对了！'].text;
  let previousExpression, startRevision;
  const restartAction=!special && replay && model && ['Wave','Point','Grass','Lean','Tilt','Nod','Shake','Rest'].includes(replyAction(message));
  // An explicit replay owns its saved action, even after a manually held pose.
  // Give physics time to leave the previous pose before replaying the same gesture.
  if(restartAction)playAction('Rest');
  return new Promise(resolve=>speech.play(message, { server: backend?.tts==='server', unavailable: backend?.tts==='disabled', volume: settings.volume, retry:replay, startDelay:restartAction?240:0,
    beforeStart:preloadReply(message),onFinish:resolve,
    onStart:()=>{
      onReady();
      previousExpression=currentExpression==='thinking'?'neutral':currentExpression;
      performReply(special?{...message,emotion:'curious',action:null}:message);
      startRevision=expressionRevision;
    },
    onEnd:()=>{
      if(!special || expressionRevision!==startRevision)return;
      setExpression('playful');if(model)playAction('Tilt');
      const faceRevision=expressionRevision, poseRevision=actionRevision;
      setTimeout(()=>{
        if(expressionRevision===faceRevision)setExpression(previousExpression);
        if(model && actionRevision===poseRevision)playAction('Rest');
      },1800);
    },
  }));
}
async function presentReply(message, reveal) {
  renderMessages();
  let revealed=false, release;
  const ready=new Promise(resolve=>{release=resolve;});
  const show=()=>{
    if(revealed)return;
    revealed=true;waitingReply=false;reveal();renderMessages();release();
  };
  if(!settings.voice){
    await preloadReply(message);show();performReply(message);
    return {finished:Promise.resolve('ended')};
  }
  const finished=speak(message,{onReady:show});
  // Turning voice off, failed synthesis, or blocked autoplay must still reveal
  // the saved reply and release the typing state without re-sending the turn.
  finished.then(()=>{if(!revealed){show();performReply(message);}});
  await ready;
  return {finished};
}
function showService() {
  $('#voice-source').textContent=backend?.app_env==='production'&&!keyStatus().tts?'未填 TTS Key，仅播放共享缓存语音':backend?.tts==='disabled'?'角色语音尚未配置':backend?.tts==='server'?'使用角色语音':'使用设备语音';
  $('#credentials-open').hidden=backend?.app_env!=='production';
  drawingBoard.setBusy(busy);
}
async function acceptHistory(data) {
  messages=data.messages.length?data.messages.map(m=>m.role==='assistant'?{...m,emotion:normalizeEmotion(m.emotion)}:m):[{role:'assistant',text:WELCOME_TEXT,emotion:'neutral'}];
  affection=Number.isInteger(data.affection)?data.affection:60;
  hasDrawingSession=Boolean(data.drawing_snapshot?.state);
  await drawingState.load(data.drawing_snapshot);
  activeTopic=data.drawing_snapshot?.state?.paused?'chat':data.drawing_snapshot?.state?'drawing_game':'chat';
  if(data.game_completed&&!drawingBoard.answerState().finished)drawingBoard.endGame({text:DAILY_LIMIT_TEXT});
  if(drawingBoard.answerState().finished)activeTopic='chat';
  if(activeTopic==='drawing_game'&&data.drawing_snapshot?.state)openDrawing();
  serviceReady=true;retryTurn=null;showService();renderMessages();
  tryPlayWelcome();
}
let connecting=false;
$('#reconnect').onclick=()=>connectBackend();
async function connectBackend() {
  if(connecting)return;
  connecting=true;serviceReady=false;
  $('#reconnect').disabled=true;
  try {
  $('.send').disabled=true;
  try { backend=await api('/config');speech.prepareTimeout=Math.min(190000,Math.max(15000,(Number(backend.request_timeout)||60)*1000+15000));speech.streaming=backend.tts_stream===true;void speech.configureShared?.(backend.shared_audio_profile); }
  catch { backend=null;serviceReady=false;showService();$('#reconnect').hidden=false;return; }
  showService();
  try { await acceptHistory(await api('/session')); $('#reconnect').hidden=true;promptCredentials(); }
  catch(error) {
    if(error.status===401){$('#login-dialog').showModal();$('#access-password').focus();}
    else { toast(error.message); }
    $('#reconnect').hidden=false;
  }
  } finally { connecting=false;$('#reconnect').disabled=false; }
}
function syncSettings() { $('#follow-setting').checked=settings.follow; $('#voice-setting').checked=settings.voice; $('#volume-setting').value=settings.volume; $('#bgm-setting').checked=settings.bgm; $('#bgm-volume-setting').value=settings.bgmVolume; document.querySelectorAll('[data-body]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.body)===settings.body)); icons(); save(); }
let expressionValues = {};
let expressionStarted = performance.now();
const expressionCache=new Map();
function loadExpressionValues(name) {
  if(!expressionCache.has(name))expressionCache.set(name,fetch(`/model/Exp3/${encodeURIComponent(name)}.exp3.json`,{signal:AbortSignal.timeout(30000)}).then(response=>{if(!response.ok)throw new Error('Missing expression');return response.json();}).then(data=>Object.fromEntries(data.Parameters.map(p=>[p.Id,p.Value]))).catch(error=>{expressionCache.delete(name);throw error;}));
  return expressionCache.get(name);
}
function preloadReply(message) {
  const entry=expressions.find(e=>e[0]===normalizeEmotion(message.emotion));
  const pending=[];
  if(typeof entry?.[3]==='string')pending.push(loadExpressionValues(entry[3]));
  const action=replyAction(message), returns={Wave:'Rest',Point:'RestPoint',Grass:'RestGrass'};
  if(model && returns[action]){
    const manager=model.internalModel.motionManager;
    pending.push(manager.loadMotion(action,0),manager.loadMotion(returns[action],0));
  }
  return new Promise(resolve=>{
    // Optional pose downloads must not hold a completed reply indefinitely.
    const timer=setTimeout(resolve,5000);
    Promise.allSettled(pending).then(()=>{clearTimeout(timer);resolve();});
  });
}
async function warmReplyResources() {
  if(navigator.connection?.saveData)return;
  const replies=Object.values(quickReplies);
  for(let i=0;i<replies.length;i+=2)await Promise.allSettled(replies.slice(i,i+2).map(preloadReply));
}
async function setExpression(key) {
  key=normalizeEmotion(key);
  const revision=++expressionRevision;
  const entry=expressions.find(e=>e[0]===key); if(!entry)return;
  document.querySelectorAll('[data-expression]').forEach(b=>b.classList.toggle('selected',b.dataset.expression===key));
  $('#mood').textContent=key==='neutral'?'平静':entry[2];
  // Keep the old face visible during the first resource load; never flash neutral.
  let values={};
  if(entry[3] && typeof entry[3]==='object')values={...entry[3]};
  else if(entry[3]) {
    try {
      values=await loadExpressionValues(entry[3]);
    } catch {
      expressionCache.delete(entry[3]);
      if(expressionRevision===revision)toast('表情加载失败，请重试');
      return;
    }
  }
  if(expressionRevision!==revision)return;
  if(key==='goofy' && model){
    const core=model.internalModel.coreModel;
    const index=core.getModel().parameters.ids.indexOf('ParamMouthOpenY');
    if(index>=0)values.ParamMouthOpenY=core.getParameterMaximumValue(index);
  }
  if(key==='startled' && model){
    const core=model.internalModel.coreModel;
    for(const id of ['ParamEyeLOpen','ParamEyeROpen']){
      const index=core.getModel().parameters.ids.indexOf(id);
      if(index>=0)values[id]=core.getParameterMaximumValue(index);
    }
  }
  currentExpression=key;expressionStarted=performance.now();expressionValues={...values};syncAppearance();
}
async function send(text) {
  text=text.trim();
  if (!text || busy || !serviceReady || drawingBoard.answerState().drawing) return false;
  welcomePending=false;
  speech.unlock();speech.stop();if(model&&!heldAction)playAction('Rest');
  const previous=[...messages];
  const turn=retryTurn?.text===text?retryTurn:{text,request_id:crypto.randomUUID()};
  messages.push({role:'user',text});$('#input').value='';busy=true;waitingReply=true;showService();renderMessages();setExpression('thinking');
  let advanceDrawing=false;
  try {
    let assistant, drawingResult, result;
    {
      if(hasDrawingSession)drawingBoard.pause();await drawingState.flush();
      result=await api('/chat',{method:'POST',body:turn});
      assistant=result.assistant;drawingResult=result.drawing;
    }
    retryTurn=null;
    const {finished:playback}=await presentReply(assistant,()=>{
      messages=[...previous,result.user,assistant];
      if(Number.isInteger(result.affection)){affectionFlashPending=result.affection!==affection;affection=result.affection;}
      if(assistant.text===BINGO_TEXT)pendingGameCompletion=assistant;
      save();
      if(drawingResult)drawingBoard.showAnswer(assistant,drawingResult.correct);
      if(assistant.text===DAILY_LIMIT_TEXT)drawingBoard.endGame(assistant);
      activeTopic=assistant.text===DAILY_LIMIT_TEXT?'chat':assistant.topic||'chat';
      if(activeTopic==='drawing_game'){
        if(assistant.text===quickReplies['来玩你画我猜吧'].text&&drawingBoard.answerState().finished)drawingBoard.reset();
        openDrawing();
      }else{drawingBoard.pause();closeDrawing(false);}
      if(hasDrawingSession)drawingState.schedule();
    });
    if(assistant===pendingGameCompletion)playback.then(()=>finishDrawingGame(assistant));
    // The saved confirmation advances the game once the reply is visible.
    advanceDrawing=assistant.game_intent==='confirm'&&assistant.text===quickReplies['答对了！'].text;
    return true;
  } catch(error) {
    messages=previous;retryTurn=error.code==='request_uncertain'?null:turn;$('#input').value=text;setExpression('neutral');toast(error.message);
    if(error.status===401){serviceReady=false;$('#login-dialog').showModal();}
    return false;
  } finally {
    busy=false;waitingReply=false;showService();renderMessages();
    if(advanceDrawing&&!drawingBoard.answerState().finished){
      characterRoundRequest={request_id:crypto.randomUUID()};
      await startCharacterRound();
    }
  }
}
function finishDrawingGame(message) {
  if(pendingGameCompletion!==message)return;
  pendingGameCompletion=null;
  // A cancelled/failed reading also releases the completed round's UI.
  if(drawingBoard.answerState().finished){
    activeTopic='chat';drawingBoard.pause();closeDrawing(false);
  }
  renderMessages();
}
async function submitComposer() {
  const text=$('#input').value.trim();if(!text || busy || !serviceReady)return;
  await send(text);
}
$('#chat-form').onsubmit=e=>{e.preventDefault();submitComposer();};
$('#input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submitComposer();}};
$('#suggestions').onclick=e=>{if(e.target.tagName==='BUTTON')send(e.target.textContent);};
function selectTab(id) {
  if(id!=='chat-tab')closeDrawing(false);
  document.querySelectorAll('.tab').forEach(tab=>{
    const selected=tab.id===id;
    tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));
    document.getElementById(tab.getAttribute('aria-controls')).hidden=!selected;
  });
}
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>selectTab(tab.id));
let drawingRetry=null, characterRoundRequest=null, activeTopic='chat', hasDrawingSession=false;
let drawingState;
const drawingBoard=createDrawingBoard($('#drawing-view'),{
  onClose:()=>closeDrawing(),
  onGuess:guessDrawing,
  onCorrect:async()=>{
    if(!backend){toast('请先连接后端，再交换绘画回合。');return false;}
    return await send('答对了！');
  },
  onState:state=>{
    const guessing=activeTopic==='drawing_game'&&state.character&&!state.solved;
    const input = $('#input');
    input.disabled = state.drawing;
    if (state.drawing) {
      input.placeholder = state.paused ? '打开画板继续绘画' : '画完后可以发送消息';
    } else {
      input.placeholder = guessing ? '输入你的答案……' : '输入消息……';
    }
    $('.send').disabled = !serviceReady || busy || state.drawing;
    $('#suggestions').querySelectorAll('button').forEach(button => {
      button.disabled = state.drawing;
    });
  },
  onRetryRound:()=>startCharacterRound(),
  onError:toast,
  onChange:()=>{drawingRetry=null;},
  onSave:()=>{if(hasDrawingSession)drawingState?.schedule();},
});
drawingState=createDrawingState({api,snapshot:()=>drawingBoard.snapshot(),
  restore:state=>drawingBoard.restore(state),canSave:()=>Boolean(backend)&&serviceReady&&!busy,
  onError:error=>{
    toast(drawingSaveErrorMessage(error));
    if(error.status===401){serviceReady=false;showService();$('#reconnect').hidden=false;}
  }});
window.addEventListener('online',()=>drawingState.retry(),{signal:idleEvents.signal});
window.addEventListener('pagehide',()=>{if(backend)drawingState.flush().catch(()=>{});});
let drawingOpen=false, drawingAnimation=null, drawingPositionFrame=0;
function positionDrawing() {
  if(!drawingOpen)return;
  const popup=$('#drawing-view'), composer=$('#chat-form').getBoundingClientRect();
  const chat=$('#chat-view').getBoundingClientRect();
  const mobile=window.matchMedia('(max-width:700px)').matches;
  const viewportTop=window.visualViewport?.offsetTop||0;
  const gap=14;
  const top=mobile?viewportTop+16:Math.max(chat.top+8,viewportTop+12);
  popup.style.setProperty('--drawing-bottom',`${Math.max(0,(mobile?window.innerHeight:chat.bottom)-composer.top+gap)}px`);
  popup.style.setProperty('--drawing-max-height',`${Math.max(0,composer.top-gap-top)}px`);
}
function scheduleDrawingPosition() {
  cancelAnimationFrame(drawingPositionFrame);
  drawingPositionFrame=requestAnimationFrame(positionDrawing);
}
const drawingResize=new ResizeObserver(scheduleDrawingPosition);
[$('#chat-form'),$('#chat-view')].forEach(element=>drawingResize.observe(element));
window.addEventListener('resize',scheduleDrawingPosition);
window.visualViewport?.addEventListener('resize',scheduleDrawingPosition);
window.visualViewport?.addEventListener('scroll',scheduleDrawingPosition);
if(import.meta.hot)import.meta.hot.dispose(()=>{
  drawingResize.disconnect();cancelAnimationFrame(drawingPositionFrame);drawingAnimation?.cancel();
  window.removeEventListener('resize',scheduleDrawingPosition);
  window.visualViewport?.removeEventListener('resize',scheduleDrawingPosition);
  window.visualViewport?.removeEventListener('scroll',scheduleDrawingPosition);
});
function openDrawing() {
  hasDrawingSession=true;activeTopic='drawing_game';drawingBoard.resume();
  selectTab('chat-tab');
  const popup=$('#drawing-view'), wasOpen=drawingOpen;
  drawingOpen=true;drawingAnimation?.cancel();popup.hidden=false;popup.classList.remove('is-closing');positionDrawing();
  $('#drawing-toggle').setAttribute('aria-expanded','true');
  $('#drawing-toggle').setAttribute('aria-label','收起画板');$('#drawing-toggle').title='收起画板';
  if(!wasOpen && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    drawingAnimation=popup.animate([
      {opacity:0,transform:'translateY(12px) scale(.96)'},
      {opacity:1,transform:'translateY(0) scale(1)'}
    ],{duration:380,easing:'cubic-bezier(.16,1,.3,1)'});
  }
  // Keep focus in the composer or on the entry button; automatic opening
  // must not focus the close button and inherit the keyboard focus outline.
}
function closeDrawing(restoreFocus=true) {
  if(!drawingOpen)return;
  const popup=$('#drawing-view'), focusInside=popup.contains(document.activeElement);
  drawingOpen=false;drawingBoard.finishStroke();drawingAnimation?.cancel();
  $('#drawing-toggle').setAttribute('aria-expanded','false');
  $('#drawing-toggle').setAttribute('aria-label','打开画板');$('#drawing-toggle').title='打开画板';
  if(restoreFocus&&focusInside)$('#drawing-toggle').focus({preventScroll:true});
  if(!restoreFocus || window.matchMedia('(prefers-reduced-motion: reduce)').matches){popup.hidden=true;return;}
  popup.classList.add('is-closing');
  const animation=popup.animate([
    {opacity:1,transform:'translateY(0) scale(1)'},
    {opacity:0,transform:'translateY(10px) scale(.975)'}
  ],{duration:180,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
  drawingAnimation=animation;
  animation.finished.then(()=>{if(!drawingOpen&&drawingAnimation===animation){popup.hidden=true;popup.classList.remove('is-closing');animation.cancel();}}).catch(()=>{});
}
$('#drawing-toggle').onclick=()=>drawingOpen?closeDrawing():openDrawing();
async function startCharacterRound() {
  if(busy || !backend || !serviceReady)return;
  characterRoundRequest ??= {request_id:crypto.randomUUID()};
  busy=true;showService();
  let failure=null;
  try {
    await drawingState.flush();
    const round=await api('/drawing/round',{method:'POST',body:characterRoundRequest});
    characterRoundRequest={request_id:round.round_id};
    if(round.drawing_snapshot)await drawingState.load(round.drawing_snapshot);
    else { drawingBoard.beginCharacter();drawingBoard.drawRound(round); }
  } catch(error) {
    if(error.code==='request_uncertain'||error.status===502)characterRoundRequest=null;
    failure=error.message;
    if(error.status===401){serviceReady=false;$('#login-dialog').showModal();}
  } finally {
    busy=false;showService();
    if(failure===DAILY_LIMIT_TEXT)drawingBoard.endGame({text:failure});
    else if(failure)drawingBoard.roundFailed(failure);
  }
}
async function guessDrawing(image) {
  if(busy)return;
  if(!serviceReady || !backend){drawingBoard.showError('请先连接后端，再让我看你的画。');return;}
  speech.unlock();speech.stop();if(model&&!heldAction)playAction('Rest');
  const turn=drawingRetry?.image===image?drawingRetry:{request_id:crypto.randomUUID(),image};
  drawingRetry=turn;busy=true;waitingReply=true;showService();renderMessages();setExpression('thinking');
  let failure=null;
  try {
    await drawingState.flush();
    const result=await api('/drawing/guess',{method:'POST',body:turn});
    drawingRetry=null;
    await presentReply(result.assistant,()=>{
      messages.push(result.user,result.assistant);
      drawingBoard.allowConfirmation();
      if(Number.isInteger(result.affection)){affectionFlashPending=result.affection!==affection;affection=result.affection;}
      save();
    });
  } catch(error) {
    if(error.code==='request_uncertain')drawingRetry=null;
    failure=error.message;setExpression('neutral');
    if(error.status===401){serviceReady=false;$('#login-dialog').showModal();}
  } finally {
    busy=false;waitingReply=false;showService();renderMessages();
    if(failure){if(failure===DAILY_LIMIT_TEXT)drawingBoard.endGame({text:failure});else drawingBoard.showError(failure);}
  }
}
$('#expression-grid').onclick=e=>{const b=e.target.closest('[data-expression]');if(b)setExpression(b.dataset.expression);};
$('#accessory-grid').onclick=e=>{const b=e.target.closest('[data-accessory]');if(!b)return;accessoryState.toggle(b.dataset.accessory);syncAccessories();};
$('#reset-effects').onclick=()=>{clearTimeout(tapRestoreTimer);tapReaction=null;accessoryState.clear();syncAccessories();setExpression('neutral');if(model)playAction('Rest');};
document.querySelectorAll('[data-motion]').forEach(b=>b.onclick=()=>playAction(heldAction===b.dataset.motion?'Rest':b.dataset.motion,true));
syncActions();
document.querySelectorAll('[data-body]').forEach(b=>b.onclick=()=>{settings.body=Number(b.dataset.body);zoom=1;offset={x:0,y:0};syncSettings();layoutModel();});
$('#bgm-setting').onchange=e=>{settings.bgm=e.target.checked;if(settings.bgm)speech.unlock();bgm.setEnabled(settings.bgm);save();};
$('#bgm-volume-setting').oninput=e=>{settings.bgmVolume=Number(e.target.value);bgm.setVolume(settings.bgmVolume);tryPlayWelcome();save();};
function openTitledDialog(dialog) {
  // Repeated credential prompts must not steal focus while a Key is being entered.
  if(dialog.open)return;
  dialog.showModal();
  // Explicitly focus the heading instead of relying only on native autofocus.
  dialog.querySelector('h2[autofocus]')?.focus({preventScroll:true});
}
$('#settings').onclick=()=>openTitledDialog($('#settings-dialog'));
function promptCredentials() {
  if(backend?.app_env==='production'&&!keyStatus().llm)openCredentials();
}
function syncCredentialFields() {
  const status=keyStatus();
  for(const [kind,placeholder] of [['llm','填写你的对话 Key'],['tts','填写你的语音 Key']]) {
    const field=$(`#${kind}-key`);
    field.disabled=status[kind];
    // Display a fixed mask without putting credentials or a fake Key in the DOM.
    field.placeholder=status[kind]?'********':placeholder;
    field.title=status[kind]?'已保存；删除 Key 后可重新填写':'';
    if(status[kind])field.value='';
  }
}
function openCredentials() {
  if(backend?.app_env!=='production')return;
  $('#tts-key-label').textContent=backend.tts_provider==='doubao'?'豆包 TTS API Key（可选）':'TTS API Key（可选）';
  syncCredentialFields();
  openTitledDialog($('#credentials-dialog'));
}
$('#credentials-open').onclick=openCredentials;
window.addEventListener('credentials-required',openCredentials);
$('#credentials-form').onsubmit=e=>{
  e.preventDefault();
  if(!$('#llm-key').value.trim()&&!keyStatus().llm){toast('请填写 LLM API Key，TTS Key 可以留空');$('#llm-key').focus();return;}
  const status=keyStatus();
  const stored=setUserKeys(status.llm?'':$('#llm-key').value,status.tts?'':$('#tts-key').value);
  syncCredentialFields();
  showService();
  $('#llm-key').value='';$('#tts-key').value='';
  $('#credentials-dialog').close();toast(stored?'Key 已在当前页面启用，刷新后需要重新填写':'浏览器无法保存会话，Key 仅在当前页面有效');
};
$('#credentials-delete').onclick=()=>{
  const cleared=clearUserKeys();$('#llm-key').value='';$('#tts-key').value='';syncCredentialFields();showService();
  toast(cleared?'Key 已删除，已提交的请求仍可能完成':'页面 Key 已清除，但会话存储无法删除，请清除此站点数据');
};
$('#credentials-dialog').addEventListener('close',()=>{$('#llm-key').value='';$('#tts-key').value='';});
window.addEventListener('pagehide',()=>{$('#llm-key').value='';$('#tts-key').value='';});
window.addEventListener('pageshow',event=>{if(event.persisted)syncCredentialFields();});

function renderAffectionDetails() {
  const stages=['初次相遇','亲密伙伴','心有灵犀'];
  const total=Math.max(0,Math.min(300,affection));
  const stage=total>=300?2:total>=100?1:0;
  const progress=stage===1?total-100:total, target=stage===1?200:100;
  $('#affection-title').textContent=stage===2?`${stages[stage]} · 满级`:`${stages[stage]} · ${progress}/${target}`;
  $('#affection-detail').textContent=stage===2?'累计 300/300 · 默契满满':`累计 ${total}/300 · 达到 ${stage===0?100:300} 点进入「${stages[stage+1]}」`;
  $('#affection-progress').style.width=`${stage===2?100:progress/target*100}%`;
  const recent=messages.filter(message=>message.role==='assistant'&&Number.isInteger(message.affection_change)&&message.affection_change!==0).slice(-10).reverse();
  const list=$('#affection-history');list.replaceChildren();
  $('#affection-history-empty').hidden=recent.length>0;
  for(const message of recent){
    const row=document.createElement('li'),reply=document.createElement('p'),change=document.createElement('span');
    reply.className='affection-reply';reply.textContent=message.text;
    change.className=`affection-change ${message.affection_change>0?'positive':'negative'}`;
    change.textContent=`${message.affection_change>0?'+':''}${message.affection_change}`;
    change.setAttribute('aria-label',`好感度${message.affection_change>0?'增加':'减少'}${Math.abs(message.affection_change)}点`);
    row.append(reply,change);list.append(row);
  }
}
$('#affection-badge').onclick=()=>{
  renderAffectionDetails();
  openTitledDialog($('#affection-dialog'));
};
document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('#follow-setting').onchange=e=>{settings.follow=e.target.checked;if(!settings.follow){gazePointer=null;model?.internalModel.focusController.focus(0,0);}syncSettings();};
$('#voice-setting').onchange=e=>{settings.voice=e.target.checked;if(settings.voice)speech.unlock();else speech.stop();syncSettings();};
$('#volume-setting').oninput=e=>{settings.volume=Number(e.target.value);speech.setVolume(settings.volume);save();};
$('#clear').onclick=()=>{if(busy)return toast('请等这一条回复完成');openTitledDialog($('#clear-dialog'));};
$('#cancel-clear').onclick=()=>$('#clear-dialog').close();
$('#confirm-clear').onclick=async()=>{
  if(busy)return toast('请等这一条回复完成');
  $('#confirm-clear').disabled=true;busy=true;showService();
  pendingGameCompletion=null;speech.stop();
  try {
    // Discard unsaved drawing changes instead of requiring a successful save
    // before deletion. Wait for in-flight saves so they cannot revive old state.
    await drawingState.suspend();
    const cleared=backend?await api('/session/messages',{method:'DELETE'}):null;
    hasDrawingSession=false;
    await drawingState.load(cleared?.drawing_snapshot);
    for(const key of ['whale-messages','whale-affection','whale-settings'])localStorage.removeItem(key);
    // A fresh page resets all animation timers, held props/poses, drawing tools,
    // audio, viewport and preferences through the same initialization path.
    // API keys belong to this tab, not the conversation; reload restores them.
    window.location.reload();
  } catch(error) {
    if(hasDrawingSession)drawingState.resume();
    toast(error.message);busy=false;showService();$('#confirm-clear').disabled=false;
  }
};
$('#login-dialog').addEventListener('cancel',e=>e.preventDefault());
$('#login-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#login-form button');button.disabled=true;$('#login-error').textContent='';
  try{await acceptHistory(await api('/login',{method:'POST',body:{password:$('#access-password').value}}));$('#access-password').value='';$('#login-dialog').close();promptCredentials();}
  catch(error){$('#login-error').textContent=error.message;}finally{button.disabled=false;}
};
$('#export').onclick=()=>{const blob=new Blob([messages.map(m=>`${m.role==='user'?'我':'鲸鱼娘'}：${m.text}`).join('\n\n')],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download='鲸语-对话记录.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('对话已导出');};
document.querySelectorAll('dialog:not(#login-dialog)').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
function layoutModel() { if(!model)return; const host=$('#canvas-wrap'); const w=host.clientWidth,h=host.clientHeight;pixi.renderer.resize(w,h);const widthRatio=.278-(.118*settings.body);const framing=Math.min(w*.92,h*1.06)/(h*widthRatio)*(settings.body===1?.85:.95);const viewZoom=zoom*.5;const scale=h/model.internalModel.originalHeight*framing*viewZoom;model.scale.set(scale);model.position.set(w*.51+offset.x,h*.12-h*.23*(framing*viewZoom/1.9)+offset.y);$('#zoom-label').textContent=Math.round(zoom*100)+'%'; }
function changeZoom(delta) {zoom=Math.max(.5,Math.min(2,zoom+delta));layoutModel();}
$('#reset-view').onclick=()=>{zoom=1;offset={x:0,y:0};layoutModel();};$('#zoom-in').onclick=()=>changeZoom(.1);$('#zoom-out').onclick=()=>changeZoom(-.1);
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前浏览器不支持全屏');}};
const host=$('#canvas-wrap');let drag;
host.addEventListener('pointerdown',e=>{if(!e.isPrimary||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y,started:performance.now(),moved:false,threshold:e.pointerType==='touch'?11:7};host.setPointerCapture(e.pointerId);});
host.addEventListener('pointermove',e=>{
  if(drag&&e.pointerId===drag.id){
    resetIdleLook();
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    drag.moved ||= Math.hypot(dx,dy)>drag.threshold;
    if(drag.moved){gazePointer=null;offset={x:drag.ox+dx,y:drag.oy+dy};layoutModel();}
  }else if(model&&settings.follow){
    // Only movement used for model gaze counts; hovering the panels stays idle.
    resetIdleLook();
    gazePointer={clientX:e.clientX,clientY:e.clientY};
  }
});
host.addEventListener('pointerleave',()=>{gazePointer=null;model?.internalModel.focusController.focus(0,0);});
host.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const tapped=!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<=drag.threshold&&performance.now()-drag.started<700;drag=null;if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);if(tapped){const r=host.getBoundingClientRect();reactToTap({x:e.clientX-r.left,y:e.clientY-r.top});}});
host.addEventListener('pointercancel',()=>drag=null);host.addEventListener('lostpointercapture',()=>drag=null);
host.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();reactToTap({x:0,y:0},true);}});
host.addEventListener('wheel',e=>{e.preventDefault();changeZoom(e.deltaY>0?-.05:.05);},{passive:false});
async function loadModel() {
  let contextLost=false;
  const showFailure=message=>{
    $('#loading').hidden=false;
    $('#loading').innerHTML='<span class="error-symbol">◇</span><p>模型暂时没能到达</p><small></small><button class="glass-button" id="retry">重新加载</button>';
    $('#loading small').textContent=message;
    $('#retry').onclick=()=>location.reload();
  };
  try {
    if(!window.Live2DCubismCore)throw new Error('Live2D 运行库没有加载');
    const {Live2DModel,Live2DPlugin,configureCubismSDK}=await import('untitled-pixi-live2d-engine/cubism');PIXI.extensions.add(Live2DPlugin);configureCubismSDK({memorySizeMB:64});
    const device={coarsePointer:matchMedia('(pointer: coarse)').matches,mobileUA:/iPhone|iPad|iPod|Android/i.test(navigator.userAgent),dpr:devicePixelRatio};
    let profile=modelProfile(device);
    pixi=new PIXI.Application();await pixi.init({width:host.clientWidth,height:host.clientHeight,preference:'webgl',backgroundAlpha:0,antialias:profile.antialias,resolution:profile.resolution,autoDensity:true});host.append(pixi.canvas);pixi.canvas.setAttribute('aria-label','她 Live2D 模型');
    pixi.canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();contextLost=true;pixi.stop();
      showFailure('浏览器中断了模型渲染，请关闭其他网页后重新加载。对话仍可使用。');
    });
    const gl=pixi.renderer.gl;
    // Context-loss events arrive asynchronously. Cubism cannot render the intervening
    // frame: its saved GL viewport is null and restoring it otherwise throws.
    const renderFrame=pixi.render;
    pixi.ticker.remove(renderFrame,pixi);
    pixi.render=function(){if(!gl.isContextLost())renderFrame.call(this);};
    pixi.ticker.add(pixi.render,pixi,PIXI.UPDATE_PRIORITY.LOW);
    profile=modelProfile({...device,maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)});
    $('#loading small').textContent=profile.lightweight?'正在加载手机版模型资源…':'正在加载模型资源…';
    model=await Live2DModel.from(profile.url,{autoHitTest:false,autoFocus:false,breathDepth:0.08,ticker:pixi.ticker,textureOptions:profile.textureOptions});model.anchor.set(.5,0);pixi.stage.addChild(model);
    const core=model.internalModel.coreModel; const parameterIds=core.getModel().parameters.ids; const setParam=(id,value)=>{const index=parameterIds.indexOf(id);if(index>=0)core.setParameterValueByIndex(index,value);};
    const sweatMotion=await fetch('/model/Animation/IDLE.motion3.json').then(response=>{if(!response.ok)throw new Error('Sweat motion missing');return response.json();});
    const sampleExpression=createExpressionAnimation(sweatMotion);
    const addParam=(id,value)=>{const index=parameterIds.indexOf(id);if(index>=0)core.addParameterValueByIndex(index,value);};
    const renderPropEffects=createPropEffects(host);
    const headPose={x:0,y:0,z:0};
    const idleEyes={x:0,y:0};
    const idleBody={bodyX:0,bodyY:0,bodyZ:0};
    let idleWeight=0;
    idleLook.reset();
    let lastHeadFrame=performance.now();
    const originalUpdateFocus=model.internalModel.updateFocus.bind(model.internalModel);
    model.internalModel.updateFocus=()=>{
      // Body size must be available to physics: Clothes2 drives Param34,
      // which controls the body layers' visibility as well as accessory offsets.
      // Applying it after physics leaves the original body visible underneath.
      setParam('Clothes2',settings.body);
      originalUpdateFocus();
      const now=performance.now();
      const idle=idleLook.sample(now,document.hidden||busy||speaking||!!activeAction||!!tapReaction||!!drag);
      syncIdleSurprise(Boolean(idle?.surprise),Boolean(idle?.lean));
      // Apply expression inputs before physics; accessories have independent state.
      appearance=appearanceTransition.sample(performance.now());
      for(const id of controlledExpressionIds)setParam(id,appearance[id]||0);
      // Winks must feed physics too: eye sockets and lashes depend on eye opening.
      for(const id of ['ParamEyeLOpen','ParamEyeROpen']){
        const index=parameterIds.indexOf(id);if(index<0)continue;
        const natural=core.getParameterValueByIndex(index);
        setParam(id,natural+((appearance[id]??1)-natural)*(appearance[`${id}Weight`]||0));
      }
      if(activeAction==='Lean')setParam('LeanInput',-30);
      const {x,y}=model.internalModel.focusController;
      const target=idle??headActionPose(activeAction,(now-actionStarted)/1000);
      const frameTime=Math.min(now-lastHeadFrame,100);
      const blend=1-Math.exp(-frameTime/110);lastHeadFrame=now;
      const bodyBlend=1-Math.exp(-frameTime/220);
      for(const key of Object.keys(idleBody))idleBody[key]+=((idle?.[key]??0)-idleBody[key])*bodyBlend;
      for(const axis of ['x','y','z'])headPose[axis]+=(target[axis]-headPose[axis])*blend;
      idleWeight+=((idle?1:0)-idleWeight)*blend;
      idleEyes.x+=((idle?.eyeX??0)-idleEyes.x)*blend;
      idleEyes.y+=((idle?.eyeY??0)-idleEyes.y)*blend;
      const gazeWeight=(headActions.has(activeAction)?.15:1)*(1-idleWeight);
      // This model's VTube Studio inputs are AngleX/Y/Z. Physics produces
      // ParamAngleX/Y/Z and the blend-shape angles from these inputs.
      // Writing the outputs directly would be overwritten by physics.
      setParam('AngleX',x*112.5*gazeWeight+headPose.x);
      setParam('AngleY',y*100*gazeWeight+headPose.y);
      setParam('AngleZ',-x*y*100*gazeWeight+headPose.z);
      // Switching reuses the exact body-tap pose, duration and amplitude.
      // One reaction drives both head and body, so a real tap never stacks with it.
      const reaction=tapReaction
        ?tapPose(tapReaction.region,now-tapReaction.started,tapReaction.side)
        :tapPose('body',now-switchStarted);
      addParam('AngleX',reaction.x);
      addParam('AngleY',reaction.y);
      addParam('AngleZ',reaction.z);
      // Drive the body's inputs before physics, just like the head. Writing
      // ParamBodyAngleX here would be overwritten by the physics calculation.
      setParam('PositionX',x*.15*(1-idleWeight)+reaction.bodyX+idleBody.bodyX);
      setParam('PositionY',reaction.bodyY+idleBody.bodyY);
      setParam('PositionZ',reaction.bodyZ+idleBody.bodyZ);
    };
    const displayInfo=await fetch('/model/大肥鱼.cdi3.json').then(response=>response.json());
    // key2 supplies the exact 委屈 brow deformation. For 担忧 only, hide its
    // tear drawings at render time without changing eyebrows or saved parameters.
    const raw=core.getModel();
    installSpeechMouth(core,displayInfo,()=>speaking,{
      getRestingOpening:()=>(appearance.ParamMouthOpenY||0)*(appearance.mouthWeight||0),
    });
    const tearParts=new Set(displayInfo.Parts.filter(part=>part.Name==='流泪').map(part=>part.Id));
    const tearDrawables=new Set();
    for(let index=0;index<raw.drawables.count;index++) {
      let part=raw.drawables.parentPartIndices[index];
      while(part>=0){if(tearParts.has(raw.parts.ids[part])){tearDrawables.add(index);break;}part=raw.parts.parentIndices[part];}
      // The right eye's three tear meshes are authored directly under 眼球.
      if(['ArtMesh139','ArtMesh140','ArtMesh141'].includes(raw.drawables.ids[index]))tearDrawables.add(index);
    }
    const originalDrawableOpacity=core.getDrawableOpacity.bind(core);
    core.getDrawableOpacity=index=>originalDrawableOpacity(index)*(tearDrawables.has(index)?1-(appearance.hideTears||0):1);
    const locateEyes=createEyeLocator(model,displayInfo);
    locateInteractionEyes=locateEyes;
    const debugGaze=location.hostname==='127.0.0.1'&&new URLSearchParams(location.search).has('debug-gaze');
    let previousDebugPointer;
    const restIds=['Movement1','Movement2','Movement3','Param62','Param59','Param60','Param61','Param40','Param36','Param39','Param41','Param42','Param43'];
    const actionHandIds={
      Wave:new Set(['Movement2','Param62','Param59','Param60','Param61']),
      Point:new Set(['Movement1','Movement3','Param40','Param36','Param39','Param41','Param42','Param43']),
      Grass:new Set(['Movement1','Movement3','Param36','Param39','Param41','Param42','Param43'])
    };
    const restPose=Object.fromEntries(restIds.map(id=>[id,0]));
    let lastFrame=performance.now();
    // Reset both hands before motion evaluation/saveParameters and physics.
    // Late render-only overrides leave the saved pose and Param35 stale.
    model.internalModel.on('beforeMotionUpdate',()=>{
      const now=performance.now(), blend=1-Math.exp(-Math.min(now-lastFrame,100)/150);lastFrame=now;
      const controlled=now<actionUntil?actionHandIds[activeAction]:null;
      for(const id of restIds){
        if(controlled?.has(id))continue;
        restPose[id]*=(1-blend);if(Math.abs(restPose[id])<.001)restPose[id]=0;setParam(id,restPose[id]);
      }
    });
    model.internalModel.on('afterMotionUpdate',()=>{
      if(activeAction==='Grass'&&performance.now()>=grassSwayStarted&&Number.isFinite(grassSwayStarted)){
        // Capture the real evaluated pose, including an interrupted previous
        // action, so the procedural continuation never jumps to hardcoded values.
        grassSwayBase??=Object.fromEntries(['Param36','Param39','Param41','Param42'].map(id=>[id,core.getParameterValueByIndex(parameterIds.indexOf(id))]));
        const pose=grassActionPose((performance.now()-grassSwayStarted)/1000,heldAction==='Grass',grassSwayBase);
        for(const [id,value] of Object.entries(pose))setParam(id,value);
      }
      // motionFinish can clear activeAction inside this update. Always capture
      // the evaluated pose so the reset layer starts from the last actual frame.
      for(const id of restIds){const index=parameterIds.indexOf(id);if(index>=0)restPose[id]=core.getParameterValueByIndex(index);}
    });
    model.internalModel.on('beforeModelUpdate',()=>{
      const now=performance.now();
      const animated=appearance.sweatWeight>0||appearance.thinkingWeight>0?sampleExpression((now-expressionStarted)/1000):{};
      for(let n=1;n<=6;n++)setParam(`SweatBurst${n}`,(animated[`SweatBurst${n}`]||0)*(appearance.sweatWeight||0));
      // The author's idle curve advances the loading segments with Param11 (0..8).
      setParam('Param11',appearance.thinkingWeight>0?(animated.Param11||0):0);
      const rect=host.getBoundingClientRect();
      const pointer=settings.follow&&gazePointer?{x:gazePointer.clientX-rect.left,y:gazePointer.clientY-rect.top}:null;
      const eyes=locateEyes();
      renderPropEffects(eyes,appearance.flowerWeight||0,now/1000);
      const gaze=gazeTarget(pointer,eyes);
      if(debugGaze&&eyes&&previousDebugPointer!==gazePointer){console.debug('[gaze]',JSON.stringify({eyes,pointer,gaze}));previousDebugPointer=gazePointer;}
      model.internalModel.focusController.focus(gaze.x,gaze.y);
      // Eyes move more than the head; retain the controller's eased movement.
      for(const id of ['ParamEyeLOpen','ParamEyeROpen']) {
        const index=parameterIds.indexOf(id);if(index<0)continue;
        let value=core.getParameterValueByIndex(index);
        value+=(appearance.eyeOpenValue-value)*(appearance.eyeValueWeight||0);
        value+=(Math.min(value,appearance.eyeOpenLimit)-value)*(appearance.eyeLimitWeight||0);
        setParam(id,value);
      }
      setParam('ParamEyeBallX',model.internalModel.focusController.x*3.5*(1-idleWeight)+idleEyes.x);
      setParam('ParamEyeBallY',model.internalModel.focusController.y*3.5*(1-idleWeight)+idleEyes.y);
      const mouth=speaking?(backend?.tts==='server'?(speech.analyser?speech.mouthLevel():.3+.25*Math.sin(now/90)):.3+.25*Math.sin(now/90)):0;
      // These are the actual brow deformers; angle inputs alone do not change this rig.
      for(const id of browIds){const index=parameterIds.indexOf(id);if(index>=0){const natural=core.getParameterValueByIndex(index);setParam(id,natural+((appearance[id]||0)-natural)*(appearance[`${id}Weight`]||0));}}
      // Speech owns mouth opening while playing; the expression only supplies
      // its resting mouth shape. Otherwise a fixed expression erases lip sync.
      const restingMouth=(appearance.ParamMouthOpenY||0)*(appearance.mouthWeight||0);
      setParam('ParamMouthOpenY',speaking?mouth:restingMouth);
    });
    new ResizeObserver(layoutModel).observe(host);layoutModel();pixi.render();
    if(contextLost||gl.isContextLost())throw new Error('WebGL context lost');
    $('#loading').hidden=true;
    if(window.requestIdleCallback)window.requestIdleCallback(()=>void warmReplyResources(),{timeout:3000});
    else setTimeout(()=>void warmReplyResources(),1000);
    tryPlayWelcome();
  } catch(error) {console.error(error);pixi?.stop?.();showFailure(contextLost?'浏览器中断了模型渲染，请关闭其他网页后重新加载。对话仍可使用。':'模型资源加载失败，请检查网络后重试。对话仍可使用。');}
}
bgm.audio.addEventListener('playing',tryPlayWelcome);
bgm.audio.addEventListener('volumechange',tryPlayWelcome);
window.addEventListener('pagehide',()=>{speech.stop();speech.cache.clear();bgm.pause();});
const resumeSpeech=()=>{if((settings.voice||settings.bgm)&&document.visibilityState!=='hidden')speech.unlock();};
document.addEventListener('pointerup',resumeSpeech,{capture:true,passive:true,signal:idleEvents.signal});
document.addEventListener('keydown',resumeSpeech,{capture:true,signal:idleEvents.signal});
document.addEventListener('visibilitychange',()=>{if(speech.context)resumeSpeech();},{signal:idleEvents.signal});
window.addEventListener('pageshow',()=>{if(speech.context)resumeSpeech();bgm.start();});
if(import.meta.hot)import.meta.hot.dispose(()=>{idleEvents.abort();speech.destroy();bgm.destroy();});
syncSettings();syncAccessories();renderMessages();connectBackend();loadModel();bgm.start();
