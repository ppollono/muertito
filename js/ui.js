// ── ui.js ──────────────────────────────────────────────────
// DOM rendering from game state.

// Builds the DOM element for a face-up card
function buildCard(card, opts = {}) {
  const { selected = false, draggable = false, interactive = true, extraClass = "" } = opts;

  const el = document.createElement("div");
  el.className = `card ${card.color}${selected ? " selected" : ""}${!interactive ? " non-interactive" : ""}${extraClass ? " " + extraClass : ""}`;
  el.dataset.cardId = card.id;
  if (draggable && interactive) {
    el.setAttribute("draggable", "true");
  }

  const label = getValueLabel(card.value);
  const sym = getSuitSymbol(card.suit);

  el.innerHTML = `
    <div class="card-val-top"><span>${label}</span><span class="suit">${sym}</span></div>
    <div class="card-center-suit">${sym}</div>
    <div class="card-val-bottom"><span>${label}</span><span class="suit">${sym}</span></div>
  `;
  return el;
}

// Face-down card
function buildFaceDown(opts = {}) {
  const { tiny = false } = opts;
  const el = document.createElement("div");
  el.className = "card face-down" + (tiny ? " tiny" : "");
  el.innerHTML = `<span class="card-back-label">🂠</span>`;
  return el;
}

// Empty slot placeholder
function buildEmptySlot(label = "") {
  const el = document.createElement("div");
  el.className = "empty-placeholder";
  el.textContent = label;
  return el;
}

// ── FULL RENDER ────────────────────────────────────────────
function renderGame(state) {
  // Persist to localStorage (selectedCardId is transient, not saved)
  try {
    const snap = JSON.parse(JSON.stringify(state));
    snap.selectedCardId = null;
    localStorage.setItem("muertito_state", JSON.stringify(snap));
  } catch (e) {
    /* quota exceeded or other error: ignore */
  }

  if (state.phase === "gameover") {
    _showWinOverlay(state.winner);
  }
  _renderDrawPile(state);
  _renderCentralColumns(state);
  _renderPlayerZone("human", state);
  _renderPlayerZone("cpu", state);
  _updateCounts(state);
  _updateTurnIndicator(state);
  _updateActionBar(state);
}

// ── DRAW PILE ──────────────────────────────────────────────
function _renderDrawPile(state) {
  const slot = document.getElementById("draw-pile");
  slot.innerHTML = "";
  if (state.drawPile.length > 0) {
    slot.appendChild(buildFaceDown());
  } else {
    slot.appendChild(buildEmptySlot(t("slot_empty")));
  }

}

// ── CENTRAL COLUMNS ─────────────────────────────────────────
function _renderCentralColumns(state) {
  const selected = state.selectedCardId;
  const selectedSource = selected ? _findCardSource(state, "human", selected) : null;

  for (let i = 0; i < 3; i++) {
    const col = state.centralColumns[i];
    const el = document.getElementById(`central-${i}`);
    el.innerHTML = "";

    // Compute validity if a card is selected
    let isValid = false;
    if (selected && selectedSource && selectedSource.card) {
      isValid = canPlayOnCentral(selectedSource.card, col);
    }

    el.classList.toggle("valid-target", isValid && state.currentTurn === "human");

    if (col.cards.length === 0) {
      const ph = buildEmptySlot(t("slot_central_empty"));
      el.appendChild(ph);
    } else {
      col.cards.forEach((card, idx) => {
        const isTop = idx === col.cards.length - 1;
        const cardEl = buildCard(card, { interactive: false });
        el.appendChild(cardEl);
      });
    }
    // Adjust stack height
    el.style.paddingBottom =
      col.cards.length > 0
        ? `calc(var(--card-h) + ${Math.min(col.cards.length - 1, 8) * 14}px)`
        : "";
  }
}

