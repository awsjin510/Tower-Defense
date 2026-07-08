export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary';

const RARITY_IDS: Record<CardRarity, readonly string[]> = {
  common: ['as', 'hp', 'coin', 'range', 'armorplate'],
  rare: ['crit', 'warchest', 'bounce', 'lifesteal', 'slowaura', 'barrier', 'penetrator', 'repulsor', 'elemental', 'elitehunter'],
  epic: [
    'emberstart', 'frostcore', 'interest', 'thorns', 'bossbane', 'strategist', 'voidreaver',
    'compound', 'salvage', 'thermalcore', 'glacialcore', 'stormcoil', 'orbitaldock',
  ],
  legendary: ['thermalshock', 'supercap', 'twinorbit', 'fortressorigin', 'execution', 'bountycharter', 'phaselens', 'voidanchor'],
};

const RARITY_BY_ID = new Map<string, CardRarity>(
  Object.entries(RARITY_IDS).flatMap(([rarity, ids]) => ids.map((id) => [id, rarity as CardRarity])),
);

export const CARD_RARITY_LABEL: Record<CardRarity, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史詩',
  legendary: '傳說',
};

export function cardRarity(id: string): CardRarity {
  return RARITY_BY_ID.get(id) ?? 'common';
}

export function cardArtUrl(id: string): string {
  return `${import.meta.env.BASE_URL}card-icons/${id}.png`;
}
