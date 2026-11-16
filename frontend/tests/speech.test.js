import test from 'node:test';
import assert from 'node:assert/strict';

let prompts=0;
globalThis.window={addEventListener(){},dispatchEvent(){prompts++;},speechSynthesis:{cancel(){},speak(){throw new Error('Device voice must not be used');}}};
globalThis.Audio=class {constructor(){throw new Error('New HTMLAudioElement would lose gesture permission');}};
const {SpeechPlayer}=await import('../src/speech.js');
const {BackgroundMusic}=await import('../src/background-music.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
class FakeContext extends EventTarget {
  static instances=[];
  constructor(){super();this.state='suspended';this.destination={};this.sources=[];this.currentTime=0;FakeContext.instances.push(this);}
  change(state){this.state=state;this.dispatchEvent(new Event('statechange'));}
  resume(){this.change('running');return Promise.resolve();}
  close(){this.change('closed');return Promise.resolve();}
  createGain(){return {gain:{value:1,cancelAndHoldAtTime(){},linearRampToValueAtTime(value){this.value=value;}},connect(){},disconnect(){}};}
  createMediaElementSource(audio){return {mediaElement:audio,connect(){},disconnect(){}};}
  createAnalyser(){return {fftSize:512,connect(){},disconnect(){},getByteTimeDomainData(samples){samples.fill(150);}};}
  decodeAudioData(){return Promise.resolve({duration:1});}
  createBuffer(channels,length,sampleRate){const data=new Float32Array(length);return {length,numberOfChannels:channels,duration:length/sampleRate,sampleRate,getChannelData(){return data;}};}
  createBufferSource(){const node={connect(){},disconnect(){},start(){node.started=true;},stop(){node.stopped=true;},started:false,stopped:false};this.sources.push(node);return node;}
}
function setup(){
  FakeContext.instances=[];window.AudioContext=FakeContext;
  globalThis.fetch=async()=>new Response(new Blob(['audio'],{type:'audio/mpeg'}));
  const events=[],errors=[];
  const player=new SpeechPlayer({onSpeaking:value=>events.push(value?'speaking':'silent'),onError:message=>errors.push(message)});
  const options={server:true,volume:.7,onStart:()=>events.push('show'),onFinish:reason=>events.push(reason),onEnd:()=>events.push('end')};
  return {player,events,errors,options};
}

test('optional TTS without audio completes reply without device speech or errors',async()=>{
  const h=setup();globalThis.fetch=async()=>new Response(null,{status:204});
  await h.player.play({id:12,text:'reply'},h.options);
  assert.deepEqual(h.events.filter(e=>e!=='silent'),['show','ended','end']);
  assert.deepEqual(h.errors,[]);assert.equal(prompts,0);assert.equal(h.player.playing,false);
  h.player.destroy();
});

test('delayed fetch, pose and decode finish before synchronized playback starts',async()=>{
  const h=setup(),response=deferred(),pose=deferred(),decode=deferred();
  h.player.unlock();h.player.context.decodeAudioData=()=>decode.promise;
  globalThis.fetch=()=>response.promise;
  const pending=h.player.play({id:42,text:'reply'},{...h.options,beforeStart:pose.promise});
  response.resolve(new Response(new Blob(['audio'])));await tick();
  assert.equal(h.events.includes('show'),false);
  pose.resolve();await tick();assert.equal(h.events.includes('show'),false);
  decode.resolve({duration:1});await pending;
  assert.ok(h.player.source.started);assert.equal(h.events.filter(e=>e==='show').length,1);
  assert.ok(h.player.mouthLevel()>0);
  h.player.source.onended();assert.equal(h.player.playing,false);
  assert.deepEqual(h.events.filter(e=>!['silent','speaking'].includes(e)),['show','ended','end']);
  h.player.destroy();
});

test('multiple replies reuse one unlocked context, analyser and volume control',async()=>{
  const h=setup();h.player.unlock();const context=h.player.context,analyser=h.player.analyser;
  await h.player.play({id:1,text:'first'},h.options);const first=h.player.source;
  h.player.setVolume(.25);assert.equal(h.player.gain.gain.value,.25);
  await h.player.play({id:2,text:'next'},h.options);
  assert.ok(first.stopped);assert.equal(h.player.context,context);assert.equal(h.player.analyser,analyser);
  assert.equal(FakeContext.instances.length,1);assert.equal(context.sources.length,2);
  assert.equal(h.player.playing,true);assert.deepEqual(h.errors,[]);
  h.player.destroy();
});

test('cancelled decode cannot start obsolete speech after a newer turn',async()=>{
  const h=setup(),decode=deferred();h.player.unlock();h.player.context.decodeAudioData=()=>decode.promise;
  const pending=h.player.play({id:1,text:'old'},h.options);await tick();
  h.player.stop();decode.resolve({duration:1});await pending;
  assert.equal(h.events.includes('show'),false);assert.equal(h.player.context.sources.length,0);
  assert.equal(h.events.filter(e=>e==='cancelled').length,1);h.player.destroy();
});

test('interrupted playback stops cleanly and the next gesture resumes the same channel',async()=>{
  const h=setup();await h.player.play({id:1,text:'first'},h.options);const context=h.player.context;
  context.change('interrupted');assert.equal(h.player.playing,false);assert.ok(h.events.includes('interrupted'));
  h.player.unlock();await h.player.play({id:2,text:'again'},h.options);
  assert.equal(h.player.context,context);assert.equal(context.state,'running');assert.ok(h.player.source.started);
  h.player.destroy();
});

test('stalled Safari resume is bounded and releases the pending reply',async t=>{
  const h=setup();h.player.unlock();h.player.context.change('suspended');
  h.player.context.resume=()=>new Promise(()=>{});
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=h.player.play({id:1,text:'reply'},h.options);await tick();
  t.mock.timers.tick(5001);await pending;
  assert.ok(h.events.includes('error'));assert.equal(h.events.filter(e=>e==='show').length,1);
  assert.equal(h.errors.length,1);assert.equal(h.player.playing,false);h.player.destroy();
});

test('decode and synthesis failures reveal text and release playback once',async()=>{
  for(const decodeError of [false,true]){
    const h=setup();h.player.unlock();
    if(decodeError)h.player.context.decodeAudioData=()=>Promise.reject(new DOMException('bad audio','EncodingError'));
    else globalThis.fetch=async()=>new Response('{"detail":"failed"}',{status:502});
    await h.player.play({id:42,text:'reply'},h.options);
    assert.equal(h.events.filter(e=>e==='show').length,1);assert.ok(h.events.includes('error'));
    assert.equal(h.errors.length,1);assert.equal(h.player.playing,false);h.player.destroy();
  }
});

test('speech preparation deadline reveals text and discards a late response',async t=>{
  const h=setup(),response=deferred();globalThis.fetch=()=>response.promise;
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=h.player.play({id:1,text:'reply'},h.options);
  t.mock.timers.tick(75000);
  assert.equal(h.events.filter(e=>e==='show').length,1);
  assert.ok(h.events.includes('error'));assert.equal(h.errors.length,1);
  response.resolve(new Response(new Blob(['late audio'])));await pending;
  assert.equal(h.player.context.sources.length,0);
  assert.equal(h.events.filter(e=>e==='show').length,1);h.player.destroy();
});

test('stream starts before provider completion and replay uses decoded cache',async()=>{
  const h=setup();h.player.streaming=true;let wire,calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(new ReadableStream({start(c){wire=c;}}));};
  const pending=h.player.play({id:71,text:'stream'},h.options);await tick();
  const send=value=>wire.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));
  send({type:'start',format:'pcm_s16le',sample_rate:24000});
  send({type:'chunk',data:Buffer.alloc(9600).toString('base64')});await tick();
  assert.equal(h.events.filter(x=>x==='show').length,1);assert.equal(h.player.playing,true);
  assert.equal(h.events.includes('ended'),false);
  send({type:'chunk',data:Buffer.alloc(9600).toString('base64')});send({type:'done'});wire.close();await pending;
  assert.equal(h.player.context.sources.length,2);
  for(const source of [...h.player.sources])source.onended();
  assert.equal(h.events.filter(x=>x==='ended').length,1);
  await h.player.play({id:71,text:'stream'},h.options);
  assert.equal(calls,1,'replay must not make another synthesis request');
  assert.equal(h.player.context.sources.length,3);h.player.destroy();
});

