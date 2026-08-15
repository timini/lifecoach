export interface DispatchQueueState {
  active: boolean;
  queued: number;
}

interface QueueEntry<T> {
  value: T;
  resolve: () => void;
}

/** Serialises chat turns while allowing callers to enqueue immediately. */
export class SerialDispatchQueue<T> {
  private readonly entries: QueueEntry<T>[] = [];
  private active = false;

  constructor(
    private readonly dispatch: (value: T) => Promise<void>,
    private readonly onStateChange: (state: DispatchQueueState) => void,
  ) {}

  enqueue(value: T): Promise<void> {
    const completed = new Promise<void>((resolve) => {
      this.entries.push({ value, resolve });
    });
    this.emitState();
    void this.drain();
    return completed;
  }

  private async drain(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.emitState();
    try {
      for (;;) {
        const entry = this.entries.shift();
        if (!entry) break;
        this.emitState();
        try {
          await this.dispatch(entry.value);
        } catch {
          // One failed turn must not strand later user messages.
        } finally {
          entry.resolve();
        }
      }
    } finally {
      this.active = false;
      this.emitState();
    }
  }

  private emitState(): void {
    this.onStateChange({ active: this.active, queued: this.entries.length });
  }
}
