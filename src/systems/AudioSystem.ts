import type { Preferences } from '../types';
import {
  buildLibrary, categoryLabel, clipFileName, clipGain, clipsForGender, configFor, ESTIMATED_CLIP_MS, GLOBAL_FX_SPACING_MS, selectClip,
  type AudioBus, type AudioClip, type CategoryConfig, type VoiceGender,
} from './audioLibrary';

export type Cue = 'click' | 'step' | 'pickup' | 'use' | 'locked' | 'entity' | 'jumpscare' | 'escape'
  | 'discomfort' | 'suspicion-step' | 'suspicion-scratch' | 'threat-step' | 'threat-breath' | 'danger-scrape' | 'danger-silence';

const DANGER_CUES = new Set<Cue>(['discomfort', 'suspicion-step', 'suspicion-scratch', 'threat-step', 'threat-breath', 'danger-scrape']);

const MANIFEST_URL = '/assets/audio/manifest.json';
const SCHEDULER_INTERVAL_MS = 250;
/** Com o leito sintético e uma música de arquivo tocando juntos, o leito recua. */
const AMBIENCE_DUCK = 0.45;

interface NoiseOptions {
  duration: number;
  filterType: BiquadFilterType;
  frequency: number;
  q?: number;
  peakGain: number;
  attack?: number;
}

export interface SampleOptions {
  /** Probabilidade de a execução acontecer quando a janela de tempo já estiver liberada. */
  chance?: number;
  pan?: number;
  /** Ignora o espaçamento global entre efeitos (para sons de evento, como dano). */
  immediate?: boolean;
}

interface MusicState {
  category: string;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  nextTrackAt: number;
}

/** Um som de arquivo que ainda está soando, para poder ser interrompido. */
interface ActiveClip {
  source: AudioBufferSourceNode;
  gain: GainNode;
  bus: AudioBus;
}

/** O que o painel DEV mostra sobre o que está tocando agora. */
export interface NowPlaying {
  music: { label: string; file: string } | null;
  roomTrack: { file: string; mode: string } | null;
  lastEffect: { label: string; file: string; at: number } | null;
}

/** Trilha presa a uma sala pelo editor. */
export interface RoomTrackOptions {
  loop: boolean;
  volume?: number;
}

export class AudioSystem {
  private context: AudioContext | null = null;
  private ambience: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private library = new Map<string, AudioClip[]>();
  private libraryRequest: Promise<void> | null = null;
  private readonly buffers = new Map<string, AudioBuffer | null>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();
  /** Últimas escolhas por categoria, para nunca repetir o mesmo arquivo mais de duas vezes. */
  private readonly recent = new Map<string, string[]>();
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();
  /** Instante em que o último efeito termina de soar, mais o espaçamento mínimo. */
  private effectBusyUntil = 0;
  /** O mesmo, por grupo exclusivo (voz do personagem, batimentos). */
  private readonly groupBusyUntil = new Map<string, number>();
  /** Gênero do personagem atual: define quais arquivos de voz podem tocar. */
  private voiceGender: VoiceGender = 'male';
  private music: MusicState | null = null;
  private requestedMusic: string | null = null;
  private scheduler: ReturnType<typeof setInterval> | null = null;
  /** Tudo que está soando de arquivo agora: permite parar o áudio de uma vez. */
  private readonly active = new Set<ActiveClip>();
  /** Enquanto verdadeiro nenhum som de jogo entra e o contexto fica suspenso. */
  private gameplayPaused = false;
  /** Trilha presa à sala atual, quando o editor configurou uma. */
  private roomTrack: { path: string; mode: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Trilha de sala pedida antes de o navegador liberar o áudio; toca ao liberar. */
  private pendingRoomTrack: { path: string; options: RoomTrackOptions } | null = null;
  private nowMusic: { label: string; file: string } | null = null;
  private lastEffect: { label: string; file: string; at: number } | null = null;
  constructor(private preferences: Preferences) {}

  async unlock(): Promise<void> {
    if (!this.context) this.context = new AudioContext();
    // Durante a pausa o contexto fica suspenso de propósito: nenhum clique o reacorda.
    if (this.gameplayPaused) return;
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.musicBus || !this.effectsBus || !this.voiceBus) this.createBuses();
    if (!this.ambience) this.startAmbience();
    if (!this.scheduler) this.scheduler = setInterval(() => this.updateMusicScheduling(), SCHEDULER_INTERVAL_MS);
    void this.loadLibrary();
    const pending = this.pendingRoomTrack;
    if (pending) { this.pendingRoomTrack = null; void this.playRoomTrack(pending.path, pending.options); }
  }

