// ── ai.js ──────────────────────────────────────────────────
// CPU decision-making logic.

const CPU_DELAY_MS = 1000; // pause between CPU moves (ms)

// Executes the CPU's full turn asynchronously
function runCpuTurn(state, callbacks) {
  return new Promise((resolve) => {
    _cpuStep(state, callbacks, resolve);
  });
}

function _cpuStep(state, callbacks, done) {
  // Bail out if the game ended during a previous step
  if (state.phase !== "playing") {
    done();
    return;
  }

  const cpu = state.players.cpu;

  // 1. Try to play from muerto to central column (highest priority: clear the muerto)
  if (cpu.muerto.length > 0) {
    const topMuerto = cpu.muerto[cpu.muerto.length - 1];
    const centralIdx = _bestCentralColumn(topMuerto, state.centralColumns);
    if (centralIdx !== -1) {
      setTimeout(() => {
        callbacks.playToCentral("cpu", topMuerto.id, centralIdx);
        _cpuStep(state, callbacks, done);
      }, CPU_DELAY_MS);
      return;
    }
  }

  // 2. Try to play from hand to central column
  const handPlay = _findBestHandPlay(cpu.hand, state.centralColumns, state.players.human);
  if (handPlay) {
    setTimeout(() => {
      callbacks.playToCentral("cpu", handPlay.card.id, handPlay.colIdx);
      _cpuStep(state, callbacks, done);
    }, CPU_DELAY_MS);
    return;
  }

  // 3. Try to play an aux top to a central column.
  // Priority: moves that directly enable the muerto top card this turn.
  const muertoTop = cpu.muerto.length > 0 ? cpu.muerto[cpu.muerto.length - 1] : null;
  const auxPlay = _findBestAuxPlay(cpu.auxColumns, state.centralColumns, muertoTop);
  if (auxPlay) {
    setTimeout(() => {
      callbacks.playToCentral("cpu", auxPlay.card.id, auxPlay.colIdx);
      _cpuStep(state, callbacks, done);
    }, CPU_DELAY_MS);
    return;
  }

  // 3b. No muerto-enabling aux play found — still try any aux → central move
  // to advance central columns and free up aux space.
  const anyAuxPlay = _findAnyAuxPlay(cpu.auxColumns, state.centralColumns, state.players.human);
  if (anyAuxPlay) {
    setTimeout(() => {
      callbacks.playToCentral("cpu", anyAuxPlay.card.id, anyAuxPlay.colIdx);
      _cpuStep(state, callbacks, done);
    }, CPU_DELAY_MS);
    return;
  }

  // 4. No central moves → send a card to the opponent's muerto (interference)
  //    or store in own aux for future use. Returns null if only Aces remain.
  if (cpu.hand.length > 0) {
    const humanMuertoTop =
      state.players.human.muerto.length > 0
        ? state.players.human.muerto[state.players.human.muerto.length - 1]
        : null;
    const interferenceCard = _chooseBestInterferenceCard(
      cpu.hand,
      cpu.auxColumns,
      state.centralColumns,
      humanMuertoTop,
    );
    if (!interferenceCard) {
      // Only Aces in hand and no valid target: end turn without placing
      setTimeout(() => {
        callbacks.endTurn();
        done();
      }, CPU_DELAY_MS);
      return;
    }
    if (interferenceCard.target === "opponent") {
      setTimeout(() => {
        callbacks.playToOpponentMuerto("cpu", interferenceCard.card.id);
        // Interference does NOT end the turn — keep trying more moves
        _cpuStep(state, callbacks, done);
      }, CPU_DELAY_MS);
      return;
    }
    // target === 'aux': store for future use
    const auxIdx = _chooseBestAuxColumn(interferenceCard.card, cpu.auxColumns);
    setTimeout(() => {
      callbacks.playToAux("cpu", interferenceCard.card.id, auxIdx, "cpu");
      callbacks.endTurn();
      done();
    }, CPU_DELAY_MS);
    return;
  }

  // Hand is empty (should not happen normally): end turn
  setTimeout(() => {
    callbacks.endTurn();
    done();
  }, CPU_DELAY_MS);
}

// Returns true if advancing a central column to newTopValue hands the human
// an immediate sequential move (i.e. the human holds newTopValue+1).
// K wildcards are excluded: they're always playable so aren't "gifted".
function _willGiftHuman(newTopValue, humanPlayer) {
  if (newTopValue === 0 || newTopValue >= 12) return false;
  const needed = newTopValue + 1;
  return getCandidateCards(humanPlayer).some((c) => c.value === needed);
}

// Returns the index of the best central column to play 'card' on, or -1
function _bestCentralColumn(card, centralColumns) {
  // Prefer the column that is furthest along (highest topValue that accepts the card)
  let best = -1;
  let bestTop = -1;
  for (let i = 0; i < centralColumns.length; i++) {
    if (canPlayOnCentral(card, centralColumns[i])) {
      if (centralColumns[i].topValue > bestTop) {
        bestTop = centralColumns[i].topValue;
        best = i;
      }
    }
  }
  return best;
}

// Finds the best hand card to play to a central column.
// Prefers non-gifting moves; falls back to gifting only if no better option exists.
function _findBestHandPlay(hand, centralColumns, humanPlayer) {
  // Sort hand: Ace first, then ascending
  const sorted = [...hand].sort((a, b) => {
    if (a.value === 1) return -1;
    if (b.value === 1) return 1;
    return a.value - b.value;
  });
  let giftingFallback = null;
  for (const card of sorted) {
    const colIdx = _bestCentralColumn(card, centralColumns);
    if (colIdx === -1) continue;
    const newTop = getNextTopValue(card, centralColumns[colIdx]);
    if (!_willGiftHuman(newTop, humanPlayer)) {
      return { card, colIdx };
    }
    if (!giftingFallback) giftingFallback = { card, colIdx };
  }
  return giftingFallback;
}

