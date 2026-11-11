import { createPortal } from 'react-dom';
import Card from './Card.jsx';

const CARD_RATIO = 467 / 657; // width / height
const GAP = 16; // px between the hovered card and the preview
const EDGE = 12; // px kept clear of the viewport edges
const MAX_WIDTH = 320;

// Enlarged, read-only copy of a card shown while another card is hovered.
// Rendered into <body> so scroll areas and rotated parents (the opponent's mat) can't clip or flip it.
//   placement 'above': over the anchor (hand cards)   'side': to the right or left of the anchor (board cards)
export default function CardPreview({ card, rect, placement = 'side' }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let style;

  if (placement === 'above') {
    const maxH = Math.max(200, rect.top - GAP - EDGE);
    const width = Math.min(MAX_WIDTH, maxH * CARD_RATIO, vw - EDGE * 2);
    const left = clamp(rect.left + rect.width / 2 - width / 2, EDGE, vw - width - EDGE);
    style = { width, left, bottom: Math.max(EDGE, vh - rect.top + GAP) };
  } else {
    const width = Math.min(MAX_WIDTH, (vh - EDGE * 2) * CARD_RATIO, vw - EDGE * 2);
    const height = width / CARD_RATIO;
    const roomRight = vw - rect.right - GAP - EDGE;
    const left = roomRight >= width ? rect.right + GAP : Math.max(EDGE, rect.left - GAP - width);
    const top = clamp(rect.top + rect.height / 2 - height / 2, EDGE, vh - height - EDGE);
    style = { width, left, top };
  }

  return createPortal(
    <div className="card-preview-float" style={style} aria-hidden="true">
      <Card card={card} />
    </div>,
    document.body,
  );
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// Small helper for components: returns handlers + state for hover previews.
export const hoverRect = (e) => e.currentTarget.getBoundingClientRect();