  updatePreferences(preferences: Preferences): void {
    this.preferences = preferences;
    this.applyBusLevels();
  }

  /** Personagem masculino ou feminino: só os arquivos do gênero certo (ou neutros) tocam. */
  setVoiceGender(gender: VoiceGender): void {
    if (this.voiceGender === gender) return;
    this.voiceGender = gender;
    this.recent.clear();
  }

  /** Define a categoria de música desejada; a troca acontece com fade. */
  setMusic(category: string | null): void {
    if (this.requestedMusic === category) return;
    this.requestedMusic = category;
    if (this.music && this.music.category !== category) this.fadeOutMusic();
    if (category) {
      this.nextAllowedAt.delete(category);
      void this.loadLibrary();
    }
    this.updateMusicScheduling();
  }

  /**
   * Toca um som da categoria respeitando o intervalo aleatório, o cooldown e a chance opcional.
   * Pensado para ser chamado a cada quadro enquanto a condição existir.
   * Retorna `true` quando a execução foi disparada.
   */
  maybePlaySample(category: string, options: SampleOptions = {}): boolean {
    const ready = this.categoryReady(category);
    if (!ready) return false;
    const { config, clips } = ready;
    const now = Date.now();
    const allowedAt = this.nextAllowedAt.get(category);
    if (allowedAt === undefined) {
      // Primeira vez que a condição aparece: espera um pedaço aleatório do intervalo.
      this.nextAllowedAt.set(category, now + this.randomGap(config) * (0.25 + Math.random() * 0.6));
      return false;
    }
    if (now < allowedAt) return false;
    if (!options.immediate && this.busy(config, now)) return false;
    if (options.chance !== undefined && Math.random() > options.chance) return false;
    return this.playCategory(category, config, clips, options);
  }

  /** Verdadeiro enquanto outro efeito (ou outro som do mesmo grupo) ainda está soando. */
  private busy(config: CategoryConfig, now: number): boolean {
    if (config.bus === 'music') return false;
    if (now < this.effectBusyUntil) return true;
    const group = config.group;
    return group !== undefined && now < (this.groupBusyUntil.get(group) ?? 0);
  }

  /**
   * Reserva a janela em que nenhum outro efeito pode entrar: a duração do arquivo
   * mais o espaçamento mínimo. Chamado com a estimativa ao disparar e de novo com a
   * duração real quando o arquivo já está decodificado.
   */
  private reserveEffectWindow(config: CategoryConfig, durationMs: number): void {
    if (config.bus === 'music') return;
    const until = Date.now() + durationMs + GLOBAL_FX_SPACING_MS;
    this.effectBusyUntil = Math.max(this.effectBusyUntil, until);
    const group = config.group;
    if (group !== undefined) this.groupBusyUntil.set(group, Math.max(this.groupBusyUntil.get(group) ?? 0, until));
  }

  private knownDurationMs(path: string): number | null {
    const buffer = this.buffers.get(path);
    return buffer ? buffer.duration * 1000 : null;
  }

  /** Som de evento (dano, esconder-se): ignora o intervalo aleatório, mas respeita o cooldown. */
  playSample(category: string, options: SampleOptions = {}): boolean {
    const ready = this.categoryReady(category);
    if (!ready) return false;
    return this.playCategory(category, ready.config, ready.clips, { ...options, immediate: true });
  }

  /**
   * Toca a categoria imediatamente, ignorando intervalo, cooldown e grupo exclusivo.
   * Existe para os botões do painel DEV ouvirem um som sob demanda.
   */
  forceSample(category: string, options: SampleOptions = {}): boolean {
    const ready = this.categoryReady(category, true);
    if (!ready) return false;
    // O painel DEV sempre corta o som atual: o novo entra limpo, sem sobreposição.
    this.stopEffects();
    return this.playCategory(category, ready.config, ready.clips, { ...options, immediate: true });
  }

  /** Corta agora todo efeito e vocalização de arquivo que ainda esteja soando. */
  stopEffects(): void {
    [...this.active].forEach((clip) => { if (clip.bus !== 'music') this.stopClip(clip); });
    this.effectBusyUntil = 0;
    this.groupBusyUntil.clear();
  }