// Finds the best aux top to play to a central column.
// Only plays from aux when it directly enables the muerto card in the same step.
function _findBestAuxPlay(auxColumns, centralColumns, muertoTop) {
  if (!muertoTop) return null; // no muerto card to enable

  for (let i = 0; i < auxColumns.length; i++) {
    const col = auxColumns[i];
    if (col.length === 0) continue;
    const top = col[col.length - 1];
    const colIdx = _bestCentralColumn(top, centralColumns);
    if (colIdx === -1) continue;

    // K in muerto plays on any active column, so any aux advance is valid
    if (muertoTop.value === 13) return { card: top, colIdx };

    // Calculate the column's new state AFTER placing this aux card
    const currentTop = centralColumns[colIdx].topValue;
    const newTopValue = top.value === 13 ? currentTop + 1 : top.value;

    if (newTopValue >= 12) {
      // This play completes the column; it resets to empty and needs an Ace next
      if (muertoTop.value === 1) return { card: top, colIdx };
    } else {
      // Normal case: column will next need newTopValue+1 (or K, handled above)
      if (muertoTop.value === newTopValue + 1) return { card: top, colIdx };
    }
  }
  return null;
}

// Finds any aux top that can be played to a central column.
// Prefers non-gifting moves; among equal options picks the furthest-along column.
function _findAnyAuxPlay(auxColumns, centralColumns, humanPlayer) {
  let bestNonGifting = null;
  let bestNonGiftingTop = -1;
  let bestGifting = null;
  let bestGiftingTop = -1;

  for (let i = 0; i < auxColumns.length; i++) {
    const col = auxColumns[i];
    if (col.length === 0) continue;
    const top = col[col.length - 1];
    const colIdx = _bestCentralColumn(top, centralColumns);
    if (colIdx === -1) continue;
    const newTop = getNextTopValue(top, centralColumns[colIdx]);
    const colTopValue = centralColumns[colIdx].topValue;

    if (!_willGiftHuman(newTop, humanPlayer)) {
      if (colTopValue > bestNonGiftingTop) {
        bestNonGiftingTop = colTopValue;
        bestNonGifting = { card: top, colIdx };
      }
    } else {
      if (colTopValue > bestGiftingTop) {
        bestGiftingTop = colTopValue;
        bestGifting = { card: top, colIdx };
      }
    }
  }
  return bestNonGifting || bestGifting;
}

// Chooses which hand card to place in aux when there are no central moves.
// Aces cannot go to aux; returns null if no valid card exists.
function _chooseCardForAux(hand, auxColumns) {
  const pool = hand.filter((c) => c.value !== 1);
  if (pool.length === 0) return null; // only Aces remain: cannot place in aux

  // Prefer Q first (per game rules strategy)
  const queen = pool.find((c) => c.value === 12);
  if (queen) return queen;

  // Otherwise pick the card with the highest comparison value
  return pool.reduce((best, c) =>
    getComparisonValue(c.value) > getComparisonValue(best.value) ? c : best,
  );
}

// Decides whether to send a card to the opponent's muerto (interference)
// or store it in own aux.
// Returns { card, target: 'opponent' | 'aux' }
function _chooseBestInterferenceCard(hand, auxColumns, centralColumns, humanMuertoTop) {
  // Look for valid cards to send to opponent's muerto (same suit, value ±1)
  if (humanMuertoTop) {
    const candidates = [];
    for (const card of hand) {
      if (canPlayOnOpponentMuerto(card, humanMuertoTop)) candidates.push(card);
    }
    for (const col of auxColumns) {
      if (col.length > 0) {
        const top = col[col.length - 1];
        if (canPlayOnOpponentMuerto(top, humanMuertoTop)) candidates.push(top);
      }
    }
    if (candidates.length > 0) {
      // Prefer Q, then highest comparison value
      const queen = candidates.find((c) => c.value === 12);
      if (queen) return { card: queen, target: "opponent" };
      const best = candidates.reduce((a, b) =>
        getComparisonValue(a.value) >= getComparisonValue(b.value) ? a : b,
      );
      return { card: best, target: "opponent" };
    }
  }

  // No valid interference card → try to store in own aux
  const card = _chooseCardForAux(hand, auxColumns);
  if (!card) return null; // only Aces in hand, cannot place anywhere
  return { card, target: "aux" };
}

// Chooses the most convenient aux column to place 'card' in
// Follows descending order: places the card on a column whose top is just above it
function _chooseBestAuxColumn(card, auxColumns) {
  let bestIdx = -1;
  let bestDiff = Infinity;

  for (let i = 0; i < auxColumns.length; i++) {
    const col = auxColumns[i];
    if (col.length === 0) {
      if (bestIdx === -1) bestIdx = i; // empty column as fallback
      continue;
    }
    const topVal = getComparisonValue(col[col.length - 1].value);
    const cardVal = getComparisonValue(card.value);
    // Card on top must have a lower value (descending)
    if (topVal > cardVal) {
      const diff = topVal - cardVal;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
  }

  // No ideal column found: use first empty or least occupied
  if (bestIdx === -1) {
    const emptyIdx = auxColumns.findIndex((c) => c.length === 0);
    bestIdx =
      emptyIdx !== -1
        ? emptyIdx
        : auxColumns.reduce((minI, c, i, arr) => (c.length < arr[minI].length ? i : minI), 0);
  }
  return bestIdx;
}
