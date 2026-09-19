import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconGrip, IconTrash } from './icons.js';
import { useT } from '../i18n/LocaleProvider.js';

export interface SortableCardProps {
  id: string;
  index: number;
  name: string;
  meta: React.ReactNode;
  /** Rendered into the thumbnail slot; usually a canvas or img element. */
  thumb?: HTMLElement | null;
  onRemove: () => void;
}

/**
 * A draggable file card. dnd-kit's sortable gives keyboard reordering for free,
 * which matters because a drag-only list is unusable without a mouse.
 */
export function SortableCard({ id, index, name, meta, thumb, onRemove }: SortableCardProps) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    if (thumb) el.replaceChildren(thumb); else el.replaceChildren();
  }, [thumb]);

  return (
    <div
      ref={setNodeRef}
      className="card"
      data-drag={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}
    >
      <button className="card__handle" aria-label={t('merge.reorder', { name })} {...attributes} {...listeners}>
        <IconGrip />
      </button>
      <span className="card__order">{index + 1}</span>
      <div className="card__thumb" ref={slot} />
      <div className="card__body">
        <div className="card__name" title={name}><bdi>{name}</bdi></div>
        <div className="card__meta">{meta}</div>
      </div>
      <button className="iconbtn" aria-label={t('merge.remove', { name })} title={t('merge.remove', { name })} onClick={onRemove}>
        <IconTrash />
      </button>
    </div>
  );
}

/** Render page 1 of a PDF (or an image) into a small canvas for a card thumbnail. */
export function useThumb(make: () => Promise<HTMLElement | null>, deps: unknown[]) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let alive = true;
    void make().then((node) => { if (alive) setEl(node); else node?.remove(); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return el;
}
