import './drawing-board.css';
import { playStrokes } from './stroke-playback.js';

export function drawingBoardMarkup() {
  return `<section id="drawing-view" class="drawing-view" role="dialog" aria-modal="false" aria-labelledby="drawing-title" hidden>
    <div class="drawing-heading"><h3 id="drawing-title">你画我猜</h3><button id="drawing-close" type="button" aria-label="收起画板">收起</button></div>
    <div class="drawing-toolbar" role="group" aria-label="绘画工具">
      <button data-draw-tool="pen" type="button" aria-label="画笔" title="画笔" aria-pressed="true"><i data-lucide="pencil-line"></i></button><button data-draw-tool="eraser" type="button" aria-label="橡皮" title="橡皮" aria-pressed="false"><i data-lucide="eraser"></i></button>
      <label>粗细 <input id="drawing-size" type="range" min="2" max="24" value="5" aria-label="画笔粗细"></label>
      <button id="drawing-undo" disabled>撤销</button><button id="drawing-clear" disabled>清空</button>
    </div>
    <div class="drawing-paper"><canvas id="drawing-canvas" width="512" height="512" aria-label="你画我猜画板，用鼠标或手指绘画"></canvas></div>
    <div class="drawing-submit"><div class="drawing-submit-buttons"><button id="drawing-guess" class="primary" disabled>猜一下</button><button id="drawing-correct" class="drawing-correct" disabled>答对了</button></div></div>
    <div id="drawing-reply" class="drawing-reply" aria-label="她的最新回复" aria-live="polite" hidden></div>
    <button id="drawing-retry-round" class="drawing-correct" hidden>重试加载画稿</button>
  </section>`;
}

