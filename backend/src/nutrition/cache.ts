export interface GenerationCacheOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class GenerationCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly now: () => number;

  constructor(private readonly options: GenerationCacheOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1 || options.maxEntries > 1000) {
      throw new Error("Cache size must be a whole number from 1 to 1000.");
    }
    if (!Number.isInteger(options.ttlMs) || options.ttlMs < 1 || options.ttlMs > 604800000) {
      throw new Error("Cache lifetime must be from 1 millisecond to 7 days.");
    }
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  }

  set(key: string, value: T): void {
    const cleanKey = key.trim();
    if (!cleanKey || cleanKey.length > 256) {
      throw new Error("Cache key must be from 1 to 256 characters.");
    }
    if (this.entries.has(cleanKey)) {
      this.entries.delete(cleanKey);
    }
    this.entries.set(cleanKey, {
      value: structuredClone(value),
      expiresAt: this.now() + this.options.ttlMs,
    });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }
}
