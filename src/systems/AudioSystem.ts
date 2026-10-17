import type { Preferences } from '../types';

export type Cue = 'click' | 'step' | 'pickup' | 'use' | 'locked' | 'entity' | 'jumpscare' | 'escape'
  | 'discomfort' | 'suspicion-step' | 'suspicion-scratch' | 'threat-step' | 'threat-breath' | 'danger-scrape' | 'danger-silence';

const DANGER_CUES = new Set<Cue>(['discomfort', 'suspicion-step', 'suspicion-scratch', 'threat-step', 'threat-breath', 'danger-scrape']);

interface NoiseOptions {
  duration: number;
  filterType: BiquadFilterType;
  frequency: number;
  q?: number;
  peakGain: number;
  attack?: number;
}

export class AudioSystem {
  private context: AudioContext | null = null;
  private ambience: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  constructor(private preferences: Preferences) {}

  async unlock(): Promise<void> {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.ambience) this.startAmbience();
  }

  updatePreferences(preferences: Preferences): void {
    this.preferences = preferences;
    if (this.ambience) this.ambience.gain.gain.value = this.musicLevel(0.14);
  }

  play(cue: Cue, pan = 0): void {
    const context = this.context;
    if (!context || this.preferences.masterVolume === 0 || this.preferences.effectsVolume === 0) return;
    const now = context.currentTime;
    if (cue === 'danger-silence') { this.duckAmbience(2 + Math.random() * 1.2); return; }
    const master = context.createGain();
    const panner = context.createStereoPanner();
    const cueLevel = cue === 'jumpscare' ? 0.7 * (0.25 + this.preferences.jumpscareIntensity * 0.75) : 0.34;
    master.gain.setValueAtTime(this.effectsLevel(cueLevel), now);
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    master.connect(panner).connect(context.destination);
    if (cue === 'entity' || cue === 'jumpscare') this.noiseBurst(context, master, now, cue);
    else if (DANGER_CUES.has(cue)) this.dangerCue(context, master, now, cue);
    else this.tones(context, master, now, cue);
  }

  stop(): void {
    this.ambience?.source.stop();
    this.ambience = null;
  }

  private musicLevel(value: number): number { return value * this.preferences.masterVolume * this.preferences.musicVolume; }
  private effectsLevel(value: number): number { return value * this.preferences.masterVolume * this.preferences.effectsVolume; }

  private tones(context: AudioContext, target: AudioNode, now: number, cue: Cue): void {
    const frequencies: Record<string, number[]> = {
      click: [260], step: [68, 53], pickup: [440, 660], use: [330, 495, 660], locked: [82, 67], escape: [220, 330, 440, 660],
    };
    (frequencies[cue] ?? [120]).forEach((frequency, index, list) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * (cue === 'escape' ? 0.16 : 0.03);
      const duration = cue === 'escape' ? 0.9 : 0.28;
      oscillator.type = cue === 'pickup' || cue === 'use' ? 'sine' : 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (cue === 'step' || cue === 'locked') oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * 0.55), start + duration);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.34 / list.length, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain).connect(target);
      oscillator.start(start); oscillator.stop(start + duration + 0.02);
    });
  }

  private noiseBurst(context: AudioContext, target: AudioNode, now: number, cue: Cue): void {
    const duration = cue === 'jumpscare' ? 0.35 : 0.7;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    filter.type = cue === 'entity' ? 'bandpass' : 'lowpass';
    filter.frequency.value = cue === 'entity' ? 840 : 720;
    source.buffer = buffer;
    source.connect(filter).connect(target);
    source.start(now);
  }

  private dangerCue(context: AudioContext, target: AudioNode, now: number, cue: Cue): void {
    switch (cue) {
      case 'discomfort':
        this.noise(context, target, now, { duration: 0.32, filterType: 'bandpass', frequency: 380, q: 1.4, peakGain: 0.22 });
        break;
      case 'suspicion-step': {
        const count = 1 + Math.floor(Math.random() * 2);
        for (let index = 0; index < count; index += 1) this.noise(context, target, now + index * 0.32, { duration: 0.1, filterType: 'lowpass', frequency: 180, peakGain: 0.16 });
        break;
      }
      case 'suspicion-scratch':
        this.noise(context, target, now, { duration: 0.22, filterType: 'bandpass', frequency: 1500, q: 2.2, peakGain: 0.14 });
        break;
      case 'threat-step': {
        const count = 2 + Math.floor(Math.random() * 2);
        for (let index = 0; index < count; index += 1) this.noise(context, target, now + index * 0.28, { duration: 0.12, filterType: 'lowpass', frequency: 320, peakGain: 0.26 });
        break;
      }
      case 'threat-breath':
        this.sweepingBreath(context, target, now, 0.9, 0.3);
        break;
      case 'danger-scrape':
        this.noise(context, target, now, { duration: 0.85, filterType: 'bandpass', frequency: 900, q: 3, peakGain: 0.4, attack: 0.05 });
        break;
    }
  }

  private noise(context: AudioContext, target: AudioNode, now: number, options: NoiseOptions): void {
    const { duration, filterType, frequency, q = 1, peakGain, attack = 0.02 } = options;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0005, peakGain), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(target);
    source.start(now); source.stop(now + duration + 0.05);
  }

  private sweepingBreath(context: AudioContext, target: AudioNode, now: number, duration: number, peakGain: number): void {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);
    filter.frequency.linearRampToValueAtTime(320, now + duration * 0.5);
    filter.frequency.linearRampToValueAtTime(110, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0005, peakGain), now + duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(target);
    source.start(now); source.stop(now + duration + 0.05);
  }

  private duckAmbience(duration: number): void {
    if (!this.ambience || !this.context) return;
    const now = this.context.currentTime;
    const gainParam = this.ambience.gain.gain;
    const base = this.musicLevel(0.14);
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(Math.max(0.0001, gainParam.value), now);
    gainParam.linearRampToValueAtTime(0.0001, now + 0.3);
    gainParam.linearRampToValueAtTime(Math.max(0.0001, base), now + duration);
  }

  private startAmbience(): void {
    const context = this.context;
    if (!context) return;
    const duration = 4;
    const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * 0.32;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer; source.loop = true;
    filter.type = 'lowpass'; filter.frequency.value = 280;
    gain.gain.value = this.musicLevel(0.14);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    this.ambience = { source, gain };
  }
}
