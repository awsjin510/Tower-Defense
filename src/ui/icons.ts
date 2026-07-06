export type IconName =
  | 'workshop' | 'cards' | 'research' | 'ultimate' | 'attack' | 'defense' | 'economy'
  | 'coin' | 'cash' | 'health' | 'wave' | 'zone' | 'speed' | 'user' | 'lock'
  | 'fire' | 'frost' | 'risk' | 'perk' | 'play' | 'copy';

const paths: Record<IconName, string> = {
  workshop: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a6 6 0 0 1-7.9 7.9l-5.7 5.7a2 2 0 0 1-3-3l5.7-5.7a6 6 0 0 1 7.9-7.9z"/>',
  cards: '<rect x="3" y="5" width="14" height="16" rx="2"/><path d="m7 5 2-2h10a2 2 0 0 1 2 2v12l-4 2"/><path d="M7 10h6M7 14h4"/>',
  research: '<path d="M9 3h6M10 9l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3h-4z"/><path d="M7.5 16h9"/>',
  ultimate: '<path d="m13 2-9 12h7l-1 8 9-12h-7z"/>',
  attack: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  defense: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-5"/>',
  economy: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c-.8-1-1.8-1.5-3-1.5-1.7 0-3 1-3 2.3 0 3.7 6 1.7 6 5 0 1.5-1.3 2.7-3 2.7-1.4 0-2.6-.6-3.4-1.7"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 9h.01M18 15h.01"/>',
  health: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"/>',
  wave: '<path d="M3 12h3l2-7 4 14 3-9 2 2h4"/>',
  zone: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  speed: '<path d="M4 12a8 8 0 1 0 2.3-5.7M12 12l5-5M4 4v5h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  fire: '<path d="M12 22c4 0 7-3 7-7 0-5-4-8-6-12 0 4-2 6-4 8-1-2-1-3-1-4-2 2-3 5-3 8 0 4 3 7 7 7z"/><path d="M12 22c2 0 3.5-1.5 3.5-3.5 0-2-1.5-3.5-3.5-5.5 0 2-1 3-2 4-1 1-1.5 2-1.5 3 0 1.5 1.5 2.5 3.5 2.5z"/>',
  frost: '<path d="M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11M9 4l3 3 3-3M9 20l3-3 3 3"/>',
  risk: '<path d="M10.3 3.6 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  perk: '<path d="m12 2 2.8 5.7L21 8.6l-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 8.6l6.2-.9z"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
};

export function icon(name: IconName, label = ''): string {
  return `<svg class="ui-icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"'}>${paths[name]}</svg>`;
}
