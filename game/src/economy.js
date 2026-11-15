// Money: earned per kill and per round, spent in the buy menu between rounds.
// Prices live with the shop list in weapons.js; this module owns the wallet.
export const REWARDS = {
  kill: 300,
  plant: 300,
  win: 3250,
  loss: 1900,
};

export const MAX_FLASH = 2;
export const MAX_SMOKE = 1;

export function createEconomy() {
  const state = { money: 800, armor: false, flash: 0, smoke: 0 };

  return {
    state,
    reset() {
      state.money = 800;
      state.armor = false;
      state.flash = 0;
      state.smoke = 0;
    },
    add(amount) {
      state.money += amount;
    },
    canAfford(price) {
      return state.money >= price;
    },
    // Buy one shop item. Returns true when the purchase went through.
    buy(id, price) {
      if (state.money < price) return false;
      if (id === 'armor') {
        if (state.armor) return false;
        state.armor = true;
      } else if (id === 'flash') {
        if (state.flash >= MAX_FLASH) return false;
        state.flash += 1;
      } else if (id === 'smoke') {
        if (state.smoke >= MAX_SMOKE) return false;
        state.smoke += 1;
      }
      state.money -= price;
      return true;
    },
    useFlash() {
      if (state.flash <= 0) return false;
      state.flash -= 1;
      return true;
    },
    useSmoke() {
      if (state.smoke <= 0) return false;
      state.smoke -= 1;
      return true;
    },
  };
}
