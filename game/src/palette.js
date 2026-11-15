// The look plan, in one place: a desert freight yard at dusk. Six values only; the
// lighting makes every shade the game needs, so no other colour appears in the code.
// The same six names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191410', // deep warm dark: sky, fog, floor shadow
  surface: '#2a2118', // sand-dark: walls, containers
  hairline: '#4a3826', // rust brown: crates, cover, enemy gear
  ink: '#f5ead6', // warm off-white: markings, player-side trim
  muted: '#b39b78', // dusty tan: barrels, secondary props
  accent: '#ff7a1a', // ember orange: bombsite, enemy helmets, the one hot colour
};

export function shade(name) {
  return PALETTE[name];
}
