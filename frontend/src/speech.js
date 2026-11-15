import { api } from './api.js';
export const WELCOME_TEXT = '你来啦。今天想和我聊点什么？';

// One playback owner for fetch, audio, mouth movement and interruption.
export class SpeechPlayer {
  constructor({ onSpeaking, onError }) {
    this.onSpeaking = onSpeaking;
    this.onError = onError;
    this.generation = 0;
    this.amplitude = 0;
  }

  unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext && !this.context) this.context = new AudioContext();
    this.context?.resume().catch(() => {});
  }

  stop(reason = 'cancelled') {
    const finish = this.onFinish;
    this.onFinish = null;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
    this.audio = null;
    this.source?.disconnect(); this.source = null;
    this.analyser?.disconnect(); this.analyser = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    window.speechSynthesis?.cancel();
    this.amplitude = 0;
    this.onSpeaking(false);
    finish?.(reason);
  }

  mouthLevel() {
    if (!this.audio || this.audio.paused || !this.analyser) return this.amplitude;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) sum += ((sample - 128) / 128) ** 2;
    const target = Math.min(.85, Math.max(0, Math.sqrt(sum / this.samples.length) - .012) * 5);
    this.amplitude += (target - this.amplitude) * .4;
    return this.amplitude;
  }

  async play(message, { server, unavailable = false, volume, startDelay = 0, onStart = () => {}, onEnd = () => {}, onFinish = () => {} }) {
    this.stop();
    this.onFinish = onFinish;
    const generation = this.generation;
    const readyAt = performance.now() + startDelay;
    const waitForPose = async () => {
      const remaining = readyAt - performance.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      return generation === this.generation;
    };
    let started = false;
    const start = () => {
      if (generation !== this.generation || started) return;
      started = true; this.onSpeaking(true); onStart();
    };
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
      const body=message.id?{message_id:message.id}:{preset:'welcome'};
      const blob = await api('/tts', { method: 'POST', body, signal: this.controller.signal });
      if (generation !== this.generation) return;
      if (!await waitForPose()) return;
      if (blob === null) {
        // Text-only replies still complete their pose/game lifecycle. This is
        // expected without an optional TTS key, not a playback failure.
        onStart(); this.stop('ended'); onEnd();
        return;
      }
      this.url = URL.createObjectURL(blob);
      this.audio = new Audio(this.url); this.audio.volume = volume;
      if (this.context?.state === 'running') {
        this.source = this.context.createMediaElementSource(this.audio);
        this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
        this.samples = new Uint8Array(this.analyser.fftSize);
        this.source.connect(this.analyser); this.analyser.connect(this.context.destination);
      }
      this.audio.onplaying = start;
      this.audio.onended = () => { if (generation === this.generation) { this.stop('ended'); onEnd(); } };
      this.audio.onerror = () => {
        if (generation === this.generation) { this.stop('error'); this.onError('音频无法播放，请检查服务是否返回 MP3。'); }
      };
      await this.audio.play();
    } catch (error) {
      if (generation !== this.generation || error.name === 'AbortError') return;
      this.stop('error');
      // The text remains usable even if speech or autoplay is unavailable.
      if (!started) onStart();
      this.onError(error.name === 'NotAllowedError' ? '浏览器阻止了自动播放，请点击消息下方的朗读按钮。' : error.message);
    }
  }
}