// ── PLAYER ZONE ────────────────────────────────────────────
function _renderPlayerZone(playerId, state) {
  const player = state.players[playerId];
  const isHuman = playerId === "human";
  const selected = state.selectedCardId;
  const isMyTurn = state.currentTurn === playerId;

  // ── MUERTO ──────────────────────────────────────────────
  const muertoSlot = document.getElementById(`${playerId}-muerto`);
  muertoSlot.innerHTML = "";
  if (player.muerto.length > 0) {
    const topCard = player.muerto[player.muerto.length - 1];
    const isSelected = selected === topCard.id;

    if (player.muerto.length > 1) {
      // Face-down pile behind the visible card
      const back = buildFaceDown();
      back.style.position = "absolute";
      back.style.top = "3px";
      back.style.left = "3px";
      back.style.zIndex = "0";
      muertoSlot.appendChild(back);
    }
    // Visible top card
    const topEl = buildCard(topCard, {
      selected: isSelected,
      draggable: isHuman && isMyTurn,
      interactive: isHuman && isMyTurn,
      extraClass: "muerto-top-card",
    });
    topEl.dataset.source = "muerto";
    topEl.dataset.playerId = playerId;
    muertoSlot.appendChild(topEl);
  } else {
    muertoSlot.appendChild(buildEmptySlot(t("slot_muerto_empty")));
  }

  // CPU's muerto is a valid drop target: same suit, adjacent value (±1)
  if (playerId === "cpu" && state.currentTurn === "human") {
    const src = selected ? _findCardSource(state, "human", selected) : null;
    const cpuTop = player.muerto.length > 0 ? player.muerto[player.muerto.length - 1] : null;
    const isValidDest = !!(
      src &&
      (src.source === "hand" || src.source === "aux") &&
      src.card &&
      canPlayOnOpponentMuerto(src.card, cpuTop)
    );
    muertoSlot.classList.toggle("valid-target", isValidDest);
  } else {
    muertoSlot.classList.remove("valid-target");
  }

  // ── HAND ─────────────────────────────────────────────────
  const handArea = document.getElementById(`${playerId}-hand`);
  handArea.innerHTML = "";
  player.hand.forEach((card) => {
    let cardEl;
    if (isHuman) {
      const isSelected = selected === card.id;
      cardEl = buildCard(card, {
        selected: isSelected,
        draggable: isMyTurn,
        interactive: isMyTurn,
      });
      cardEl.dataset.source = "hand";
      cardEl.dataset.playerId = "human";
    } else {
      cardEl = buildFaceDown();
    }
    handArea.appendChild(cardEl);
  });

  // ── AUX COLUMNS ────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    const auxEl = document.getElementById(`${playerId}-aux-${i}`);
    const auxCol = player.auxColumns[i];
    auxEl.innerHTML = "";

    // Check if this aux column is a valid destination for the selected card
    let isValidDest = false;
    if (selected && state.currentTurn === "human") {
      const src = _findCardSource(state, "human", selected);
      if (src) {
        if (playerId === "human") {
          // Human can place any non-Ace hand card on own aux (ends turn)
          isValidDest = src.source === "hand" && src.card.value !== 1;
        } else {
          // Interference
          isValidDest =
            interferenceActive(player) &&
            src.source === "hand" &&
            canPlayOnAux(src.card, auxCol, true);
        }
      }
    }
    auxEl.classList.toggle("valid-target", isValidDest);

    if (auxCol.length === 0) {
      auxEl.appendChild(buildEmptySlot(""));
    } else {
      auxCol.forEach((card, idx) => {
        const isTop = idx === auxCol.length - 1;
        const isSelected = isTop && selected === card.id;
        const cardEl = buildCard(card, {
          selected: isSelected,
          draggable: isHuman && isMyTurn && isTop,
          interactive: isHuman && isMyTurn && isTop,
        });
        if (isTop) {
          cardEl.dataset.source = "aux";
          cardEl.dataset.sourceIndex = i;
          cardEl.dataset.playerId = playerId;
        }
        auxEl.appendChild(cardEl);
      });
    }
    // Height adjustment
    auxEl.style.paddingBottom =
      auxCol.length > 0 ? `calc(var(--card-h) + ${Math.min(auxCol.length - 1, 8) * 14}px)` : "";
  }

  // CPU thinking animation
  const cpuZone = document.getElementById("cpu-zone");
  if (cpuZone) {
    cpuZone.classList.toggle("cpu-thinking", state.currentTurn === "cpu");
  }
}

// ── COUNTERS ─────────────────────────────────────────────────
function _updateCounts(state) {
  _setCount("human-muerto-count", state.players.human.muerto.length);
  _setCount("cpu-muerto-count", state.players.cpu.muerto.length);
  _setCount("human-hand-count", state.players.human.hand.length);
  _setCount("cpu-hand-count", state.players.cpu.hand.length);
  _setCount("draw-pile-count", state.drawPile.length);
}

function _setCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = n;
}

// ── TURN INDICATOR ─────────────────────────────────────────
function _updateTurnIndicator(state) {
  const el = document.getElementById("turn-indicator");
  if (!el) return;
  if (state.phase === "gameover") {
    el.textContent = t("turn_gameover");
    el.className = "";
    return;
  }
  if (state.currentTurn === "human") {
    el.textContent = t("turn_human");
    el.className = "human-turn";
  } else {
    el.textContent = t("turn_cpu");
    el.className = "cpu-turn";
  }
}

// ── ACTION BAR ─────────────────────────────────────────────
function _updateActionBar(state) {
  const btn = document.getElementById("btn-end-turn");
  if (!btn) return;
  const isHumanTurn = state.currentTurn === "human" && state.phase === "playing";
  btn.disabled = !isHumanTurn;

  const aceBlocked =
    isHumanTurn && hasAceWithEmptyColumn(state.players.human, state.centralColumns);

  if (aceBlocked) {
    btn.textContent = t("btn_play_ace_first");
    btn.classList.add("btn-active");
    btn.disabled = true;
  } else if (state.mustPlaceInAux && isHumanTurn) {
    btn.textContent = t("btn_no_moves_aux");
    btn.classList.add("btn-active");
  } else {
    btn.textContent = t("btn_end_turn");
    btn.classList.remove("btn-active");
  }
}

// ── WIN OVERLAY ─────────────────────────────────────────────
function _showWinOverlay(winner) {
  const overlay = document.getElementById("win-overlay");
  const title = document.getElementById("win-title");
  const subtitle = document.getElementById("win-subtitle");
  if (!overlay) return;
  overlay.classList.remove("hidden");

  if (winner === "draw") {
    title.textContent = t("win_draw_title");
    subtitle.textContent = t("win_draw_subtitle");
  } else if (winner === "human") {
    const isDeadlock = Game.state.players.human.muerto.length > 0;
    title.textContent = t("win_human_title");
    subtitle.textContent = isDeadlock
      ? t("win_human_subtitle_deadlock")
      : t("win_human_subtitle_normal");
  } else {
    const isDeadlock = Game.state.players.cpu.muerto.length > 0;
    title.textContent = t("win_cpu_title");
    subtitle.textContent = isDeadlock
      ? t("win_cpu_subtitle_deadlock")
      : t("win_cpu_subtitle_normal");
  }
}

// ── MESSAGE BAR ────────────────────────────────────────────
function showMessage(msg) {
  const el = document.getElementById("message-bar");
  if (el) el.textContent = msg;
}

// ── HELPER: find the selected card in state ───────────────
function _findCardSource(state, playerId, cardId) {
  const player = state.players[playerId];
  return findCard(player, cardId); // from rules.js
}
