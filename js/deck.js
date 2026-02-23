// ── deck.js ────────────────────────────────────────────────
// Card model, deck creation and shuffling.

const SUITS = ['hearts', 'diamonds', 'spades', 'clubs'];
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', spades: '♠', clubs: '♣' };
// value: 1=A, 2-10, 11=J, 12=Q, 13=K
const VALUE_LABELS = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

function getValueLabel(v) {
  return VALUE_LABELS[v] !== undefined ? VALUE_LABELS[v] : String(v);
}

function getSuitSymbol(suit) {
  return SUIT_SYMBOLS[suit];
}

function getCardColor(suit) {
  return (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
}

// Comparison value used to decide who goes first. Ace ranks highest.
function getComparisonValue(v) {
  return v === 1 ? 14 : v;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let value = 1; value <= 13; value++) {
      deck.push({
        id: `${suit}-${value}`,
        suit,
        value,
        color: getCardColor(suit)
      });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
