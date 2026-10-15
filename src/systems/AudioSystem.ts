import type { PlayerPreferences } from '../types';

type Cue = 'click' | 'gate' | 'mirror' | 'metal' | 'whisper' | 'chant' | 'bell' | 'danger' | 'jumpscare' | 'victory';

export class AudioSystem {
  private context: AudioContext | null = null;
  private ambience: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  constructor(private preferences: PlayerPreferences) {}

  async unlock(): Promise<void> {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.ambience) this.startAmbience();
  }

  updatePreferences(preferences: PlayerPreferences): void {
    this.preferences = preferences;
    if (this.ambience) this.ambience.gain.gain.value = this.level(0.11);
  }

  play(cue: Cue, pan = 0): void {
    const context = this.context;
    if (!context || this.preferences.muted) return;
    const now = context.currentTime;
    const master = context.createGain();
    const panner = context.createStereoPanner();
    master.gain.setValueAtTime(this.level(cue === 'jumpscare' ? 0.62 : 0.3), now);
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    master.connect(panner).connect(context.destination);
    if (cue === 'whisper' || cue === 'chant' || cue === 'jumpscare') this.noiseBurst(context, master, now, cue);
    else this.tones(context, master, now, cue);
  }

  stop(): void {
    this.ambience?.source.stop();
    this.ambience = null;
  }

  private level(value: number): number { return this.preferences.muted ? 0 : value * this.preferences.volume; }

  private tones(context: AudioContext, target: AudioNode, now: number, cue: Cue): void {
    const frequencies: Record<string, number[]> = {
      click: [280], gate: [62, 47], mirror: [330, 495], metal: [91, 137], bell: [392, 587, 784], danger: [110, 82], victory: [262, 330, 392, 523],
    };
    (frequencies[cue] ?? [120]).forEach((frequency, index, list) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * (cue === 'victory' ? 0.16 : 0.03);
      const duration = cue === 'bell' ? 2.5 : cue === 'victory' ? 0.8 : 0.28;
      oscillator.type = cue === 'mirror' ? 'sine' : cue === 'bell' ? 'triangle' : 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (cue === 'gate') oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * 0.55), start + duration);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.34 / list.length, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain).connect(target);
      oscillator.start(start); oscillator.stop(start + duration + 0.02);
    });
  }

  private noiseBurst(context: AudioContext, target: AudioNode, now: number, cue: Cue): void {
    const duration = cue === 'jumpscare' ? 1.2 : cue === 'chant' ? 0.9 : 0.55;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    filter.type = cue === 'whisper' ? 'highpass' : 'lowpass';
    filter.frequency.value = cue === 'whisper' ? 1500 : cue === 'chant' ? 310 : 720;
    source.buffer = buffer;
    source.connect(filter).connect(target);
    source.start(now);
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
    gain.gain.value = this.level(0.11);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    this.ambience = { source, gain };
  }
}