  private stopClip(clip: ActiveClip): void {
    this.active.delete(clip);
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    try {
      clip.gain.gain.cancelScheduledValues(now);
      clip.gain.gain.setValueAtTime(Math.max(0.0001, clip.gain.gain.value), now);
      clip.gain.gain.linearRampToValueAtTime(0.0001, now + 0.04);
      clip.source.stop(now + 0.06);
    } catch { /* a fonte já havia terminado */ }
  }

  /**
   * ESC: o jogo inteiro emudece e o tempo do áudio congela, para que a faixa continue
   * exatamente de onde parou quando o menu fechar.
   */
  async pauseGameplay(): Promise<void> {
    if (this.gameplayPaused) return;
    this.gameplayPaused = true;
    if (this.scheduler) { clearInterval(this.scheduler); this.scheduler = null; }
    const context = this.context;
    if (context && context.state === 'running') { try { await context.suspend(); } catch { /* sem contexto ativo */ } }
  }

  async resumeGameplay(): Promise<void> {
    if (!this.gameplayPaused) return;
    this.gameplayPaused = false;
    const context = this.context;
    if (!context) return;
    if (context.state === 'suspended') { try { await context.resume(); } catch { /* ignorado */ } }
    if (!this.scheduler) this.scheduler = setInterval(() => this.updateMusicScheduling(), SCHEDULER_INTERVAL_MS);
  }

  get paused(): boolean { return this.gameplayPaused; }

  /** Volta ao menu: nada do jogo continua soando. */
  stopAll(): void {
    [...this.active].forEach((clip) => this.stopClip(clip));
    this.stopRoomTrack();
    this.setMusic(null);
    this.nowMusic = null;
    this.lastEffect = null;
    this.resetScheduling();
    void this.resumeGameplay();
  }

  // --- trilha presa a uma sala (item configurado no editor) ---

