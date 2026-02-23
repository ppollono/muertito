// ── game.js ────────────────────────────────────────────────
// Main controller: orchestrates state, rules, AI and UI.

// Bump this when the state schema changes to invalidate old saved games.
const STATE_VERSION = 2;

const Game = (() => {
  let state = null;

  // ── INITIALIZATION ───────────────────────────────────────
  function init(forceNew = false) {
    if (!forceNew) {
      const saved = _tryLoadState();
      if (saved) {
        state = saved;
        state.selectedCardId = null;
        // Recalculate mustPlaceInAux in case the saved state had it stale
        if (state.currentTurn === 'human' && state.phase === 'playing') {
          state.mustPlaceInAux = !hasAnyCentralMove(state.players.human, state.centralColumns);
        }
        renderGame(state);
        showMessage(state.message || t('msg_game_restored'));
        if (state.currentTurn === 'cpu' && state.phase === 'playing') {
          _scheduleCpuTurn();
        }
        return;
      }
    }

    // New game
    try { localStorage.removeItem('muertito_state'); } catch (e) {}
    state = createInitialState();
    state.version = STATE_VERSION;

    if (state.currentTurn === 'human') {
      const human = state.players.human;
      if (!hasAnyCentralMove(human, state.centralColumns)) {
        state.mustPlaceInAux = true;
      }
    }

    renderGame(state);
    showMessage(state.message);

    if (state.currentTurn === 'cpu') {
      _scheduleCpuTurn();
    }
  }

  // Attempts to load state from localStorage; returns null if missing, corrupt or outdated
  function _tryLoadState() {
    try {
      const raw = localStorage.getItem('muertito_state');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.players || !parsed.centralColumns || !parsed.drawPile) return null;
      if (parsed.version !== STATE_VERSION) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  // ── CARD SELECTION ───────────────────────────────────────
  function selectCard(cardId) {
    if (state.currentTurn !== 'human' || state.phase !== 'playing') return;
    state.selectedCardId = cardId;
    renderGame(state);
  }

  function deselect() {
    state.selectedCardId = null;
    renderGame(state);
  }

  // ── PLAY TO CENTRAL COLUMN ──────────────────────────────
  function playToCentral(playerId, cardId, colIdx) {
    if (state.phase !== 'playing') return false;
    if (state.currentTurn !== playerId) return false;

    const player = state.players[playerId];
    const column = state.centralColumns[colIdx];
    const { card, source, sourceIndex } = findCard(player, cardId);

    if (!card) {
      showMessage(t('msg_card_not_found'));
      return false;
    }

    if (!canPlayOnCentral(card, column)) {
      showMessage(_cantPlayMsg(card, column));
      return false;
    }

    // Remove card from its source
    removeCardFromSource(player, source, sourceIndex);

    // Place on the column
    const newTop = getNextTopValue(card, column);
    column.cards.push(card);
    column.topValue = newTop;

    state.selectedCardId = null;
    state.mustPlaceInAux = false;

    // Column complete?
    if (isColumnComplete(column.topValue)) {
      _handleColumnComplete(colIdx);
    }

    // Did this player win?
    if (hasPlayerWon(player)) {
      state.phase  = 'gameover';
      state.winner = playerId;
      renderGame(state);
      showMessage(playerId === 'human' ? t('msg_human_wins') : t('msg_cpu_wins'));
      return true;
    }

    // Empty hand → draw 5, but only while there is still a muerto to clear
    // (if muerto is already 0, playing out the hand wins; no refill needed)
    if (player.hand.length === 0 && player.muerto.length > 0) {
      _drawCards(playerId, 5);
      if (playerId === 'human') showMessage(t('msg_empty_hand_drew'));
    }

    // Check if the player still has central moves available
    const stillHasMoves = hasAnyCentralMove(player, state.centralColumns);
    if (!stillHasMoves && playerId === 'human') {
      state.mustPlaceInAux = true;
      showMessage(t('msg_no_central_moves'));
    } else if (player.muerto.length === 0 && playerId === 'human') {
      showMessage(t('msg_muerto_empty_play'));
    }

    renderGame(state);

    // If it's the CPU's turn and still in its turn (called from ai.js loop), do nothing extra
    return true;
  }

  // ── PLAY TO AUX COLUMN ──────────────────────────────────
  function playToAux(playerId, cardId, auxIdx, targetPlayerId) {
    if (state.phase !== 'playing') return false;
    if (state.currentTurn !== playerId) return false;

    const sourcePlayer = state.players[playerId];
    const targetPlayer = state.players[targetPlayerId];
    const auxCol       = targetPlayer.auxColumns[auxIdx];
    const isInterference = targetPlayerId !== playerId;

    const { card, source, sourceIndex } = findCard(sourcePlayer, cardId);
    if (!card) return false;

    // Only hand cards can be placed in aux columns
    if (source !== 'hand') {
      showMessage(t('msg_only_hand_cards_aux'));
      return false;
    }

    // Aces cannot be placed in aux columns
    if (card.value === 1) {
      if (playerId === 'human') showMessage(t('msg_aces_not_in_aux'));
      return false;
    }

    // Validate interference
    if (isInterference) {
      if (!interferenceActive(targetPlayer)) {
        showMessage(t('msg_interference_unavailable'));
        return false;
      }
      if (!canPlayOnAux(card, auxCol, true)) {
        showMessage(t('msg_aux_order'));
        return false;
      }
    }

    // Remove from hand and place in aux
    removeCardFromSource(sourcePlayer, source, sourceIndex);
    auxCol.push(card);

    state.selectedCardId = null;
    state.mustPlaceInAux = false;

    renderGame(state);

    // Playing to aux ends the human player's turn
    if (playerId === 'human') {
      setTimeout(() => endTurn(), 150);
    }

    return true;
  }

  // ── PLAY TO OPPONENT'S MUERTO ────────────────────────────
  // Places a card from the player's hand onto the opponent's muerto pile
  // (direct interference: increases opponent's card count).
  function playToOpponentMuerto(playerId, cardId) {
    if (state.phase !== 'playing') return false;
    if (state.currentTurn !== playerId) return false;

    const sourcePlayer = state.players[playerId];
    const opponentId   = playerId === 'human' ? 'cpu' : 'human';
    const opponent     = state.players[opponentId];

    const { card, source, sourceIndex } = findCard(sourcePlayer, cardId);
    if (!card) return false;

    // Only hand cards or aux tops can be sent to the opponent's muerto
    if (source !== 'hand' && source !== 'aux') {
      showMessage(t('msg_only_hand_aux_for_muerto'));
      return false;
    }

    // Validate: same suit, adjacent value (±1) to the opponent's visible top card
    const opponentTop = opponent.muerto.length > 0
      ? opponent.muerto[opponent.muerto.length - 1]
      : null;

    if (!canPlayOnOpponentMuerto(card, opponentTop)) {
      if (playerId === 'human') {
        if (!opponentTop) {
          showMessage(t('msg_opponent_muerto_empty'));
        } else {
          const sym  = getSuitSymbol(opponentTop.suit);
          const lo   = opponentTop.value > 1  ? getValueLabel(opponentTop.value - 1) : null;
          const hi   = opponentTop.value < 13 ? getValueLabel(opponentTop.value + 1) : null;
          const opts = [lo, hi].filter(Boolean).map(v => `${v}${sym}`).join(' o ');
          showMessage(t('msg_opponent_muerto_valid', { opts }));
        }
      }
      return false;
    }

    // Remove from hand/aux and push on top of opponent's muerto (remains visible)
    removeCardFromSource(sourcePlayer, source, sourceIndex);
    opponent.muerto.push(card);

    // Empty hand after playing → draw 5 (only while there is still a muerto to clear)
    if (sourcePlayer.hand.length === 0 && sourcePlayer.muerto.length > 0) {
      _drawCards(playerId, 5);
      if (playerId === 'human') showMessage(t('msg_empty_hand_drew'));
    }

    state.selectedCardId = null;
    state.mustPlaceInAux = false;

    if (playerId === 'human') {
      const stillHasMoves = hasAnyCentralMove(sourcePlayer, state.centralColumns);
      if (!stillHasMoves) {
        state.mustPlaceInAux = true;
        showMessage(t('msg_sent_to_cpu_no_moves'));
      } else {
        showMessage(t('msg_sent_to_cpu'));
      }
    }

    renderGame(state);

    return true;
  }

  // ── END TURN ─────────────────────────────────────────────
  function endTurn() {
    if (state.phase !== 'playing') return;

    // Cannot end turn while holding an Ace with an empty central column
    if (state.currentTurn === 'human' && hasAceWithEmptyColumn(state.players.human, state.centralColumns)) {
      showMessage(t('msg_must_play_ace'));
      return;
    }

    state.selectedCardId = null;
    state.mustPlaceInAux = false;

    // Switch turn
    state.currentTurn = state.currentTurn === 'human' ? 'cpu' : 'human';

    // Fill hand up to 5 at the start of the new turn
    const nextPlayer = state.players[state.currentTurn];
    const needed = 5 - nextPlayer.hand.length;
    if (needed > 0 && state.drawPile.length > 0) {
      _drawCards(state.currentTurn, needed);
    }

    // If it's the human's turn, check for available central moves
    if (state.currentTurn === 'human') {
      const human = state.players.human;
      if (!hasAnyCentralMove(human, state.centralColumns)) {
        state.mustPlaceInAux = true;
        showMessage(t('msg_no_moves_place_aux'));
      } else {
        showMessage(t('msg_your_turn'));
      }
    }

    renderGame(state);
    _checkDeadlock();

    if (state.phase === 'playing' && state.currentTurn === 'cpu') {
      _scheduleCpuTurn();
    }
  }

  // ── DEADLOCK DETECTION ────────────────────────────────────
  function _checkDeadlock() {
    if (state.phase !== 'playing') return;
    if (state.drawPile.length > 0) return; // cards still available to draw

    const humanMoves = hasAnyCentralMove(state.players.human, state.centralColumns);
    const cpuMoves   = hasAnyCentralMove(state.players.cpu,   state.centralColumns);
    if (humanMoves || cpuMoves) return; // at least one player can still make progress

    // Full deadlock: player with fewer muerto cards wins
    const humanCount = state.players.human.muerto.length;
    const cpuCount   = state.players.cpu.muerto.length;

    state.phase = 'gameover';

    if (humanCount < cpuCount) {
      state.winner = 'human';
      showMessage(t('msg_deadlock_human_wins', { human: humanCount, cpu: cpuCount }));
    } else if (cpuCount < humanCount) {
      state.winner = 'cpu';
      showMessage(t('msg_deadlock_cpu_wins', { human: humanCount, cpu: cpuCount }));
    } else {
      state.winner = 'draw';
      showMessage(t('msg_deadlock_draw', { human: humanCount }));
    }
    renderGame(state);
  }

  // ── CENTRAL COLUMN COMPLETED ─────────────────────────────
  function _handleColumnComplete(colIdx) {
    const col = state.centralColumns[colIdx];
    const shuffled = shuffleDeck(col.cards);
    col.cards    = [];
    col.topValue = 0;
    state.drawPile = [...state.drawPile, ...shuffled];
    showMessage(t('msg_column_complete'));
  }

  // ── DRAW CARDS ────────────────────────────────────────────
  function _drawCards(playerId, count) {
    const player = state.players[playerId];
    const drawn  = Math.min(count, state.drawPile.length);
    for (let i = 0; i < drawn; i++) {
      player.hand.push(state.drawPile.shift());
    }
  }

  // ── CPU TURN ──────────────────────────────────────────────
  function _scheduleCpuTurn() {
    setTimeout(() => {
      if (state.currentTurn !== 'cpu' || state.phase !== 'playing') return;
      runCpuTurn(state, {
        playToCentral,
        playToAux,
        playToOpponentMuerto,
        endTurn
      });
    }, 500);
  }

  // ── ERROR MESSAGES ────────────────────────────────────────
  function _cantPlayMsg(card, column) {
    const label = getValueLabel(card.value);
    if (column.topValue === 0) return t('msg_need_ace_for_column', { label });
    if (card.value !== 13 && card.value !== column.topValue + 1) {
      return t('msg_need_card_or_k', { needed: getValueLabel(column.topValue + 1), label });
    }
    return t('msg_invalid_move');
  }

  // Public API
  return { init, selectCard, deselect, playToCentral, playToAux, playToOpponentMuerto, endTurn, get state() { return state; } };

})();

// ── BOOTSTRAP ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  i18n.init();

  // Language toggle button
  document.getElementById('btn-lang').addEventListener('click', () => {
    const next = i18n.lang === 'es' ? 'en' : 'es';
    i18n.setLang(next);
  });

  initInteraction();
  Game.init();
});
