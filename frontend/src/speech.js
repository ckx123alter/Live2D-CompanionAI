import { api } from './api.js';
import { AudioCache } from './audio-cache.js';
import { audioBytes, speechEvents } from './speech-stream.js';
export const WELCOME_TEXT = '你来啦。今天想和我聊点什么？';

// One playback owner for fetch, audio, mouth movement and interruption.
export class SpeechPlayer {
  constructor({ onSpeaking, onError, onContext = () => {} }) {
    this.onSpeaking = onSpeaking;
    this.onError = onError;
    this.onContext = onContext;
    this.generation = 0;
    this.amplitude = 0;
    this.volume = .7;
    this.playing = false;
    this.prepareTimeout = 75000;
    this.cache = new AudioCache();
    this.shared = new Map();
    this.warming = new Map();
    this.sources = new Set();
    this.streaming = false;
    this.handleContextState = () => {
      if(this.playing && this.context?.state !== 'running') {
        this.stop('interrupted');
        this.onError('语音被系统暂停，请点击消息下方的朗读按钮继续。');
      }
    };
  }

  unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext && (!this.context || this.context.state === 'closed')) {
      this.context?.removeEventListener('statechange',this.handleContextState);
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
      this.samples = new Uint8Array(this.analyser.fftSize);
      this.gain.connect(this.analyser); this.analyser.connect(this.context.destination);
      this.context.addEventListener('statechange',this.handleContextState);
      this.onContext(this.context);
    }
    // Call synchronously from the user's gesture, before any network await.
    // Safari grants this context permission; new HTMLAudioElements do not inherit it.
    if(this.context && this.context.state !== 'running')this.context.resume().catch(() => {});
    if(this.shared.size)void this.preloadShared();
  }

  async configureShared(profile) {
    if(this.profile===profile)return;
    this.profile=profile;this.shared.clear();this.cache.clear();
    if(!profile)return;
    try {
      const response=await fetch('/audio/shared-manifest.json',{signal:AbortSignal.timeout(5000)});
      if(!response.ok)return;
      const manifest=await response.json();
      if(this.profile!==profile||manifest.profile!==profile||!Array.isArray(manifest.entries))return;
      for(const entry of manifest.entries.slice(0,40)){
        if(typeof entry.text==='string'&&/^\/audio\/shared\/[a-f0-9]{64}\.mp3$/.test(entry.url))this.shared.set(entry.text,entry.url);
      }
      if(this.context)void this.preloadShared();
    } catch { /* The normal authenticated speech route remains available. */ }
  }

  async sharedBuffer(url) {
    const cached=this.cache.get(url);if(cached)return cached;
    if(this.warming.has(url))return this.warming.get(url);
    const context=this.context;
    const promise=(async()=>{
      const response=await fetch(url,{signal:AbortSignal.timeout(8000),credentials:'omit'});
      if(!response.ok)throw new Error('Shared audio unavailable');
      const buffer=await context.decodeAudioData(await response.arrayBuffer());
      if(this.context===context)this.cache.put(url,buffer);
      return buffer;
    })();
    this.warming.set(url,promise);
    try{return await promise;}finally{this.warming.delete(url);}
  }

  async preloadShared() {
    if(this.preloading||!this.context||this.warmedProfile===this.profile)return;
    this.preloading=true;
    const profile=this.profile;
    try {
      const urls=[...this.shared.values()];
      for(let i=0;i<urls.length;i+=2)await Promise.allSettled(urls.slice(i,i+2).map(url=>this.sharedBuffer(url)));
    } finally {this.preloading=false;this.warmedProfile=profile;}
  }

  setVolume(volume) {
    this.volume = Math.max(0,Math.min(1,Number(volume)||0));
    if(this.gain)this.gain.gain.value = this.volume;
  }

  waitUntilRunning(signal) {
    const context=this.context;
    if(!context)return Promise.reject(new Error('当前浏览器不支持角色语音播放。'));
    if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
    if(context.state==='running')return Promise.resolve();
    // Some Safari interruptions leave resume() pending indefinitely. Bound the wait
    // and let the existing read button provide a fresh user gesture to retry.
    return new Promise((resolve,reject)=>{
      const done=error=>{
        clearTimeout(timer);context.removeEventListener('statechange',check);
        signal.removeEventListener('abort',cancel);
        error?reject(error):resolve();
      };
      const check=()=>{if(context.state==='running')done();};
      const cancel=()=>done(new DOMException('Cancelled','AbortError'));
      const timer=setTimeout(()=>done(new DOMException('Audio context suspended','NotAllowedError')),5000);
      context.addEventListener('statechange',check);
      signal.addEventListener('abort',cancel,{once:true});
      context.resume().catch(done);
      check();
    });
  }

  destroy() {
    this.stop();
    this.cache.clear();this.shared.clear();
    this.context?.removeEventListener('statechange',this.handleContextState);
    this.gain?.disconnect();this.analyser?.disconnect();
    this.context?.close().catch(()=>{});
    this.context=null;this.gain=null;this.analyser=null;
  }

  stop(reason = 'cancelled') {
    clearTimeout(this.startTimer);
    clearTimeout(this.streamTimer);
    const finish = this.onFinish;
    this.onFinish = null;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.playing = false;
    for(const source of this.sources){source.onended=null;try{source.stop();}catch{}source.disconnect();}
    this.sources.clear();
    if(this.source) {
      this.source.onended=null;
      try { this.source.stop(); } catch { /* An already-ended node needs only disconnecting. */ }
      this.source.disconnect();this.source=null;
    }
    window.speechSynthesis?.cancel();
    this.amplitude = 0;
    this.onSpeaking(false);
    finish?.(reason);
  }

  mouthLevel() {
    if (!this.playing || !this.analyser) return this.amplitude;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) sum += ((sample - 128) / 128) ** 2;
    const target = Math.min(.85, Math.max(0, Math.sqrt(sum / this.samples.length) - .012) * 5);
    this.amplitude += (target - this.amplitude) * .4;
    return this.amplitude;
  }

  async playStream(response,{generation,cacheKey,waitForPose,start,onEnd}) {
    const signal=this.controller.signal,context=this.context;
    let complete=false,format=false,pending=new Uint8Array(),nextTime=0,total=0,buffer;
    const pieces=[];
    const ended=()=>{
      if(complete&&!this.sources.size&&generation===this.generation){this.stop('ended');onEnd();}
    };
    const enqueue=async audio=>{
      if(!await waitForPose()||generation!==this.generation)return;
      await this.waitUntilRunning(signal);
      if(generation!==this.generation)return;
      const source=context.createBufferSource();source.buffer=audio;source.connect(this.gain);
      this.sources.add(source);
      source.onended=()=>{this.sources.delete(source);source.disconnect();ended();};
      const when=Math.max(context.currentTime,nextTime);
      source.start(when);nextTime=when+audio.duration;
      this.playing=true;start();
    };
    const flush=async final=>{
      if(!pending.length||(!final&&pending.length<9600))return;
      const length=pending.length-pending.length%2;
      if(!length)return;
      const audio=context.createBuffer(1,length/2,24000),channel=audio.getChannelData(0);
      const view=new DataView(pending.buffer,pending.byteOffset,length);
      for(let i=0;i<channel.length;i++)channel[i]=view.getInt16(i*2,true)/32768;
      pieces.push(channel.slice());pending=pending.slice(length);
      await enqueue(audio);
    };
    const controller=this.controller;
    const streamTimer=setTimeout(()=>controller.abort(),this.prepareTimeout);
    this.streamTimer=streamTimer;
    try {
      for await(const event of speechEvents(response)){
        if(generation!==this.generation)return;
        if(event.type==='empty'){
          complete=true;return false;
        } else if(event.type==='audio'){
          if(format||buffer)throw new Error('语音流格式错误。');
          buffer=await context.decodeAudioData(audioBytes(event.data).buffer);
          await enqueue(buffer);
        } else if(event.type==='start'){
          if(format||buffer||event.format!=='pcm_s16le'||event.sample_rate!==24000)throw new Error('语音流格式不支持。');
          format=true;
        } else if(event.type==='chunk'){
          if(!format)throw new Error('语音流缺少格式信息。');
          const chunk=audioBytes(event.data);total+=chunk.length;
          if(total>10*1024*1024)throw new Error('语音文件过大。');
          const joined=new Uint8Array(pending.length+chunk.length);joined.set(pending);joined.set(chunk,pending.length);pending=joined;
          await flush(false);
        } else if(event.type==='done'){
          await flush(true);
          if(pending.length||(!buffer&&!pieces.length))throw new Error('语音数据不完整。');
          if(generation!==this.generation)return;
          if(!buffer){
            buffer=context.createBuffer(1,total/2,24000);let offset=0;
            for(const part of pieces){buffer.getChannelData(0).set(part,offset);offset+=part.length;}
          }
          this.cache.put(cacheKey,buffer);complete=true;ended();
        } else throw new Error('未知的语音响应。');
      }
      return true;
    } finally {clearTimeout(streamTimer);if(this.streamTimer===streamTimer)this.streamTimer=null;}
  }

  async play(message, { server, unavailable = false, volume, retry = false, startDelay = 0, beforeStart = Promise.resolve(), onStart = () => {}, onEnd = () => {}, onFinish = () => {} }) {
    this.stop();
    this.setVolume(volume);
    this.onFinish = onFinish;
    const generation = this.generation;
    const readyAt = performance.now() + startDelay;
    const waitForPose = async () => {
      await beforeStart;
      const remaining = readyAt - performance.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      return generation === this.generation;
    };
    let started = false;
    const start = () => {
      if (generation !== this.generation || started) return;
      clearTimeout(this.startTimer);
      started = true; this.onSpeaking(true); onStart();
    };
    this.startTimer=setTimeout(()=>{
      if(generation!==this.generation||started)return;
      onStart();this.stop('error');this.onError('语音准备超时，已显示文字回复，可点击朗读重试。');
    },this.prepareTimeout);
    try {
      if (unavailable) throw new Error('角色语音尚未配置，请联系部署者。');
      if (!server) {
        if (!window.speechSynthesis) throw new Error('当前浏览器不支持语音朗读。');
        if (!await waitForPose()) return;
        const utterance = new SpeechSynthesisUtterance(message.text);
        utterance.lang = 'zh-CN'; utterance.volume = volume;
        const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('zh'));
        if (voice) utterance.voice = voice;
        utterance.onstart = start;
        utterance.onend = () => { if (generation === this.generation) { this.stop('ended'); onEnd(); } };
        utterance.onerror = event => {
          if (generation !== this.generation) return;
          this.stop(['interrupted', 'canceled'].includes(event.error) ? 'cancelled' : 'error');
          if (!['interrupted', 'canceled'].includes(event.error)) {
            if (!started) onStart();
            this.onError('朗读未能播放，请检查浏览器的语音支持。');
          }
        };
        speechSynthesis.speak(utterance);
        return;
      }
      if (!message.id && message.text !== WELCOME_TEXT) throw new Error('这条本地消息没有服务端语音，请发送新消息。');
      this.unlock();
      this.controller = new AbortController();
      const body={...(message.id?{message_id:message.id}:{preset:'welcome'}),...(retry?{retry:true}:{})};
      const publicUrl=this.shared.get(message.text);
      const cacheKey=publicUrl||`message:${message.id}`;
      let buffer=this.cache.get(cacheKey),blob;
      if(!buffer&&publicUrl){try{buffer=await this.sharedBuffer(publicUrl);}catch{/* Use server cache if the asset is unavailable. */}}
      if(generation!==this.generation)return;
      if(!buffer&&this.streaming){
        const response=await api('/tts/stream',{method:'POST',body,signal:this.controller.signal});
        if(generation!==this.generation)return;
        const played=await this.playStream(response,{generation,cacheKey,waitForPose,start,onEnd});
        if(played===false){
          if(retry)throw new Error('没有可播放的缓存语音，请检查是否已填写语音 Key。');
          onStart();this.stop('ended');onEnd();
        }
        return;
      }
      if(!buffer)blob=await api('/tts', { method: 'POST', body, signal: this.controller.signal });
      if (generation !== this.generation) return;
      if (!await waitForPose()) return;
      if (blob === null) {
        // Text-only replies still complete their pose/game lifecycle. This is
        // expected without an optional TTS key, not a playback failure.
        if(retry)throw new Error('没有可播放的缓存语音，请检查是否已填写语音 Key。');
        onStart(); this.stop('ended'); onEnd();
        return;
      }
      if(!this.context)throw new Error('当前浏览器不支持角色语音播放。');
      if(!buffer)buffer=await this.context.decodeAudioData(await blob.arrayBuffer());
      if(generation!==this.generation)return;
      this.cache.put(cacheKey,buffer);
      await this.waitUntilRunning(this.controller.signal);
      if(generation!==this.generation)return;
      // Buffer sources are one-shot, but reuse the gesture-unlocked context and graph.
      // Decode before starting so text, gestures and speech share the same start point.
      this.source=this.context.createBufferSource();
      this.source.buffer=buffer;this.source.connect(this.gain);
      this.source.onended=()=>{if(generation===this.generation){this.stop('ended');onEnd();}};
      this.source.start();this.playing=true;start();
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop('error');
      // The text remains usable even if speech or autoplay is unavailable.
      if (!started) onStart();
      this.onError(error.name === 'AbortError'?'语音传输超时，文字回复已保留。':error.name === 'NotAllowedError' ? '语音通道尚未恢复，请点击消息下方的朗读按钮。' : ['EncodingError','NotSupportedError'].includes(error.name)?'语音解码失败，请点击消息下方的朗读按钮重试。':error.message);
    }
  }
}
