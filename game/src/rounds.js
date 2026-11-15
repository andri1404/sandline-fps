// Rounds: one small state machine. Buy phase (12 s, the shop is open), live phase
// (100 s on the clock), round end, then the next round. First to 5 rounds takes
// the match, at most 9 rounds. main.js asks this module what phase it is in.
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export function createRounds() {
  const state = {
    phase: 'menu', // menu | buy | live | aftermath | roundEnd | matchEnd
    round: 1,
    wins: 0,
    losses: 0,
    timer: ROUND_SECONDS,
    freeze: BUY_SECONDS,
    endReason: '',
    won: false,
  };

  return {
    state,
    startMatch() {
      state.phase = 'buy';
      state.round = 1;
      state.wins = 0;
      state.losses = 0;
      state.timer = ROUND_SECONDS;
      state.freeze = BUY_SECONDS;
      state.endReason = '';
      state.won = false;
    },
    startRound() {
      state.phase = 'buy';
      state.timer = ROUND_SECONDS;
      state.freeze = BUY_SECONDS;
      state.endReason = '';
      state.won = false;
    },
    endRound(won, reason) {
      if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
      state.won = won;
      state.endReason = reason;
      if (won) state.wins += 1;
      else state.losses += 1;
      const matchOver = state.wins >= WIN_ROUNDS || state.losses >= WIN_ROUNDS || state.round >= MAX_ROUNDS;
      state.phase = matchOver ? 'matchEnd' : 'roundEnd';
    },
    nextRound() {
      state.round += 1;
      this.startRound();
    },
    // Returns 'live' when the freeze ran out, 'timeout' when the clock hit zero.
    tick(dt) {
      if (state.phase === 'buy') {
        state.freeze -= dt;
        if (state.freeze <= 0) {
          state.phase = 'live';
          return 'live';
        }
        return null;
      }
      if (state.phase === 'live') {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.timer = 0;
          return 'timeout';
        }
      }
      return null;
    },
  };
}
