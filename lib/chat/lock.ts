/** Serialises work so only one provider request is in flight (free quotas are per key, not per user). */
export class Lock {
  private tail: Promise<void> = Promise.resolve();

  /** Resolves with a release function once every earlier holder has released. */
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const ready = this.tail.then(() => release);
    this.tail = this.tail.then(() => next);
    return ready;
  }
}
