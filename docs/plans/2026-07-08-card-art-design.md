# Card Art Design

## Goal

Replace emoji-led card presentation with 36 square, semi-realistic science-fiction illustrations that remain readable at mobile size and make build identity immediately visible.

## Art direction

- 512 x 512 PNG artwork, displayed behind the existing card information.
- One centered subject with a strong silhouette, shallow environmental depth, and restrained detail near the edges.
- Dark tactical science-fiction setting, cinematic materials, controlled bloom, and no text, logos, borders, frames, or watermarks inside the artwork.
- Each image carries a narrow family palette so cards remain recognizable by school: fire, frost, storm, orbit, fortress, economy, rail, and tactician.
- Rarity is communicated by the dominant rim light and UI frame, rather than by changing illustration quality.

## Rarity palette

- Common: steel blue-gray, `#93a3b8`
- Rare: plasma blue, `#4aa3ff`
- Epic: void violet, `#c07dff`
- Legendary: solar gold, `#ffcf4a`

Rarity follows progression and rule complexity. Starter statistical cards are common; specialist rule cards are rare; build-defining origin and advanced synergy cards are epic; late multi-requirement origin cards are legendary.

## Production

Each card is generated as a distinct asset using the same master prompt plus a subject-specific brief. Files use the card id, for example `as.png` and `voidanchor.png`. A manifest maps card ids to artwork and rarity. The UI keeps all card names and numerical descriptions as HTML so generated images never need to render text.

## Integration

- Artwork is placed in `public/card-icons/` and loaded by card id.
- Card cells receive a rarity class and artwork layer.
- Existing color, icon, text, lock state, star controls, and accessibility information remain functional.
- Locked cards retain visible silhouettes but use reduced saturation and contrast.
- The UI falls back to the existing icon when an image is unavailable.

## Verification

- Confirm all 36 ids have files and manifest entries.
- Confirm cards remain readable at 320 px viewport width.
- Confirm locked, owned, equipped, and upgradeable states remain distinguishable.
- Run TypeScript build and the test suite.