  /** Toca o arquivo que a sala exige. Enquanto ele soa, a trilha do nível fica fora. */
  async playRoomTrack(path: string, options: RoomTrackOptions): Promise<boolean> {
    const context = this.context;
    // Sem contexto o navegador ainda não liberou o áudio: a sala espera a liberação.
    if (!context) { this.pendingRoomTrack = { path, options }; return false; }
    if (this.gameplayPaused || this.preferences.masterVolume === 0 || this.preferences.musicVolume === 0) return false;
    if (this.roomTrack?.path === path && options.loop) return true;
    this.stopRoomTrack();
    this.fadeOutMusic();
    const buffer = await this.ensureBuffer(path);
    if (!buffer || !this.musicBus) return false;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = options.loop;
    const level = Math.max(0, Math.min(1, options.volume ?? 1));
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, level), now + 0.8);
    source.connect(gain).connect(this.musicBus);
    source.start(now);
    this.roomTrack = { path, mode: options.loop ? 'loop' : 'single', source, gain };
    source.onended = () => { if (this.roomTrack?.source === source) this.roomTrack = null; };
    return true;
  }

  stopRoomTrack(): void {
    this.pendingRoomTrack = null;
    const track = this.roomTrack;
    this.roomTrack = null;
    const context = this.context;
    if (!track || !context) return;
    const now = context.currentTime;
    try {
      track.gain.gain.cancelScheduledValues(now);
      track.gain.gain.setValueAtTime(Math.max(0.0001, track.gain.gain.value), now);
      track.gain.gain.linearRampToValueAtTime(0.0001, now + 0.5);
      track.source.onended = null;
      track.source.stop(now + 0.55);
    } catch { /* já parou */ }
  }

  get roomTrackPath(): string | null { return this.roomTrack?.path ?? null; }

  /** O que o painel DEV mostra: trilha atual, trilha da sala e último efeito ouvido. */
  nowPlaying(): NowPlaying {
    return {
      music: this.roomTrack ? null : this.nowMusic,
      roomTrack: this.roomTrack ? { file: clipFileName(this.roomTrack.path), mode: this.roomTrack.mode } : null,
      lastEffect: this.lastEffect,
    };
  }

  /** Esquece a programação de todas as categorias (troca de tela, novo jogo). */
  resetScheduling(): void {
    this.nextAllowedAt.clear();
    this.cooldownUntil.clear();
    this.recent.clear();
    this.groupBusyUntil.clear();
    this.effectBusyUntil = 0;
  }

  hasCategory(category: string): boolean {
    return (this.library.get(category)?.length ?? 0) > 0;
  }

  play(cue: Cue, pan = 0): void {
    const context = this.context;
    if (!context || this.gameplayPaused || this.preferences.masterVolume === 0 || this.preferences.effectsVolume === 0) return;
    const now = context.currentTime;
    if (cue === 'danger-silence') { this.duckAmbience(2 + Math.random() * 1.2); return; }
    const master = context.createGain();
    const panner = context.createStereoPanner();
    const cueLevel = cue === 'jumpscare' ? 0.7 * (0.25 + this.preferences.jumpscareIntensity * 0.75) : 0.272;
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
    this.stopRoomTrack();
    this.setMusic(null);
    if (this.scheduler) { clearInterval(this.scheduler); this.scheduler = null; }
  }

  private musicLevel(value: number): number { return value * this.preferences.masterVolume * this.preferences.musicVolume; }
  private effectsLevel(value: number): number { return value * this.preferences.masterVolume * this.preferences.effectsVolume; }
  private voiceLevel(value: number): number { return value * this.preferences.masterVolume * this.preferences.voiceVolume; }

  // --- amostras de arquivo (música e efeitos gravados) ---

  private createBuses(): void {
    const context = this.context;
    if (!context) return;
    this.musicBus = context.createGain();
    this.effectsBus = context.createGain();
    this.voiceBus = context.createGain();
    this.musicBus.connect(context.destination);
    this.effectsBus.connect(context.destination);
    this.voiceBus.connect(context.destination);
    this.applyBusLevels();
  }

  private applyBusLevels(): void {
    if (this.ambience) this.ambience.gain.gain.value = this.musicLevel(0.14) * (this.music ? AMBIENCE_DUCK : 1);
    if (this.musicBus) this.musicBus.gain.value = this.musicLevel(1);
    if (this.effectsBus) this.effectsBus.gain.value = this.effectsLevel(1);
    if (this.voiceBus) this.voiceBus.gain.value = this.voiceLevel(1);
  }

  private async loadLibrary(): Promise<void> {
    if (this.library.size > 0) return;
    if (!this.libraryRequest) {
      this.libraryRequest = (async () => {
        try {
          const response = await fetch(MANIFEST_URL, { cache: 'no-cache' });
          if (!response.ok) return;
          const payload = (await response.json()) as { files?: unknown };
          const files = Array.isArray(payload.files) ? payload.files.filter((file): file is string => typeof file === 'string') : [];
          this.library = buildLibrary(files);
        } catch {
          // Sem manifesto o jogo segue apenas com os sons sintéticos.
        }
      })();
    }
    await this.libraryRequest;
  }

  private categoryReady(category: string, ignoreCooldown = false): { config: CategoryConfig; clips: AudioClip[] } | null {
    if (!this.context || this.gameplayPaused || this.preferences.masterVolume === 0) return null;
    const config = configFor(category);
    if (config.bus === 'fx' && this.preferences.effectsVolume === 0) return null;
    if (config.bus === 'voice' && this.preferences.voiceVolume === 0) return null;
    if (config.bus === 'music' && this.preferences.musicVolume === 0) return null;
    const all = this.library.get(category);
    if (!all || all.length === 0) { void this.loadLibrary(); return null; }
    const clips = config.bus === 'voice' ? clipsForGender(all, this.voiceGender) : all;
    if (clips.length === 0) return null;
    if (!ignoreCooldown && Date.now() < (this.cooldownUntil.get(category) ?? 0)) return null;
    return { config, clips };
  }

  private playCategory(category: string, config: CategoryConfig, clips: AudioClip[], options: SampleOptions): boolean {
    const clip = this.pickClip(category, clips, config);
    if (!clip) return false;
    const now = Date.now();
    this.nextAllowedAt.set(category, now + Math.max(config.cooldownMs, this.randomGap(config)));
    this.cooldownUntil.set(category, now + config.cooldownMs);
    this.reserveEffectWindow(config, this.knownDurationMs(clip.path) ?? ESTIMATED_CLIP_MS);
    void this.playClip(clip, config, options.pan ?? 0);
    return true;
  }

  private randomGap(config: CategoryConfig): number {
    const [min, max] = config.gapMs;
    return min + Math.random() * Math.max(0, max - min);
  }

  private pickClip(category: string, clips: AudioClip[], config: CategoryConfig): AudioClip | null {
    const history = this.recent.get(category) ?? [];
    const clip = selectClip(clips, history, config);
    if (!clip) return null;
    this.recent.set(category, [...history, clip.path].slice(-2));
    return clip;
  }

  private async ensureBuffer(path: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(path)) return this.buffers.get(path) ?? null;
    const existing = this.pending.get(path);
    if (existing) return existing;
    const request = (async () => {
      try {
        const response = await fetch(encodeURI(path));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        const buffer = await this.context!.decodeAudioData(data);
        this.buffers.set(path, buffer);
        return buffer;
      } catch {
        this.buffers.set(path, null);
        return null;
      } finally {
        this.pending.delete(path);
      }
    })();
    this.pending.set(path, request);
    return request;
  }

  /** Toda amostra entra com uma leve variação de afinação e sai com fade. */
  private async playClip(clip: AudioClip, config: CategoryConfig, pan: number): Promise<void> {
    const buffer = await this.ensureBuffer(clip.path);
    const context = this.context;
    if (!buffer || !context) return;
    // A categoria de música pode ter mudado enquanto o arquivo carregava.
    if (config.bus === 'music' && this.requestedMusic !== clip.category) return;
    const bus = config.bus === 'music' ? this.musicBus : config.bus === 'voice' ? this.voiceBus : this.effectsBus;
    if (!bus) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * config.pitch;
    const duration = buffer.duration / source.playbackRate.value;
    // Agora a duração verdadeira é conhecida: ajusta a janela de exclusividade.
    this.reserveEffectWindow(config, duration * 1000);
    const level = Math.min(1, config.volume * clipGain(clip.path));
    const fadeIn = Math.min(config.fadeInMs / 1000, duration * 0.4);
    const fadeOut = Math.min(config.fadeOutMs / 1000, duration * 0.5);
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(level, now + Math.max(0.01, fadeIn));
    gain.gain.setValueAtTime(level, now + Math.max(0.01, duration - fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    // A voz do personagem sai do próprio corpo: sempre centrada, nos dois ouvidos.
    const effectivePan = config.bus === 'voice' ? 0 : pan;
    if (effectivePan !== 0) {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, effectivePan));
      source.connect(gain).connect(panner).connect(bus);
    } else source.connect(gain).connect(bus);
    source.start(now);
    source.stop(now + duration + 0.05);
    const entry: ActiveClip = { source, gain, bus: config.bus };
    this.active.add(entry);
    source.onended = () => this.active.delete(entry);
    if (config.bus === 'music') {
      this.music = { category: clip.category, source, gain, nextTrackAt: Date.now() + duration * 1000 + this.randomGap(config) };
      this.nowMusic = { label: categoryLabel(clip.category), file: clipFileName(clip.path) };
      this.applyBusLevels();
    } else {
      this.lastEffect = { label: categoryLabel(clip.category), file: clipFileName(clip.path), at: Date.now() };
    }
  }

  private updateMusicScheduling(): void {
    const category = this.requestedMusic;
    if (!this.context || this.gameplayPaused) return;
    // A trilha presa à sala tem prioridade: enquanto ela toca, o nível fica calado.
    if (this.roomTrack) return;
    if (!category) return;
    if (this.music && this.music.category === category && Date.now() < this.music.nextTrackAt) return;
    if (this.music && this.music.category === category) this.music = null;
    this.maybePlayMusicTrack(category);
  }

  private maybePlayMusicTrack(category: string): void {
    const ready = this.categoryReady(category);
    if (!ready) return;
    const clip = this.pickClip(category, ready.clips, ready.config);
    if (!clip) return;
    this.cooldownUntil.set(category, Date.now() + ready.config.cooldownMs);
    // Reserva a janela até a próxima faixa; playClip ajusta com a duração real.
    this.music = { category, source: null, gain: null, nextTrackAt: Date.now() + 30000 };
    void this.playClip(clip, ready.config, 0);
  }

  private fadeOutMusic(): void {
    const context = this.context;
    const playing = this.music;
    this.music = null;
    this.nowMusic = null;
    this.applyBusLevels();
    if (!context || !playing?.source || !playing.gain) return;
    const now = context.currentTime;
    const fade = configFor(playing.category).fadeOutMs / 1000;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(Math.max(0.0001, playing.gain.gain.value), now);
    playing.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
    try { playing.source.stop(now + fade + 0.05); } catch { /* já parou */ }
  }

  private tones(context: AudioContext, target: AudioNode, now: number, cue: Cue): void {
    const frequencies: Record<string, number[]> = {
      click: [210], step: [68, 53], pickup: [440, 660], use: [330, 495, 660], locked: [82, 67], escape: [220, 330, 440, 660],
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