test('interrupted streams stop queued audio and never cache partial speech',async()=>{
  const h=setup();h.player.streaming=true;let wire;
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){wire=c;}}));
  const pending=h.player.play({id:72,text:'partial'},h.options);await tick();
  wire.enqueue(new TextEncoder().encode(JSON.stringify({type:'start',format:'pcm_s16le',sample_rate:24000})+'\n'+JSON.stringify({type:'chunk',data:Buffer.alloc(9600).toString('base64')})+'\n'));
  await tick();wire.close();await pending;
  assert.equal(h.errors.length,1);assert.equal(h.player.playing,false);
  assert.equal(h.player.cache.get('message:72'),null);
  assert.ok(h.player.context.sources[0].stopped);h.player.destroy();
});

test('manual read with no audio explains the missing key instead of silently finishing',async()=>{
  for(const streaming of [false,true]) {
    const h=setup();h.player.streaming=streaming;
    globalThis.fetch=async()=>streaming?new Response('{"type":"empty"}\n'):new Response(null,{status:204});
    await h.player.play({id:74,text:'no audio'},{...h.options,retry:true});
    assert.equal(h.errors.length,1);assert.match(h.errors[0],/语音 Key/);
    assert.ok(h.events.includes('error'));assert.equal(h.player.controller,null);
    h.player.destroy();
  }
});

