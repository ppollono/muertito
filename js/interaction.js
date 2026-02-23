// ── interaction.js ─────────────────────────────────────────────
// Handles all click and drag & drop events for the human player.
// Works together with game.js (Game object) to execute moves.

let _dragCardId  = null;  // id of the card being dragged
let _dragSource  = null;  // 'hand' | 'aux' | 'muerto'

// ── INITIALIZATION ─────────────────────────────────────────
function initInteraction() {
  const board = document.getElementById('board');

  // ── CLICK ──────────────────────────────────────────────
  board.addEventListener('click', e => {
    if (Game.state.currentTurn !== 'human' || Game.state.phase !== 'playing') return;

    const cardEl      = e.target.closest('.card');
    const centralEl   = e.target.closest('.central-column');
    const auxEl       = e.target.closest('.aux-column');
    const cpuMuertoEl = e.target.closest('.muerto-slot[data-player="cpu"]');
    const selectedId  = Game.state.selectedCardId;

    // If a HAND card is already selected, destinations take priority
    // (prevents clicking a non-empty aux from re-selecting instead of depositing)
    if (selectedId) {
      const { source } = findCard(Game.state.players.human, selectedId);
      if (source === 'hand') {
        if (centralEl)   { _handleCentralClick(centralEl); return; }
        if (cpuMuertoEl) { Game.playToOpponentMuerto('human', selectedId); return; }
        if (auxEl) {
          const auxIdx    = parseInt(auxEl.dataset.index, 10);
          const auxPlayer = auxEl.dataset.player;
          Game.playToAux('human', selectedId, auxIdx, auxPlayer);
          return;
        }
      }
      if (source === 'aux') {
        if (cpuMuertoEl) { Game.playToOpponentMuerto('human', selectedId); return; }
      }
    }

    // Click on a human player card (selection)
    if (cardEl && cardEl.dataset.playerId === 'human' && !cardEl.classList.contains('face-down')) {
      _handleCardClick(cardEl);
      return;
    }

    // Click on a central column (destination)
    if (centralEl) {
      _handleCentralClick(centralEl);
      return;
    }

    // Click on an aux column (select top aux card or destination with no card selected)
    if (auxEl) {
      _handleAuxClick(auxEl, cardEl);
      return;
    }

    // Click on empty area → deselect
    if (!cardEl) {
      Game.deselect();
    }
  });

  // ── DRAG & DROP ─────────────────────────────────────────
  board.addEventListener('dragstart', e => {
    const cardEl = e.target.closest('.card');
    if (!cardEl || !cardEl.dataset.cardId || !cardEl.dataset.playerId) return;
    if (cardEl.dataset.playerId !== 'human') return;
    if (Game.state.currentTurn !== 'human') return;

    _dragCardId = cardEl.dataset.cardId;
    _dragSource = cardEl.dataset.source;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _dragCardId);

    // Do not call Game.selectCard here: it would trigger renderGame() and destroy
    // the dragged element mid-drag, cancelling the operation.
    setTimeout(() => cardEl.classList.add('dragging'), 0);
  });

  board.addEventListener('dragend', e => {
    // Drag ended (with or without a successful drop): clear visual state
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    _dragCardId = null;
    _dragSource = null;
  });

  board.addEventListener('dragover', e => {
    const dest = _getDragDestination(e.target);
    if (!dest) return;
    if (_isDragDestinationValid(dest)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dest.el.classList.add('drag-over');
    }
  });

  board.addEventListener('dragleave', e => {
    const dest = _getDragDestination(e.target);
    if (!dest) return;
    // Only remove highlight if the cursor fully leaves the destination
    // (not when entering a child element of the same container)
    if (!dest.el.contains(e.relatedTarget)) {
      dest.el.classList.remove('drag-over');
    }
  });

  board.addEventListener('drop', e => {
    e.preventDefault();
    const dest = _getDragDestination(e.target);
    if (!dest || !_dragCardId) return;
    dest.el.classList.remove('drag-over');

    if (dest.type === 'central') {
      Game.playToCentral('human', _dragCardId, dest.index);
    } else if (dest.type === 'aux') {
      Game.playToAux('human', _dragCardId, dest.index, dest.player);
    } else if (dest.type === 'muerto' && dest.player === 'cpu') {
      Game.playToOpponentMuerto('human', _dragCardId);
    }
    _dragCardId = null;
  });

  // ── BUTTONS ─────────────────────────────────────────────
  document.getElementById('btn-end-turn').addEventListener('click', () => {
    if (Game.state.currentTurn !== 'human') return;
    if (Game.state.mustPlaceInAux) {
      showMessage(t('msg_place_aux_first'));
      return;
    }
    Game.endTurn();
  });

  document.getElementById('btn-new-game').addEventListener('click', () => {
    document.getElementById('win-overlay').classList.add('hidden');
    Game.init(true); // forceNew: always starts a new game
  });

  document.getElementById('btn-play-again').addEventListener('click', () => {
    document.getElementById('win-overlay').classList.add('hidden');
    Game.init(true); // forceNew: always starts a new game
  });
}

