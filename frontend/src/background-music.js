export class BackgroundMusic {
  constructor({ volume = .18, enabled = true } = {}) {
    this.audio = document.createElement('audio');
    this.audio.id = 'background-music';
    this.audio.src = '/audio/轻松的，愉悦的树林子.mp3';
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.hidden = true;
    this.volume = volume;
    this.enabled = enabled;
    this.speaking = false;
    this.audio.volume = volume;
    document.body.append(this.audio);
    this.unlock = () => { void this.start(); };
  }

  listenForGesture(listen) {
    for (const type of ['pointerdown', 'keydown']) {
      document.removeEventListener(type, this.unlock, true);
      if (listen) document.addEventListener(type, this.unlock, true);
    }
  }

  async start() {
    if (!this.enabled || this.disposed || this.pending || !this.audio.paused) return;
    this.pending = true;
    try {
      await this.audio.play();
      if (!this.enabled || this.disposed) this.audio.pause();
      this.listenForGesture(false);
    } catch (error) {
      // Autoplay may require the first click/key press; never bypass that policy.
      if (this.enabled && !this.disposed && error.name === 'NotAllowedError') this.listenForGesture(true);
    } finally {
      this.pending = false;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) void this.start();
    else this.pause();
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.fadeToTarget();
  }

  setSpeaking(speaking) {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    this.fadeToTarget();
  }

  fadeToTarget() {
    cancelAnimationFrame(this.frame);
    const from = this.audio.volume;
    const to = this.volume * (this.speaking ? .25 : 1);
    const started = performance.now();
    const duration = this.speaking ? 220 : 800;
    const tick = now => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      this.audio.volume = from + (to - from) * eased;
      if (progress < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  pause() {
    this.listenForGesture(false);
    this.audio.pause();
  }

  destroy() {
    this.disposed = true;
    this.pause();
    cancelAnimationFrame(this.frame);
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio.remove();
  }
}
