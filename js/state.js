// ── state.js ───────────────────────────────────────────────
// Initial game state and state utilities.

function createInitialState() {
  // Deck 1: split by color → muerto piles
  const deck1 = createDeck().map(c => ({ ...c, id: `1-${c.id}` }));
  const reds   = deck1.filter(c => c.color === 'red');   // hearts + diamonds
  const blacks = deck1.filter(c => c.color === 'black'); // spades + clubs

  const humanMuerto = shuffleDeck(reds);
  const cpuMuerto   = shuffleDeck(blacks);

  // Deck 2: shuffled → draw pile
  const drawPile = shuffleDeck(createDeck().map(c => ({ ...c, id: `2-${c.id}` })));

  // Determine who goes first: compare each player's muerto top card
  const humanTop = humanMuerto[humanMuerto.length - 1];
  const cpuTop   = cpuMuerto[cpuMuerto.length - 1];
  const humanCV  = getComparisonValue(humanTop.value);
  const cpuCV    = getComparisonValue(cpuTop.value);

  // Tie goes to the human player
  const firstTurn = humanCV >= cpuCV ? 'human' : 'cpu';

  // Both players draw 5 starting cards
  const humanHand = drawPile.splice(0, 5);
  const cpuHand   = drawPile.splice(0, 5);

  const startMsg = firstTurn === 'human'
    ? t('msg_start_human', { card: `${getValueLabel(humanTop.value)}${getSuitSymbol(humanTop.suit)}` })
    : t('msg_start_cpu',   { card: `${getValueLabel(cpuTop.value)}${getSuitSymbol(cpuTop.suit)}` });

  return {
    drawPile,           // remaining cards in the draw pile

    centralColumns: [
      { cards: [], topValue: 0 },
      { cards: [], topValue: 0 },
      { cards: [], topValue: 0 }
    ],

    players: {
      human: {
        id: 'human',
        color: 'red',
        muerto: humanMuerto,
        hand: humanHand,
        auxColumns: [[], [], []]
      },
      cpu: {
        id: 'cpu',
        color: 'black',
        muerto: cpuMuerto,
        hand: cpuHand,
        auxColumns: [[], [], []]
      }
    },

    currentTurn: firstTurn,
    phase: 'playing',  // 'playing' | 'gameover'
    winner: null,

    // UI state (does not affect game logic)
    selectedCardId: null,    // card currently selected by the human player
    mustPlaceInAux: false,   // player has no central moves available
    message: startMsg
  };
}

// Returns the opponent player object given a player id
function getOpponent(state, playerId) {
  return playerId === 'human' ? state.players.cpu : state.players.human;
}