export function createDrawingBoard(root, { onGuess, onCorrect, onRetryRound, onClose, onState = () => {}, onChange = () => {}, onSave = () => {}, onError = () => {} }) {
  const $ = selector => root.querySelector(selector);
  const brushSize = $('#drawing-size');
  function updateBrushSizeFill() {
    const min = Number(brushSize.min);
    const fraction = (brushSize.valueAsNumber - min) / (Number(brushSize.max) - min);
    // The center of the 16 px thumb travels between 8 px insets.
    brushSize.style.setProperty('--fill-end', `calc(${fraction * 100}% + ${8 - fraction * 16}px)`);
  }
  brushSize.addEventListener('input', updateBrushSizeFill);
  updateBrushSizeFill();
  const canvas = $('#drawing-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let tool = 'pen', pointer = null, previous = null, locked = false, ink = false, canConfirm = false;
  let mode = 'user', round = null, animating = false, solved = false, cancelPlayback = null;
  let paused=false, revision=0;
  const history = [];
  function paintBlank() { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 512); }
  function refresh() {
    const pixels = ctx.getImageData(0, 0, 512, 512).data;
    ink = false;
    for (let n = 0; n < pixels.length; n += 4) {
      if (pixels[n] < 240) { ink = true; break; }
    }
    const character = mode !== 'user';
    $('.drawing-toolbar').hidden = character;
    $('.drawing-submit-buttons').hidden = character;
    $('#drawing-title').textContent = mode==='finished' ? '本轮结束' : character ? '我画你猜' : '你画我猜';
    root.classList.toggle('character-turn', character);
    $('#drawing-undo').disabled = locked || !history.length;
    $('#drawing-clear').disabled = locked || (!ink && !history.length);
    $('#drawing-guess').disabled = locked || !ink;
    $('#drawing-correct').disabled = locked || !canConfirm;
    canvas.style.cursor = character ? 'default' : locked ? 'wait' : 'crosshair';
    canvas.setAttribute('aria-disabled', String(locked || character));
    $('#drawing-reply').hidden = !$('#drawing-reply').textContent;
    onState(answerState());
  }
  function answerState() {
    return {
      character: mode === 'character',
      drawing: mode === 'character' && animating,
      paused,
      finished: mode === 'finished',
      roundId: round?.round_id,
      ready: Boolean(round) && !animating && !locked,
      solved,
    };
  }
  function remember() {
    history.push(ctx.getImageData(0, 0, 512, 512));
    if (history.length > 20) history.shift();
  }
  function point(event) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(512, (event.clientX - box.left) * 512 / box.width)), y: Math.max(0, Math.min(512, (event.clientY - box.top) * 512 / box.height)) };
  }
  function draw(from, to) {
    ctx.strokeStyle = ctx.fillStyle = tool === 'eraser' ? '#ffffff' : '#282333';
    ctx.lineWidth = brushSize.valueAsNumber * (tool === 'eraser' ? 3 : 1);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(to.x, to.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
  }
  function changed() {
    canConfirm = false;
    onChange(); refresh(); onSave();
  }
  function finish(event) {
    if (event && event.pointerId !== pointer) return;
    if (pointer === null) return;
    const id = pointer; pointer = null; previous = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    changed();
  }
  canvas.onpointerdown = event => {
    if (mode !== 'user' || locked || pointer !== null || event.button !== 0) return;
    event.preventDefault(); remember(); pointer = event.pointerId;
    canvas.setPointerCapture(pointer); previous = point(event); draw(previous, previous);
  };
  canvas.onpointermove = event => {
    if (event.pointerId !== pointer) return;
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) { const next = point(sample); draw(previous, next); previous = next; }
  };
  canvas.onpointerup = finish; canvas.onpointercancel = finish; canvas.onlostpointercapture = finish;
  root.querySelectorAll('[data-draw-tool]').forEach(button => button.onclick = () => {
    tool = button.dataset.drawTool;
    root.querySelectorAll('[data-draw-tool]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  });
  $('#drawing-undo').onclick = () => { if (locked || !history.length) return; ctx.putImageData(history.pop(), 0, 0); changed(); };
  $('#drawing-clear').onclick = () => { if (locked) return; remember(); paintBlank(); changed(); };
  $('#drawing-guess').onclick = () => { finish(); if (!locked && ink) onGuess(canvas.toDataURL('image/png')); };
  $('#drawing-correct').onclick = async () => {
    if (locked || !canConfirm) return;
    // Preserve confirmation eligibility in the snapshot sent with the chat.
    $('#drawing-correct').disabled = true;
    if (await onCorrect() !== false) canConfirm = false;
    refresh(); onSave();
  };
  $('#drawing-retry-round').onclick = onRetryRound;
  $('#drawing-close').onclick = onClose;
  root.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  };
  paintBlank(); refresh();
  function resetBoard() {
    revision++;paused=false;finish();cancelPlayback?.();cancelPlayback=null;mode='user';round=null;animating=false;solved=false;
    canConfirm=false;history.length=0;paintBlank();
    $('#drawing-reply').hidden=true;$('#drawing-retry-round').hidden=true;
    onChange();refresh();
  }
  function showAnswer(message, correct) {
    solved=correct;
    if(correct){cancelPlayback?.();animating=false;mode='finished';$('#drawing-retry-round').hidden=true;}
    $('#drawing-reply').textContent=message.text;
    $('#drawing-reply').hidden=false;refresh();onSave();
  }
  return {
    answerState,
    pause() { paused=true;finish();cancelPlayback?.pause();refresh();onSave(); },
    resume() { paused=false;cancelPlayback?.resume();refresh();onSave(); },
    snapshot() {
      return {mode,image:mode==='user'?canvas.toDataURL('image/png'):null,round_id:round?.round_id||null,
        progress:solved?1:cancelPlayback?.progress()||0,paused,can_confirm:canConfirm,
        feedback:$('#drawing-reply').textContent};
    },
    async restore(state) {
      resetBoard();const token=revision;
      if(!state)return;
      mode=state.mode;paused=state.paused;canConfirm=state.can_confirm;solved=mode==='finished';round=state.round||null;
      if(mode==='user'&&state.image){
        const image=new Image();image.src=state.image;await image.decode();
        if(token!==revision)return;
        ctx.drawImage(image,0,0,512,512);
      } else if(round){
        animating=!solved&&state.progress<1;
        cancelPlayback=playStrokes(ctx,round.strokes,()=>{animating=false;refresh();onSave();},
          {progress:state.progress,paused,onProgress:()=>onSave()});
      }
      const feedback=$('#drawing-reply');
      feedback.textContent=state.feedback||'';feedback.hidden=!state.feedback;
      $('#drawing-retry-round').hidden=mode!=='character'||Boolean(round);
      refresh();
    },
    setBusy(value) { finish(); locked = value; refresh(); root.setAttribute('aria-busy', String(value)); },
    finishStroke() { finish(); },
    allowConfirmation() { canConfirm = true; refresh();onSave(); },
    showReply(message) {
      const reply = $('#drawing-reply');
      const text = message?.text || '';
      if (reply.textContent !== text) { reply.textContent = text; reply.scrollTop = 0; }
      reply.hidden = !text; root.classList.toggle('has-reply', Boolean(text));
    },
    showError(message) { onError(message); },
    beginCharacter() {
      paused=false;finish();cancelPlayback?.();mode='character';round=null;animating=false;solved=false;
      canConfirm=false;history.length=0;paintBlank();
      $('#drawing-retry-round').hidden=true;refresh();
    },
    drawRound(data) {
      cancelPlayback?.();round=data;animating=true;solved=Boolean(data.solved);refresh();
      cancelPlayback=playStrokes(ctx,data.strokes,()=>{animating=false;refresh();onSave();},{onProgress:()=>onSave()});onSave();
    },
    showAnswer,
    endGame:message=>showAnswer(message,true),
    roundFailed(message) { $('#drawing-retry-round').hidden=false;onError(message); },
    reset: resetBoard,
  };
}
