export type GameEventMap = {
  'gate:changed': { side: 'west' | 'east'; state: string };
  'energy:empty': undefined;
  'enemy:moved': { id: string; room: string; cue: string };
  'enemy:danger': { id: string; message: string };
  'enemy:attack': { id: string };
  'ritual:bell': { effective: boolean };
  'game:victory': undefined;
  'game:defeat': { id: string };
};

type Handler<T> = (payload: T) => void;

export class EventBus {
  private readonly listeners = new Map<keyof GameEventMap, Set<Handler<never>>>();

  on<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    this.listeners.set(event, set);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    this.listeners.get(event)?.forEach((handler) => handler(payload as never));
  }

  clear(): void { this.listeners.clear(); }
}