// ── INTERNAL HANDLERS ─────────────────────────────────────

function _handleCardClick(cardEl) {
  const cardId = cardEl.dataset.cardId;

  // Already selected → deselect
  if (Game.state.selectedCardId === cardId) {
    Game.deselect();
    return;
  }
  // Select new card
  Game.selectCard(cardId);
}

function _handleCentralClick(centralEl) {
  const colIdx = parseInt(centralEl.dataset.index, 10);
  const selId  = Game.state.selectedCardId;
  if (!selId) {
    showMessage(t('msg_select_card_first'));
    return;
  }
  Game.playToCentral('human', selId, colIdx);
}

function _handleAuxClick(auxEl, cardEl) {
  const auxIdx    = parseInt(auxEl.dataset.index, 10);
  const auxPlayer = auxEl.dataset.player;
  const selId     = Game.state.selectedCardId;

  // Click on own aux card → select it
  if (cardEl && cardEl.dataset.playerId === 'human' && auxPlayer === 'human') {
    _handleCardClick(cardEl);
    return;
  }

  if (!selId) {
    showMessage(t('msg_select_hand_first'));
    return;
  }
  Game.playToAux('human', selId, auxIdx, auxPlayer);
}

// ── DRAG DESTINATION HELPERS ───────────────────────────────

function _getDragDestination(target) {
  const centralEl = target.closest('.central-column');
  if (centralEl) return { type: 'central', index: parseInt(centralEl.dataset.index, 10), el: centralEl };

  const auxEl = target.closest('.aux-column');
  if (auxEl) return { type: 'aux', index: parseInt(auxEl.dataset.index, 10), player: auxEl.dataset.player, el: auxEl };

  const muertoEl = target.closest('.muerto-slot[data-player="cpu"]');
  if (muertoEl) return { type: 'muerto', player: 'cpu', el: muertoEl };

  return null;
}

function _isDragDestinationValid(dest) {
  if (!_dragCardId || !Game.state) return false;
  const player = Game.state.players['human'];
  const { card } = findCard(player, _dragCardId);
  if (!card) return false;

  if (dest.type === 'central') {
    return canPlayOnCentral(card, Game.state.centralColumns[dest.index]);
  }
  if (dest.type === 'aux') {
    const targetPlayer = Game.state.players[dest.player];
    const auxCol       = targetPlayer.auxColumns[dest.index];
    const isInterference = dest.player !== 'human';
    if (isInterference) {
      return interferenceActive(targetPlayer) && canPlayOnAux(card, auxCol, true);
    }
    return card.value !== 1 && canPlayOnAux(card, auxCol, false);
  }
  if (dest.type === 'muerto' && dest.player === 'cpu') {
    if (_dragSource !== 'hand' && _dragSource !== 'aux') return false;
    const cpuTop = Game.state.players.cpu.muerto.length > 0
      ? Game.state.players.cpu.muerto[Game.state.players.cpu.muerto.length - 1]
      : null;
    return canPlayOnOpponentMuerto(card, cpuTop);
  }
  return false;
}
