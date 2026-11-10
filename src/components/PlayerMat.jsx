// One player's half of the board. Layout follows the reference playmat:
// 9-column grid (two narrow spacer columns: 3 and 6), 3 rows.
export const ZONES = [
  { id: 'spatial', label: 'Spatial', col: 7, row: 1 },
  { id: 'aether', label: 'Aether', col: 8, row: 1 },
  { id: 'idol', label: 'Idol', col: 9, row: 1 },

  { id: 'latent-1', label: 'Latent', col: 1, row: 2 },
  { id: 'latent-2', label: 'Latent', col: 5, row: 2 },
  { id: 'weapon', label: 'Weapon', col: 7, row: 2 },
  { id: 'shield', label: 'Shield', col: 8, row: 2 },
  { id: 'body-armor', label: 'Body Armor', col: 9, row: 2 },

  { id: 'discard', label: 'Discard', col: 1, row: 3 },
  { id: 'deck', label: 'Deck', col: 2, row: 3 },
  { id: 'ability-1', label: 'Ability Slot', col: 4, row: 3 },
  { id: 'ability-2', label: 'Ability Slot', col: 5, row: 3 },
  { id: 'incantation', label: 'Incantation', col: 7, row: 3, span: 3 },
];

export default function PlayerMat({ side, playerName }) {
  return (
    <section className={`player-mat ${side}`} aria-label={`${playerName}'s side`}>
      <div className="mat-watermark" aria-hidden="true">Strike!</div>
      <div className="mat-player">{playerName}</div>
      {ZONES.map((z) => (
        <div
          key={z.id}
          className="zone"
          data-zone={z.id}
          style={{ gridColumn: z.span ? `${z.col} / span ${z.span}` : z.col, gridRow: z.row }}
        >
          <span className="zone-label">{z.label}</span>
        </div>
      ))}
    </section>
  );
}
