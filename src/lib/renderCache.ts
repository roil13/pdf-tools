/**
 * An LRU of rasterised pages.
 *
 * Until now nothing in the app cached a render: every thumbnail re-rasterised on
 * mount, which is survivable for a grid you look at once. A reader is different --
 * scrolling back up a long document would re-render every page it passes, and
 * pdf.js rasterisation is the most expensive thing the renderer does.
 *
 * Entries are `ImageBitmap`, not `<canvas>`, and that is the load-bearing choice.
 * A cached canvas can be mounted in the DOM, and evicting one while it is on
 * screen would blank it. A bitmap is drawn INTO the consumer's own canvas, so by
 * the time it can be evicted the pixels the user sees are already somewhere else.
 *
 * The budget is in bytes rather than entries because the same cache serves 130px
 * thumbnails (~70 KB) and full pages at device resolution (~20 MB). Counting
 * entries would either starve the grid or let the reader eat a gigabyte.
 */

/** Roughly what a bitmap costs in memory: 4 bytes per pixel. */
const bytesOf = (b: ImageBitmap) => b.width * b.height * 4;

export class RenderCache {
  /** Map iteration order is insertion order, which makes it an LRU on re-set. */
  private entries = new Map<string, ImageBitmap>();
  private bytes = 0;

  constructor(private readonly budgetBytes: number) {}

  get(key: string): ImageBitmap | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    // Re-insert so the most recently used sorts last and is evicted last.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, bitmap: ImageBitmap): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= bytesOf(existing);
      existing.close();
    }
    this.entries.set(key, bitmap);
    this.bytes += bytesOf(bitmap);
    this.evictDownToBudget();
  }

  /**
   * Drop everything belonging to one document. Called when a document closes:
   * its bitmaps are not merely stale, their keys can never be asked for again,
   * so leaving them would be a leak rather than a cache.
   */
  dropDocument(docId: string): void {
    const prefix = `${docId}:`;
    for (const [key, bitmap] of this.entries) {
      if (key.startsWith(prefix)) {
        this.bytes -= bytesOf(bitmap);
        bitmap.close();
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    for (const bitmap of this.entries.values()) bitmap.close();
    this.entries.clear();
    this.bytes = 0;
  }

  /** For tests and the debug readout. */
  get stats(): { count: number; bytes: number } {
    return { count: this.entries.size, bytes: this.bytes };
  }

  private evictDownToBudget(): void {
    // Never evict the entry just inserted, even if it alone exceeds the budget:
    // a single page larger than the whole budget should still display once.
    for (const [key, bitmap] of this.entries) {
      if (this.bytes <= this.budgetBytes || this.entries.size <= 1) break;
      this.bytes -= bytesOf(bitmap);
      bitmap.close();
      this.entries.delete(key);
    }
  }
}

/**
 * Cache key. Scale is quantised because a fit-width zoom produces scales that
 * differ in the twelfth decimal place between renders of the same layout, and an
 * un-quantised key would miss every time while filling the cache with near
 * duplicates.
 */
export function pageKey(
  docId: string, page: number, scale: number, rotation: number,
): string {
  return `${docId}:${page}:${Math.round(scale * 100)}:${rotation}`;
}

/** 192 MB holds roughly eight full-page spreads at device resolution. */
export const renderCache = new RenderCache(192 * 1024 * 1024);
