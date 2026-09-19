/** Inline stroke icons. Single source so weight and sizing stay consistent. */
const S = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

/**
 * `directional` marks icons whose meaning depends on reading order, so they
 * mirror under RTL. Rotation icons deliberately do not: clockwise is physical.
 */
const Svg = ({ children, viewBox = '0 0 24 24', directional }: {
  children: React.ReactNode; viewBox?: string; directional?: boolean;
}) => (
  <svg viewBox={viewBox} aria-hidden="true" className={directional ? 'icon--directional' : undefined} {...S}>
    {children}
  </svg>
);

export const IconPages = () => (
  <Svg><path d="M9 3h7l5 5v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" /><path d="M15 3v6h6" /></Svg>
);
export const IconMerge = () => (
  <Svg directional><path d="M4 5h9a4 4 0 0 1 4 4v6" /><path d="M4 19h9a4 4 0 0 0 4-4V9" /><path d="m17 6 3 3-3 3" /></Svg>
);
export const IconSplit = () => (
  <Svg directional><path d="M4 12h6" /><path d="M14 6h6M14 18h6" /><path d="M10 12 14 6M10 12l4 6" /></Svg>
);
export const IconImage = () => (
  <Svg><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L20 21" /></Svg>
);
export const IconOcr = () => (
  <Svg><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M8 12h8M8 15h5" /></Svg>
);
export const IconCompress = () => (
  <Svg><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" /><path d="M9 12h6" /></Svg>
);
export const IconInfo = () => (
  <Svg><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>
);
export const IconUpload = () => (
  <Svg><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 17v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1" /></Svg>
);
export const IconCheck = () => (
  <Svg><path d="m4 12 5 5L20 6" /></Svg>
);
export const IconRotate = () => (
  <Svg><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 3v5h-5" /></Svg>
);
export const IconTrash = () => (
  <Svg><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" /></Svg>
);
export const IconGrip = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
    <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);
export const IconWarn = () => (
  <Svg><path d="M12 4.5 2.8 20h18.4L12 4.5Z" /><path d="M12 10v4M12 17h.01" /></Svg>
);
export const IconShield = () => (
  <Svg><path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3Z" /></Svg>
);
export const IconFolder = () => (
  <Svg><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></Svg>
);
export const IconSpinner = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="spin" {...S}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);

/* ------------------------------------------------------------------ reader */

export const IconReader = () => (
  <Svg><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 1 3 14.5Z" /><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h4.5a2.5 2.5 0 0 0 2.5-2.5Z" /></Svg>
);
export const IconSearch = () => (
  <Svg><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>
);
export const IconZoomIn = () => (
  <Svg><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /><path d="M8.5 11h5M11 8.5v5" /></Svg>
);
export const IconZoomOut = () => (
  <Svg><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /><path d="M8.5 11h5" /></Svg>
);
export const IconFitWidth = () => (
  <Svg><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 12h10" /><path d="m9 10-2 2 2 2M15 10l2 2-2 2" /></Svg>
);
export const IconFitPage = () => (
  <Svg><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M12 7v10" /><path d="m10 9 2-2 2 2M10 15l2 2 2-2" /></Svg>
);
export const IconSidebar = () => (
  <Svg><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9.5 4v16" /></Svg>
);
export const IconChevronUp = () => (
  <Svg><path d="m6 14 6-6 6 6" /></Svg>
);
export const IconChevronDown = () => (
  <Svg><path d="m6 10 6 6 6-6" /></Svg>
);
export const IconClose = () => (
  <Svg><path d="m6 6 12 12M18 6 6 18" /></Svg>
);

export const IconHighlight = () => (
  <Svg><path d="M4 20h16" /><path d="m7 16 9-9a2.5 2.5 0 0 1 3.5 3.5l-9 9H7Z" /><path d="M14 5.5 18.5 10" /></Svg>
);
export const IconUnderline = () => (
  <Svg><path d="M7 4v7a5 5 0 0 0 10 0V4" /><path d="M5 20h14" /></Svg>
);
export const IconStrikeout = () => (
  <Svg><path d="M5 12h14" /><path d="M8 7.5A3.5 3.5 0 0 1 11.5 5h1A3.5 3.5 0 0 1 16 8" /><path d="M8 16a3.5 3.5 0 0 0 3.5 3h1A3.5 3.5 0 0 0 16 15.5" /></Svg>
);
export const IconNote = () => (
  <Svg><path d="M20 4H4v12h4v4l5-4h7Z" /></Svg>
);
export const IconForm = () => (
  <Svg><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 12h5" /><path d="M16 9.5v5" /></Svg>
);
export const IconSave = () => (
  <Svg><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M8 3v6h7" /><rect x="7" y="13" width="10" height="6" rx="1" /></Svg>
);
export const IconUndo = () => (
  <Svg directional><path d="M4 9h11a5 5 0 0 1 0 10h-4" /><path d="m8 5-4 4 4 4" /></Svg>
);

export const IconInk = () => (
  <Svg><path d="M3 21c2.5 0 3-2 3-4s.5-3 2-3 2 1 2 2.5S9 19 7 19" /><path d="m11 14 8-8a2.1 2.1 0 0 0-3-3l-8 8" /><path d="m14.5 5.5 3 3" /></Svg>
);

export const IconScan = () => (
  <Svg><path d="M3 8V6a3 3 0 0 1 3-3h2" /><path d="M16 3h2a3 3 0 0 1 3 3v2" /><path d="M21 16v2a3 3 0 0 1-3 3h-2" /><path d="M8 21H6a3 3 0 0 1-3-3v-2" /><path d="M7 12h10" /></Svg>
);

export const IconCrop = () => (
  <Svg><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M2 6h14a2 2 0 0 1 2 2v14" /></Svg>
);
export const IconRescan = () => (
  <Svg><path d="M3 8V6a3 3 0 0 1 3-3h2" /><path d="M16 3h2a3 3 0 0 1 3 3v2" /><path d="M21 16v2a3 3 0 0 1-3 3h-2" /><path d="M8 21H6a3 3 0 0 1-3-3v-2" /><circle cx="12" cy="12" r="3" /></Svg>
);
