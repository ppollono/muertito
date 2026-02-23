// ── rules.js ───────────────────────────────────────────────
// All move validation logic.

// Can 'card' be placed on 'column' (central column)?
// column.topValue: 0=empty, 1-11=active, 12=complete (should not reach here)
function canPlayOnCentral(card, column) {
  if (column.topValue === 0) {
    // Only an Ace can open a column
    return card.value === 1;
  }
  if (column.topValue >= 12) return false; // already complete

  // K is a wildcard: can be played on any active column
  if (card.value === 13) return true;

  // Normal ascending order
  return card.value === column.topValue + 1;
}

// New topValue after placing 'card' on 'column'
function getNextTopValue(card, column) {
  if (card.value === 13) {
    // K acts as the next required value
    return column.topValue + 1;
  }
  return card.value;
}

// Is the column complete? (reached Q = 12)
function isColumnComplete(topValue) {
  return topValue >= 12;
}

// Can 'card' be placed on an auxiliary column?
// Owner: no restrictions (any card on top)
// Interference: must follow descending order
function canPlayOnAux(card, auxColumn, isInterference) {
  if (auxColumn.length === 0) return true;
  if (!isInterference) return true;

  const topCard = auxColumn[auxColumn.length - 1];
  return getComparisonValue(card.value) < getComparisonValue(topCard.value);
}

// Can 'card' be placed on the opponent's muerto pile?
// Rule: same suit as the visible top card, adjacent value (±1)
function canPlayOnOpponentMuerto(card, muertoTop) {
  if (!muertoTop) return false; // empty muerto: interference not possible
  if (card.suit !== muertoTop.suit) return false;
  return card.value === muertoTop.value - 1 || card.value === muertoTop.value + 1;
}

// Is the interference rule active?
// Activates when the visible top of the opponent's muerto is the 4 of hearts.
function interferenceActive(opponent) {
  if (opponent.muerto.length === 0) return false;
  const top = opponent.muerto[opponent.muerto.length - 1];
  return top.suit === 'hearts' && top.value === 4;
}

// Does 'player' have any valid move toward the central columns?
// Checks: hand, top of each aux column, top of muerto.
function hasAnyCentralMove(player, centralColumns) {
  const candidates = getCandidateCards(player);
  return centralColumns.some(col =>
    candidates.some(c => canPlayOnCentral(c, col))
  );
}

// Playable cards for a player (hand + aux tops + muerto top)
function getCandidateCards(player) {
  const cards = [...player.hand];
  for (const col of player.auxColumns) {
    if (col.length > 0) cards.push(col[col.length - 1]);
  }
  if (player.muerto.length > 0) {
    cards.push(player.muerto[player.muerto.length - 1]);
  }
  return cards;
}

// Does the player hold an Ace in hand with at least one empty central column?
function hasAceWithEmptyColumn(player, centralColumns) {
  return player.hand.some(c => c.value === 1) &&
         centralColumns.some(col => col.topValue === 0);
}

// Has the player met the win condition?
// Wins when muerto is empty AND:
//   - hand is also empty, OR
//   - hand has exactly 1 card that is not an Ace
function hasPlayerWon(player) {
  if (player.muerto.length !== 0) return false;
  if (player.hand.length === 0) return true;
  if (player.hand.length === 1 && player.hand[0].value !== 1) return true;
  return false;
}

// Returns true if 'card' is the top of the player's muerto pile
function isTopOfMuerto(card, player) {
  if (player.muerto.length === 0) return false;
  return player.muerto[player.muerto.length - 1].id === card.id;
}

// Returns the aux column index if 'card' is its top, otherwise -1
function isTopOfAux(card, player) {
  for (let i = 0; i < player.auxColumns.length; i++) {
    const col = player.auxColumns[i];
    if (col.length > 0 && col[col.length - 1].id === card.id) return i;
  }
  return -1;
}

// Finds a card by id in hand, aux top, or muerto top
function findCard(player, cardId) {
  // Hand
  const handIdx = player.hand.findIndex(c => c.id === cardId);
  if (handIdx !== -1) {
    return { card: player.hand[handIdx], source: 'hand', sourceIndex: handIdx };
  }
  // Aux column tops
  for (let i = 0; i < player.auxColumns.length; i++) {
    const col = player.auxColumns[i];
    if (col.length > 0 && col[col.length - 1].id === cardId) {
      return { card: col[col.length - 1], source: 'aux', sourceIndex: i };
    }
  }
  // Muerto top
  if (player.muerto.length > 0 && player.muerto[player.muerto.length - 1].id === cardId) {
    return { card: player.muerto[player.muerto.length - 1], source: 'muerto', sourceIndex: 0 };
  }
  return { card: null, source: null, sourceIndex: -1 };
}

// Removes a card from its source location
function removeCardFromSource(player, source, sourceIndex) {
  if (source === 'hand') {
    player.hand.splice(sourceIndex, 1);
  } else if (source === 'aux') {
    player.auxColumns[sourceIndex].pop();
  } else if (source === 'muerto') {
    player.muerto.pop();
  }
}
