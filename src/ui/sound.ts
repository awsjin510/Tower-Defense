/**
 * 程式化音效引擎（WebAudio 合成，零音檔資產）。
 * - 延遲建立 AudioContext（瀏覽器要求首個使用者手勢後才能發聲）
 * - 高頻事件（射擊/命中）做節流，避免噪音牆與 CPU 爆量
 * - 靜音偏好存 localStorage（裝置本機，不進雲端存檔）
 */

type SfxName = 'fire' | 'hit' | 'crit' | 'kill' | 'coin' | 'wave' | 'boss' | 'ult' | 'nuke' | 'click' | 'buy' | 'gameover';

const MUTE_KEY = 'td-sound-muted';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  /** 各音效的下次可播時間（節流用），單位為 ctx.currentTime 秒 */
  private nextAt: Record<string, number> = {};

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* 隱私模式讀不到就當沒靜音 */
    }
  }

  /** 首個手勢時呼叫：建立/喚醒音訊環境 */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.3;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!this.muted) this.unlock();
    return this.muted;
  }

  /** 節流：距上次同名音效未達 minGap 秒則跳過 */
  private throttled(key: string, minGap: number): boolean {
    if (!this.ctx) return true;
    const now = this.ctx.currentTime;
    if ((this.nextAt[key] ?? 0) > now) return true;
    this.nextAt[key] = now + minGap;
    return false;
  }

  /** 合成一個音符：波形、起訖頻率、時長、音量、可選噪音 */
  private tone(
    wave: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 短噪音爆（命中/爆炸用） */
  private noise(dur: number, vol: number, hp = 800): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  play(name: SfxName): void {
    if (this.muted || !this.ctx) return;
    switch (name) {
      case 'fire':
        if (this.throttled('fire', 0.05)) return;
        this.tone('square', 620, 300, 0.05, 0.05);
        break;
      case 'hit':
        if (this.throttled('hit', 0.04)) return;
        this.noise(0.04, 0.05, 1200);
        break;
      case 'crit':
        if (this.throttled('crit', 0.06)) return;
        this.tone('triangle', 900, 1500, 0.09, 0.09);
        this.noise(0.05, 0.06, 1500);
        break;
      case 'kill':
        if (this.throttled('kill', 0.05)) return;
        this.tone('sine', 260, 90, 0.11, 0.1);
        break;
      case 'coin':
        if (this.throttled('coin', 0.06)) return;
        this.tone('sine', 880, 880, 0.05, 0.09);
        this.tone('sine', 1320, 1320, 0.08, 0.09, 0.05);
        break;
      case 'wave':
        this.tone('triangle', 440, 660, 0.18, 0.11);
        this.tone('triangle', 660, 880, 0.22, 0.09, 0.06);
        break;
      case 'boss':
        this.tone('sawtooth', 150, 70, 0.5, 0.14);
        this.tone('sine', 90, 60, 0.6, 0.1, 0.05);
        break;
      case 'ult':
        this.tone('sawtooth', 180, 1200, 0.35, 0.12);
        break;
      case 'nuke':
        this.tone('sawtooth', 500, 40, 0.5, 0.16);
        this.noise(0.4, 0.14, 200);
        break;
      case 'click':
        this.tone('square', 480, 480, 0.03, 0.05);
        break;
      case 'buy':
        this.tone('triangle', 700, 950, 0.07, 0.09);
        break;
      case 'gameover':
        this.tone('sawtooth', 400, 120, 0.35, 0.13);
        this.tone('sawtooth', 300, 80, 0.5, 0.12, 0.14);
        break;
    }
  }

  /** 結算金幣傾瀉：一串上行叮噹 */
  coinCascade(): void {
    if (this.muted || !this.ctx) return;
    for (let i = 0; i < 7; i++) {
      this.tone('sine', 700 + i * 90, 700 + i * 90, 0.06, 0.06, i * 0.07);
    }
  }
}

export const Sound = new SoundEngine();