test('manual read can recover from a truncated stream without an automatic duplicate request',async()=>{
  const h=setup();h.player.streaming=true;const requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push(JSON.parse(options.body));
    const start=JSON.stringify({type:'start',format:'pcm_s16le',sample_rate:24000})+'\n';
    const chunk=JSON.stringify({type:'chunk',data:Buffer.alloc(9600).toString('base64')})+'\n';
    return new Response(start+chunk+(requests.length===1?'':'{"type":"done"}\n'));
  };
  await h.player.play({id:75,text:'retry'},h.options);
  assert.equal(requests.length,1);assert.equal(h.player.controller,null);
  assert.equal(h.player.cache.get('message:75'),null);
  await h.player.play({id:75,text:'retry'},{...h.options,retry:true});
  assert.deepEqual(requests,[{message_id:75},{message_id:75,retry:true}]);
  assert.equal(h.player.playing,true);assert.ok(h.player.cache.get('message:75'));
  h.player.destroy();
});

test('public fixed audio is fetched once and reused for different message IDs',async()=>{
  const h=setup();h.player.unlock();h.player.context.decodeAudioData=async()=>h.player.context.createBuffer(1,24000,24000);
  h.player.shared.set('fixed','/audio/shared/'+'a'.repeat(64)+'.mp3');
  let calls=0;globalThis.fetch=async url=>{assert.match(url,/^\/audio\/shared\//);calls++;return new Response(new Blob(['audio']));};
  await h.player.play({id:1,text:'fixed'},h.options);
  await h.player.play({id:2,text:'fixed'},h.options);
  assert.equal(calls,1);assert.equal(h.player.context.sources.length,2);h.player.destroy();
});

test('auto speech and replay duck music even when the device ignores element volume',async()=>{
  globalThis.cancelAnimationFrame=()=>{};
  globalThis.requestAnimationFrame=()=>1;
  const audio={get volume(){return 1;},set volume(value){},pause(){},removeAttribute(){},load(){},remove(){}};
  globalThis.document={createElement:()=>audio,body:{append(){}},removeEventListener(){}};
  const bgm=new BackgroundMusic({volume:.4}),h=setup();
  h.player.onContext=context=>bgm.connectContext(context);
  h.player.onSpeaking=value=>bgm.setSpeaking(value);
  await h.player.play({id:1,text:'reply'},h.options);
  const source=bgm.source;
  assert.equal(bgm.gain.gain.value,.1);
  h.player.source.onended();assert.equal(bgm.gain.gain.value,.4);
  await h.player.play({id:1,text:'reply'},h.options);
  assert.equal(bgm.gain.gain.value,.1);
  assert.equal(bgm.source,source,'replay must reuse the existing media source');
  bgm.setVolume(.8);assert.equal(bgm.gain.gain.value,.2);
  h.player.stop();assert.equal(bgm.gain.gain.value,.8);
  globalThis.fetch=async()=>new Response('{"detail":"failed"}',{status:502});
  await h.player.play({id:1,text:'reply'},h.options);
  assert.equal(bgm.gain.gain.value,.8,'failed replay must not leave music ducked');
  h.player.destroy();bgm.destroy();
});
