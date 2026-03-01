import { useState, useEffect, useRef, useCallback } from "react";

const COLORS = {
  bg: "#0d1117",
  card: "#161b22",
  cardHover: "#1c2333",
  border: "#30363d",
  green: "#2ea043",
  greenBright: "#3fb950",
  greenDark: "#1a7f37",
  orange: "#d29922",
  orangeBright: "#e3b341",
  red: "#f85149",
  redSoft: "#da3633",
  blue: "#58a6ff",
  text: "#f0f6fc",
  textMuted: "#8b949e",
  textDim: "#484f58",
  fieldGreen: "#1a472a",
  fieldGreenLight: "#238636",
  bench: "#2d1b00",
};

// --- Audio ---
const playBeep = (freq = 880, duration = 180) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);
    g.connect(ctx.destination);
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    o.type = "square";
    o.connect(g);
    o.start();
    o.stop(ctx.currentTime + duration / 1000);
  } catch (e) {}
};

const playSubAlert = () => {
  playBeep(660, 150);
  setTimeout(() => playBeep(880, 150), 180);
  setTimeout(() => playBeep(1100, 250), 360);
};

// --- Utility ---
const formatTime = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const formatMinSec = (minutes) => {
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  if (s === 0) return `${m} min`;
  return `${m}m ${s}s`;
};

// --- Balance field/bench to ensure correct player count ---
function balanceFieldBench(field, bench, targetFieldSize, playTimes = {}) {
  let f = [...new Set(field)];
  let b = [...new Set(bench)];
  // Remove any overlap: field takes priority
  b = b.filter((id) => !f.includes(id));

  // Too many on field -> move excess to bench (highest play time goes to bench)
  while (f.length > targetFieldSize && f.length > 0) {
    let worstIdx = 0;
    let worstTime = -1;
    f.forEach((id, idx) => {
      const t = playTimes[id] || 0;
      if (t > worstTime) { worstTime = t; worstIdx = idx; }
    });
    b.push(f.splice(worstIdx, 1)[0]);
  }

  // Too few on field -> move from bench to field (lowest play time gets on field)
  while (f.length < targetFieldSize && b.length > 0) {
    let bestIdx = 0;
    let bestTime = Infinity;
    b.forEach((id, idx) => {
      const t = playTimes[id] || 0;
      if (t < bestTime) { bestTime = t; bestIdx = idx; }
    });
    f.push(b.splice(bestIdx, 1)[0]);
  }

  return { field: f, bench: b };
}

// --- Schedule Calculation ---
function calculateSchedule(matchDuration, outfieldPlayers, fieldSpots, subMode, existingPlayTimes = null, startTime = 0, preferredInterval = 2.5, recentlyOut = new Set(), currentField = null, currentBench = null) {
  const N = outfieldPlayers.length;
  const S = Math.min(fieldSpots, N);
  const B = N - S;

  if (B <= 0) {
    return {
      schedule: [],
      initialField: outfieldPlayers.map((p) => p.id),
      initialBench: [],
    };
  }

  const remainingDuration = matchDuration - startTime;
  const subsPerEvent = Math.min(subMode, B);

  let sorted = [...outfieldPlayers];
  if (existingPlayTimes) {
    sorted.sort((a, b) => (existingPlayTimes[a.id] || 0) - (existingPlayTimes[b.id] || 0));
  }

  // Use explicit field/bench if provided, otherwise derive from sorted list
  let onField, onBench;
  if (currentField && currentBench) {
    const balanced = balanceFieldBench(currentField, currentBench, S, existingPlayTimes || {});
    onField = balanced.field;
    onBench = balanced.bench;
  } else {
    onField = sorted.slice(0, S).map((p) => p.id);
    onBench = sorted.slice(S).map((p) => p.id);
  }

  // Capture the initial balanced state for return
  const initialField = [...onField];
  const initialBench = [...onBench];

  let playTime = {};
  outfieldPlayers.forEach((p) => {
    playTime[p.id] = existingPlayTimes ? existingPlayTimes[p.id] || 0 : 0;
  });

  let targetInterval = preferredInterval;
  let numEvents = Math.max(1, Math.floor(remainingDuration / targetInterval) - 1);
  let minEvents = Math.ceil(N / subsPerEvent);
  numEvents = Math.max(numEvents, minEvents);
  let interval = remainingDuration / (numEvents + 1);

  if (interval < 1) {
    interval = 1;
    numEvents = Math.max(1, Math.floor(remainingDuration) - 1);
  }
  if (interval > preferredInterval + 1.5 && B > 0) {
    interval = Math.min(preferredInterval, remainingDuration / (minEvents + 1));
    numEvents = Math.max(minEvents, Math.floor(remainingDuration / interval) - 1);
    interval = remainingDuration / (numEvents + 1);
  }

  interval = Math.max(1, Math.round(interval * 2) / 2);

  let schedule = [];
  let time = startTime;
  let prevSwappedOut = new Set(recentlyOut);

  for (let i = 0; i < numEvents; i++) {
    time += interval;
    if (time >= matchDuration - 0.3) break;

    onField.forEach((id) => {
      playTime[id] += interval;
    });

    let swaps = [];
    let thisEventSwappedOut = new Set();

    for (let s = 0; s < subsPerEvent; s++) {
      if (onBench.length === 0) break;

      let maxTime = -1, swapOutId = null;
      onField.forEach((id) => {
        if (swaps.find((sw) => sw.inId === id)) return;
        if (playTime[id] > maxTime) {
          maxTime = playTime[id];
          swapOutId = id;
        }
      });

      // Prefer bench players not recently swapped out
      let candidates = onBench
        .filter((id) => !swaps.find((sw) => sw.inId === id))
        .filter((id) => !prevSwappedOut.has(id));
      if (candidates.length === 0) {
        candidates = onBench.filter((id) => !swaps.find((sw) => sw.inId === id));
      }

      let minTime = Infinity, swapInId = null;
      candidates.forEach((id) => {
        if (playTime[id] < minTime) {
          minTime = playTime[id];
          swapInId = id;
        }
      });

      if (swapOutId && swapInId) {
        swaps.push({ outId: swapOutId, inId: swapInId });
        thisEventSwappedOut.add(swapOutId);
        onField = onField.filter((id) => id !== swapOutId);
        onField.push(swapInId);
        onBench = onBench.filter((id) => id !== swapInId);
        onBench.push(swapOutId);
      }
    }

    prevSwappedOut = thisEventSwappedOut;

    if (swaps.length > 0) {
      schedule.push({
        time: Math.round(time * 10) / 10,
        timeSeconds: Math.round(time * 60),
        swaps,
      });
    }
  }

  return { schedule, initialField, initialBench };
}

// --- Components ---

function Button({ children, onClick, variant = "default", size = "md", disabled = false, style = {} }) {
  const base = {
    border: "none",
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 600,
    transition: "all 0.2s",
    opacity: disabled ? 0.5 : 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  };
  const sizes = {
    sm: { padding: "6px 14px", fontSize: 13 },
    md: { padding: "10px 20px", fontSize: 15 },
    lg: { padding: "14px 28px", fontSize: 18 },
    xl: { padding: "18px 36px", fontSize: 22 },
  };
  const variants = {
    default: { background: COLORS.card, color: COLORS.text, border: `1px solid ${COLORS.border}` },
    primary: { background: COLORS.green, color: "#fff" },
    danger: { background: COLORS.redSoft, color: "#fff" },
    warning: { background: COLORS.orange, color: "#000" },
    ghost: { background: "transparent", color: COLORS.textMuted, border: `1px solid ${COLORS.border}` },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

function PlayerChip({ name, variant = "field", small = false, onRemove, onClick, selected = false }) {
  const styles = {
    field: { bg: COLORS.fieldGreen, border: COLORS.fieldGreenLight, color: COLORS.greenBright },
    bench: { bg: COLORS.bench, border: COLORS.orange, color: COLORS.orangeBright },
    keeper: { bg: "#1a1a40", border: COLORS.blue, color: COLORS.blue },
    swapOut: { bg: "#3d1114", border: COLORS.red, color: COLORS.red },
    swapIn: { bg: "#0d2818", border: COLORS.greenBright, color: COLORS.greenBright },
  };
  const s = styles[variant] || styles.field;
  return (
    <div
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: small ? "4px 10px" : "6px 14px",
        borderRadius: 20,
        background: selected ? `${s.color}25` : s.bg,
        border: `${selected ? 2.5 : 1.5}px solid ${selected ? s.color : s.border}`,
        color: s.color,
        fontSize: small ? 12 : 14,
        fontWeight: 600,
        fontFamily: "'DM Sans', sans-serif",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.2s",
        boxShadow: selected ? `0 0 12px ${s.color}40` : "none",
      }}
    >
      {variant === "keeper" && <span style={{ fontSize: small ? 10 : 12 }}>🧤</span>}
      {variant === "swapOut" && <span style={{ fontSize: small ? 10 : 12 }}>↩</span>}
      {variant === "swapIn" && <span style={{ fontSize: small ? 10 : 12 }}>↪</span>}
      {name}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ cursor: "pointer", marginLeft: 4, opacity: 0.7, fontSize: small ? 10 : 12 }}
        >
          ✕
        </span>
      )}
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: COLORS.card,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 12,
      padding: 20,
      ...style,
    }}>
      {children}
    </div>
  );
}

// --- Scoreboard ---
function Scoreboard({ teamName, scoreHome, scoreAway, onScoreChange, opponentName, onOpponentNameChange }) {
  const counterBtn = {
    width: 36, height: 36, borderRadius: "50%", border: `1px solid ${COLORS.border}`,
    background: COLORS.bg, color: COLORS.text, fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700, fontSize: 18, cursor: "pointer", display: "flex",
    alignItems: "center", justifyContent: "center", transition: "all 0.15s",
  };
  return (
    <Card style={{ marginBottom: 16, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{
            fontSize: 11, color: COLORS.greenBright, fontFamily: "'DM Sans', sans-serif",
            fontWeight: 700, letterSpacing: 0.5, marginBottom: 6, textTransform: "uppercase",
          }}>
            {teamName}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <button style={counterBtn} onClick={() => onScoreChange("home", -1)}>−</button>
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 38, color: COLORS.text, minWidth: 30, textAlign: "center" }}>
              {scoreHome}
            </span>
            <button style={counterBtn} onClick={() => onScoreChange("home", 1)}>+</button>
          </div>
        </div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: COLORS.textDim, padding: "0 8px", marginTop: 16 }}>
          –
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <input
            value={opponentName}
            onChange={(e) => onOpponentNameChange(e.target.value)}
            placeholder="Motstander"
            style={{
              background: "transparent", border: "none", outline: "none",
              fontSize: 11, color: COLORS.orangeBright, fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700, letterSpacing: 0.5, marginBottom: 6, textTransform: "uppercase",
              textAlign: "center", width: "100%",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <button style={counterBtn} onClick={() => onScoreChange("away", -1)}>−</button>
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 38, color: COLORS.text, minWidth: 30, textAlign: "center" }}>
              {scoreAway}
            </span>
            <button style={counterBtn} onClick={() => onScoreChange("away", 1)}>+</button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// --- Manual Sub Dialog ---
function ManualSubDialog({ sub, onField, onBench, getPlayerName, onExecute, onDismiss, subMode }) {
  const [selectedOut, setSelectedOut] = useState(sub.swaps.map((s) => s.outId));
  const [selectedIn, setSelectedIn] = useState(sub.swaps.map((s) => s.inId));
  const maxSwaps = Math.min(subMode, onBench.length);

  const toggleOut = (id) => {
    if (selectedOut.includes(id)) {
      const idx = selectedOut.indexOf(id);
      setSelectedOut(selectedOut.filter((_, i) => i !== idx));
      setSelectedIn(selectedIn.filter((_, i) => i !== idx));
    } else if (selectedOut.length < maxSwaps) {
      setSelectedOut([...selectedOut, id]);
    }
  };

  const toggleIn = (id) => {
    if (selectedIn.includes(id)) {
      setSelectedIn(selectedIn.filter((x) => x !== id));
    } else if (selectedIn.length < selectedOut.length) {
      setSelectedIn([...selectedIn, id]);
    }
  };

  const canExecute = selectedOut.length > 0 && selectedOut.length === selectedIn.length;

  const handleExecute = () => {
    const swaps = selectedOut.map((outId, i) => ({ outId, inId: selectedIn[i] }));
    onExecute({ ...sub, swaps });
  };

  return (
    <div style={{
      background: `linear-gradient(135deg, ${COLORS.green}30, ${COLORS.fieldGreen})`,
      border: `2px solid ${COLORS.greenBright}`,
      borderRadius: 12,
      padding: 20,
      marginBottom: 16,
      animation: "pulse 1.5s ease-in-out infinite",
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 ${COLORS.greenBright}60; }
          50% { box-shadow: 0 0 20px 4px ${COLORS.greenBright}40; }
        }
      `}</style>
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 26, color: COLORS.greenBright,
        textAlign: "center", marginBottom: 4, letterSpacing: 2,
      }}>
        🔄 BYTTE NÅ!
      </div>
      <p style={{
        fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.textMuted,
        textAlign: "center", marginBottom: 14,
      }}>
        Forslag vist nedenfor — trykk for å endre hvem som byttes
      </p>

      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: COLORS.red, fontFamily: "'DM Sans', sans-serif",
          textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
        }}>
          ↩ Ut ({selectedOut.length}/{maxSwaps})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {onField.map((id) => (
            <PlayerChip
              key={id}
              name={getPlayerName(id)}
              variant="swapOut"
              small
              selected={selectedOut.includes(id)}
              onClick={() => toggleOut(id)}
            />
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: COLORS.greenBright, fontFamily: "'DM Sans', sans-serif",
          textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
        }}>
          ↪ Inn ({selectedIn.length}/{selectedOut.length || maxSwaps})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {onBench.map((id) => (
            <PlayerChip
              key={id}
              name={getPlayerName(id)}
              variant="swapIn"
              small
              selected={selectedIn.includes(id)}
              onClick={() => toggleIn(id)}
            />
          ))}
        </div>
      </div>

      {canExecute && (
        <div style={{
          background: `${COLORS.bg}80`, borderRadius: 8, padding: "8px 12px", marginBottom: 14,
        }}>
          {selectedOut.map((outId, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: "3px 0",
            }}>
              <span style={{ color: COLORS.red, fontWeight: 600 }}>{getPlayerName(outId)}</span>
              <span style={{ color: COLORS.textDim }}>→</span>
              <span style={{ color: COLORS.greenBright, fontWeight: 600 }}>{getPlayerName(selectedIn[i])}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <Button onClick={handleExecute} variant="primary" size="md" disabled={!canExecute}>
          ✓ Utfør bytte
        </Button>
        <Button onClick={onDismiss} variant="ghost" size="md">
          Avvis
        </Button>
      </div>
    </div>
  );
}

// --- Setup Screen ---
function SetupScreen({ onStart }) {
  const [teamName, setTeamName] = useState("");
  const [matchDuration, setMatchDuration] = useState("40");
  const [playersOnField, setPlayersOnField] = useState("7");
  const [subMode, setSubMode] = useState(1);
  const [subInterval, setSubInterval] = useState(2.5);
  const [players, setPlayers] = useState([]);
  const [newName, setNewName] = useState("");
  const [keeperId, setKeeperId] = useState(null);
  const inputRef = useRef(null);

  const addPlayer = () => {
    const name = newName.trim();
    if (!name) return;
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 4);
    setPlayers((prev) => [...prev, { id, name }]);
    setNewName("");
    inputRef.current?.focus();
  };

  const removePlayer = (id) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
    if (keeperId === id) setKeeperId(null);
  };

  const matchDurationNum = parseInt(matchDuration) || 0;
  const playersOnFieldNum = parseInt(playersOnField) || 0;
  const canStart = players.length >= playersOnFieldNum && playersOnFieldNum >= 2 && keeperId !== null && matchDurationNum > 0;
  const outfieldOnField = playersOnFieldNum - 1;
  const benchCount = players.length - playersOnFieldNum;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "20px 16px" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontSize: 42, marginBottom: 8 }}>⚽</div>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 38, letterSpacing: 2, color: COLORS.greenBright, margin: 0,
        }}>
          BYTTEPLANLEGGER
        </h1>
        <p style={{ color: COLORS.textMuted, fontSize: 14, marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>
          Like mye spilletid for alle
        </p>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Lagnavn</label>
        <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="F.eks. Lyn G2017" style={inputStyle} />
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Kamplengde (min)</label>
            <input type="number" value={matchDuration} onChange={(e) => setMatchDuration(e.target.value)} style={inputStyle} min={1} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Spillere på banen (inkl. keeper)</label>
            <input type="number" value={playersOnField} onChange={(e) => setPlayersOnField(e.target.value)} style={inputStyle} min={2} />
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Byttemodus</label>
        <div style={{ display: "flex", gap: 10 }}>
          {[1, 2, 3].map((m) => (
            <button key={m} onClick={() => setSubMode(m)} style={{
              flex: 1, padding: "12px 16px",
              border: `2px solid ${subMode === m ? COLORS.greenBright : COLORS.border}`,
              borderRadius: 10, background: subMode === m ? COLORS.fieldGreen : "transparent",
              color: subMode === m ? COLORS.greenBright : COLORS.textMuted,
              fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 15, cursor: "pointer", transition: "all 0.2s",
            }}>
              {m === 1 ? "Én og én" : m === 2 ? "To og to" : "Tre og tre"}
            </button>
          ))}
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Ca. tid mellom bytter (minutter)</label>
        <div style={{ display: "flex", gap: 10 }}>
          {[1.5, 2, 2.5, 3, 4, 5].map((v) => (
            <button key={v} onClick={() => setSubInterval(v)} style={{
              flex: 1, padding: "12px 6px",
              border: `2px solid ${subInterval === v ? COLORS.greenBright : COLORS.border}`,
              borderRadius: 10, background: subInterval === v ? COLORS.fieldGreen : "transparent",
              color: subInterval === v ? COLORS.greenBright : COLORS.textMuted,
              fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 15, cursor: "pointer", transition: "all 0.2s",
            }}>
              {v % 1 === 0 ? v : v.toFixed(1).replace('.', ',')}
            </button>
          ))}
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Spillere ({players.length} lagt til)</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input ref={inputRef} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPlayer()} placeholder="Skriv spillernavn..." style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
          <Button onClick={addPlayer} variant="primary" size="md">+</Button>
        </div>
        {players.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>
              Trykk på en spiller for å velge keeper:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {players.map((p) => (
                <PlayerChip key={p.id} name={p.name} variant={keeperId === p.id ? "keeper" : "field"} onClick={() => setKeeperId(keeperId === p.id ? null : p.id)} onRemove={() => removePlayer(p.id)} />
              ))}
            </div>
          </div>
        )}
        {players.length > 0 && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: COLORS.bg, fontSize: 13, color: COLORS.textMuted, fontFamily: "'DM Sans', sans-serif" }}>
            {keeperId ? (
              <>
                🧤 Keeper: <strong style={{ color: COLORS.blue }}>{players.find(p => p.id === keeperId)?.name}</strong>
                {" · "}{outfieldOnField} utespillere på banen
                {benchCount > 0 ? ` · ${benchCount} på benken` : ""}
                {benchCount < 0 && <span style={{ color: COLORS.red }}> · Trenger {Math.abs(benchCount)} spiller(e) til!</span>}
              </>
            ) : (
              <span style={{ color: COLORS.orange }}>⚠ Velg en keeper ved å trykke på en spiller</span>
            )}
          </div>
        )}
      </Card>

      <Button onClick={() => onStart({ teamName: teamName || "Mitt lag", matchDuration: matchDurationNum, playersOnField: playersOnFieldNum, subMode, subInterval, players, keeperId })} variant="primary" size="lg" disabled={!canStart} style={{ width: "100%", marginTop: 8 }}>
        🏟️ START KAMP
      </Button>
      {!canStart && players.length > 0 && (
        <p style={{ textAlign: "center", color: COLORS.textMuted, fontSize: 12, marginTop: 8, fontFamily: "'DM Sans', sans-serif" }}>
          {!keeperId ? "Velg en keeper" : matchDurationNum < 1 ? "Legg inn kamplengde" : playersOnFieldNum < 2 ? "Legg inn antall spillere" : `Trenger minst ${playersOnFieldNum} spillere (har ${players.length})`}
        </p>
      )}
      <p style={{ textAlign: "center", color: COLORS.textDim, fontSize: 12, marginTop: 32, paddingBottom: 16, fontFamily: "'DM Sans', sans-serif" }}>
        Tilbakemeldinger: vegar.strand@gmail.com
      </p>
    </div>
  );
}

// --- Match Screen ---
function MatchScreen({ config, onEnd, onBack }) {
  const { teamName, matchDuration, playersOnField, subMode, subInterval, players: initialPlayers, keeperId } = config;
  const matchDurationSec = matchDuration * 60;

  const [elapsedSec, setElapsedSec] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [players, setPlayers] = useState(initialPlayers);
  const [keeper, setKeeper] = useState(keeperId);
  const [onField, setOnField] = useState([]);
  const [onBench, setOnBench] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [completedSubs, setCompletedSubs] = useState(new Set());
  const [playTimes, setPlayTimes] = useState({});
  const [alertSub, setAlertSub] = useState(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [matchEnded, setMatchEnded] = useState(false);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [showKeeperSwap, setShowKeeperSwap] = useState(false);
  const [scoreHome, setScoreHome] = useState(0);
  const [scoreAway, setScoreAway] = useState(0);
  const [opponentName, setOpponentName] = useState("Motstander");
  const [recentlySwappedOut, setRecentlySwappedOut] = useState(new Set());
  const [manualSwapOut, setManualSwapOut] = useState(null);
  const [manualSwapIn, setManualSwapIn] = useState(null);
  const [showInfo, setShowInfo] = useState(false);

  const intervalRef = useRef(null);
  const lastTickRef = useRef(null);
  const alertedRef = useRef(new Set());

  useEffect(() => {
    const outfield = initialPlayers.filter((p) => p.id !== keeperId);
    const fieldSpots = playersOnField - 1;
    const result = calculateSchedule(matchDuration, outfield, fieldSpots, subMode, null, 0, subInterval);
    setOnField(result.initialField);
    setOnBench(result.initialBench);
    setSchedule(result.schedule);
    const times = {};
    initialPlayers.forEach((p) => (times[p.id] = 0));
    setPlayTimes(times);
  }, []);

  // Combined timer: match clock + play times in one interval, with background recovery
  useEffect(() => {
    if (isRunning) {
      lastTickRef.current = Date.now();

      const tick = () => {
        const now = Date.now();
        const delta = Math.round((now - (lastTickRef.current || now)) / 1000);
        lastTickRef.current = now;
        if (delta <= 0) return;

        setElapsedSec((prev) => {
          const next = prev + delta;
          if (next >= matchDurationSec) { setIsRunning(false); setMatchEnded(true); return matchDurationSec; }
          return next;
        });

        setPlayTimes((prev) => {
          const next = { ...prev };
          onField.forEach((id) => { next[id] = (next[id] || 0) + delta; });
          if (keeper) next[keeper] = (next[keeper] || 0) + delta;
          return next;
        });
      };

      intervalRef.current = setInterval(tick, 1000);

      // Recover from iOS Safari background suspension
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
          tick();
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);

      return () => {
        clearInterval(intervalRef.current);
        document.removeEventListener('visibilitychange', handleVisibility);
      };
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, matchDurationSec, onField, keeper]);

  useEffect(() => {
    for (const sub of schedule) {
      const subId = `${sub.time}`;
      if (completedSubs.has(subId)) continue;
      const alertTime = sub.timeSeconds - 15;
      if (elapsedSec >= alertTime && elapsedSec < sub.timeSeconds + 30 && !alertedRef.current.has(subId)) {
        alertedRef.current.add(subId);
        setAlertSub(sub);
        setManualSwapOut(null);
        setManualSwapIn(null);
        playSubAlert();
      }
    }
  }, [elapsedSec, schedule, completedSubs]);

  const executeSub = useCallback((sub) => {
    const subId = `${sub.time}`;
    if (completedSubs.has(subId)) return;

    const swappedOutIds = new Set(sub.swaps.map((s) => s.outId));
    setRecentlySwappedOut(swappedOutIds);

    // Compute new field/bench synchronously to avoid duplicates
    let newField = [...onField];
    let newBench = [...onBench];
    sub.swaps.forEach((swap) => {
      newField = newField.filter((id) => id !== swap.outId);
      newBench = newBench.filter((id) => id !== swap.inId);
      if (!newField.includes(swap.inId)) newField.push(swap.inId);
      if (!newBench.includes(swap.outId)) newBench.push(swap.outId);
    });

    // Balance to guarantee correct field count
    const fieldSpots = playersOnField - 1;
    const balanced = balanceFieldBench(newField, newBench, fieldSpots, playTimes);
    newField = balanced.field;
    newBench = balanced.bench;

    setOnField(newField);
    setOnBench(newBench);
    setCompletedSubs((prev) => new Set([...prev, subId]));
    setAlertSub(null);

    // Dynamically recalculate remaining schedule based on actual state
    const outfield = players.filter((p) => p.id !== keeper);
    const elapsedMin = elapsedSec / 60;
    const ptMinutes = {};
    outfield.forEach((p) => { ptMinutes[p.id] = (playTimes[p.id] || 0) / 60; });
    const result = calculateSchedule(matchDuration, outfield, fieldSpots, subMode, ptMinutes, elapsedMin, subInterval, swappedOutIds, newField, newBench);

    // Keep only future events (the recalc starts from current time)
    setSchedule(result.schedule);
    setCompletedSubs(new Set());
    alertedRef.current = new Set();
  }, [completedSubs, onField, onBench, players, keeper, playersOnField, elapsedSec, matchDuration, subMode, subInterval, playTimes]);

  const dismissAlert = () => setAlertSub(null);

  const handleScoreChange = (team, delta) => {
    if (team === "home") setScoreHome((v) => Math.max(0, v + delta));
    else setScoreAway((v) => Math.max(0, v + delta));
  };

  const recalcSchedule = useCallback((currentPlayers, currentKeeper, currentOnField, currentOnBench, currentPlayTimes, currentRecentlyOut = new Set()) => {
    const outfield = currentPlayers.filter((p) => p.id !== currentKeeper);
    const fieldSpots = playersOnField - 1;
    const elapsedMin = elapsedSec / 60;
    const ptMinutes = {};
    outfield.forEach((p) => { ptMinutes[p.id] = (currentPlayTimes[p.id] || 0) / 60; });

    // Filter to only valid outfield players and balance counts
    const outfieldIds = new Set(outfield.map((p) => p.id));
    const validField = currentOnField.filter((id) => outfieldIds.has(id));
    const validBench = currentOnBench.filter((id) => outfieldIds.has(id));
    const balanced = balanceFieldBench(validField, validBench, fieldSpots, ptMinutes);

    const result = calculateSchedule(matchDuration, outfield, fieldSpots, subMode, ptMinutes, elapsedMin, subInterval, currentRecentlyOut, balanced.field, balanced.bench);
    setOnField(result.initialField);
    setOnBench(result.initialBench);
    setSchedule(result.schedule);
    setCompletedSubs(new Set());
    alertedRef.current = new Set();
    setAlertSub(null);
  }, [elapsedSec, matchDuration, playersOnField, subMode, subInterval]);

  const removePlayerFromMatch = (playerId) => {
    if (playerId === keeper) return;
    const newPlayers = players.filter((p) => p.id !== playerId);
    setPlayers(newPlayers);
    const rawField = onField.filter((id) => id !== playerId);
    const rawBench = onBench.filter((id) => id !== playerId);
    const newPlayTimes = { ...playTimes };
    delete newPlayTimes[playerId];
    setPlayTimes(newPlayTimes);

    // Balance to maintain correct field count
    const fieldSpots = playersOnField - 1;
    const balanced = balanceFieldBench(rawField, rawBench, fieldSpots, newPlayTimes);

    setTimeout(() => { recalcSchedule(newPlayers, keeper, balanced.field, balanced.bench, newPlayTimes, recentlySwappedOut); }, 50);
  };

  const addPlayerToMatch = () => {
    const name = newPlayerName.trim();
    if (!name) return;
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 4);
    const newPlayers = [...players, { id, name }];
    const newPlayTimes = { ...playTimes, [id]: 0 };
    setPlayers(newPlayers);
    setPlayTimes(newPlayTimes);
    setNewPlayerName("");
    setShowAddPlayer(false);

    // New player goes to bench, then balance
    const fieldSpots = playersOnField - 1;
    const balanced = balanceFieldBench(onField, [...onBench, id], fieldSpots, newPlayTimes);

    setTimeout(() => { recalcSchedule(newPlayers, keeper, balanced.field, balanced.bench, newPlayTimes, recentlySwappedOut); }, 50);
  };

  const swapKeeper = (newKeeperId) => {
    const oldKeeper = keeper;
    const wasOnField = onField.includes(newKeeperId);
    const wasOnBench = onBench.includes(newKeeperId);
    let newOnField = onField.filter((id) => id !== newKeeperId);
    let newOnBench = onBench.filter((id) => id !== newKeeperId);
    // Old keeper goes to the position the new keeper came from
    if (wasOnField) newOnField.push(oldKeeper);
    else if (wasOnBench) newOnBench.push(oldKeeper);
    else newOnField.push(oldKeeper);

    // Balance to correct field count
    const fieldSpots = playersOnField - 1;
    const balanced = balanceFieldBench(newOnField, newOnBench, fieldSpots, playTimes);

    setKeeper(newKeeperId);
    setOnField(balanced.field);
    setOnBench(balanced.bench);
    setShowKeeperSwap(false);
    setTimeout(() => { recalcSchedule(players, newKeeperId, balanced.field, balanced.bench, playTimes, recentlySwappedOut); }, 50);
  };

  const executeManualSwap = () => {
    if (!manualSwapOut || !manualSwapIn) return;

    const swappedOutIds = new Set([manualSwapOut]);
    setRecentlySwappedOut(swappedOutIds);

    let newField = [...onField];
    let newBench = [...onBench];
    newField = newField.filter((id) => id !== manualSwapOut);
    newBench = newBench.filter((id) => id !== manualSwapIn);
    if (!newField.includes(manualSwapIn)) newField.push(manualSwapIn);
    if (!newBench.includes(manualSwapOut)) newBench.push(manualSwapOut);

    const fieldSpots = playersOnField - 1;
    const balanced = balanceFieldBench(newField, newBench, fieldSpots, playTimes);
    newField = balanced.field;
    newBench = balanced.bench;

    setOnField(newField);
    setOnBench(newBench);
    setManualSwapOut(null);
    setManualSwapIn(null);

    // Recalculate schedule
    const outfield = players.filter((p) => p.id !== keeper);
    const elapsedMin = elapsedSec / 60;
    const ptMinutes = {};
    outfield.forEach((p) => { ptMinutes[p.id] = (playTimes[p.id] || 0) / 60; });
    const result = calculateSchedule(matchDuration, outfield, fieldSpots, subMode, ptMinutes, elapsedMin, subInterval, swappedOutIds, newField, newBench);
    setSchedule(result.schedule);
    setCompletedSubs(new Set());
    alertedRef.current = new Set();
    setAlertSub(null);
  };

  const cancelManualSwap = () => {
    setManualSwapOut(null);
    setManualSwapIn(null);
  };

  const getPlayerName = (id) => players.find((p) => p.id === id)?.name || "?";
  const progress = Math.min(elapsedSec / matchDurationSec, 1);
  const nextSub = schedule.find((s) => !completedSubs.has(`${s.time}`) && s.timeSeconds > elapsedSec - 30);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "12px 16px", paddingBottom: 100 }}>
      {/* Back Confirm Dialog */}
      {showBackConfirm && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <Card style={{ maxWidth: 340, textAlign: "center", padding: 28 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", color: COLORS.text, fontSize: 16, marginBottom: 6 }}>Gå tilbake til oppsett?</p>
            <p style={{ fontFamily: "'DM Sans', sans-serif", color: COLORS.textMuted, fontSize: 13, marginBottom: 20 }}>Kampdata vil gå tapt.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <Button onClick={() => setShowBackConfirm(false)} variant="ghost" size="md">Avbryt</Button>
              <Button onClick={onBack} variant="danger" size="md">Gå tilbake</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Keeper Swap Dialog */}
      {showKeeperSwap && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <Card style={{ maxWidth: 380, padding: 28 }}>
            <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: COLORS.blue, marginBottom: 6, letterSpacing: 1, textAlign: "center" }}>
              🧤 BYTT KEEPER
            </h3>
            <p style={{ fontFamily: "'DM Sans', sans-serif", color: COLORS.textMuted, fontSize: 13, marginBottom: 16, textAlign: "center" }}>
              Velg ny keeper. Nåværende keeper ({getPlayerName(keeper)}) tar plassen til den valgte spilleren.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, justifyContent: "center" }}>
              {players.filter((p) => p.id !== keeper).map((p) => (
                <PlayerChip key={p.id} name={p.name} variant={onField.includes(p.id) ? "field" : "bench"} onClick={() => swapKeeper(p.id)} />
              ))}
            </div>
            <div style={{ textAlign: "center" }}>
              <Button onClick={() => setShowKeeperSwap(false)} variant="ghost" size="md">Avbryt</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8, position: "relative" }}>
        <button onClick={() => setShowBackConfirm(true)} style={{
          position: "absolute", left: 0, top: 0, background: "transparent", border: "none",
          color: COLORS.textMuted, fontSize: 14, fontFamily: "'DM Sans', sans-serif",
          cursor: "pointer", padding: "4px 8px", display: "flex", alignItems: "center", gap: 4,
        }}>
          ← Tilbake
        </button>
        <div style={{ fontSize: 13, color: COLORS.textMuted, fontFamily: "'DM Sans', sans-serif", letterSpacing: 1 }}>
          {teamName.toUpperCase()}
        </div>
      </div>

      {/* Timer */}
      <Card style={{ marginBottom: 12, textAlign: "center", padding: "24px 20px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${progress * 100}%`, background: `linear-gradient(90deg, ${COLORS.fieldGreen}40, ${COLORS.green}20)`, transition: "width 1s linear" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 72, color: matchEnded ? COLORS.orange : COLORS.text, lineHeight: 1, letterSpacing: 3 }}>
            {formatTime(elapsedSec)}
          </div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, fontFamily: "'DM Sans', sans-serif", marginTop: 4, marginBottom: 16 }}>
            {matchEnded ? "KAMPEN ER FERDIG" : `av ${matchDuration}:00`}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            {!matchEnded ? (
              <>
                <Button onClick={() => setIsRunning(!isRunning)} variant={isRunning ? "warning" : "primary"} size="lg" style={{ minWidth: 140 }}>
                  {isRunning ? "⏸ PAUSE" : elapsedSec === 0 ? "▶ START" : "▶ FORTSETT"}
                </Button>
                {elapsedSec > 0 && !isRunning && (
                  <Button onClick={() => setMatchEnded(true)} variant="ghost" size="lg">🏁 AVSLUTT</Button>
                )}
              </>
            ) : (
              <Button onClick={onEnd} variant="primary" size="lg">← NY KAMP</Button>
            )}
          </div>
        </div>
      </Card>

      {/* Scoreboard */}
      <Scoreboard teamName={teamName} scoreHome={scoreHome} scoreAway={scoreAway} onScoreChange={handleScoreChange} opponentName={opponentName} onOpponentNameChange={setOpponentName} />

      {/* Info Button */}
      {!matchEnded && (
        <div style={{ textAlign: "center", marginBottom: 14, marginTop: -6 }}>
          <button
            onClick={() => setShowInfo(true)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: COLORS.textDim, fontSize: 13, fontFamily: "'DM Sans', sans-serif",
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 6, transition: "color 0.2s",
            }}
          >
            ℹ️ Hvordan bytte spillere
          </button>
        </div>
      )}

      {/* Info Modal */}
      {showInfo && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.7)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <Card style={{ maxWidth: 400, padding: 28 }}>
            <h3 style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: COLORS.text,
              marginBottom: 16, letterSpacing: 1, textAlign: "center",
            }}>
              ℹ️ OM BYTTER
            </h3>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: COLORS.textMuted, lineHeight: 1.6 }}>
              <p style={{ marginBottom: 14 }}>
                <strong style={{ color: COLORS.greenBright }}>Automatisk:</strong>{" "}
                Bytteplanen nederst viser forslag til bytter gjennom kampen. Når det er tid for bytte, vises et varsel med foreslåtte spillere. Du kan endre hvem som byttes i varselet, eller avvise det helt.
              </p>
              <p style={{ marginBottom: 14 }}>
                <strong style={{ color: COLORS.orangeBright }}>Manuelt:</strong>{" "}
                Trykk på en utespiller på banen, deretter en spiller på benken, og bekreft med «Utfør bytte».
              </p>
              <p style={{ marginBottom: 14 }}>
                <strong style={{ color: COLORS.blue }}>Keeper:</strong>{" "}
                Trykk på keeperen (🧤) for å bytte keeperrolle med en annen spiller.
              </p>
              <p style={{ color: COLORS.textDim, fontSize: 13 }}>
                Bytteplanen oppdateres automatisk etter hvert bytte for å sikre lik spilletid.
              </p>
            </div>
            <div style={{ textAlign: "center", marginTop: 18 }}>
              <Button onClick={() => setShowInfo(false)} variant="primary" size="md">Lukk</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Sub Alert with manual override */}
      {alertSub && (
        <ManualSubDialog sub={alertSub} onField={onField} onBench={onBench} getPlayerName={getPlayerName} onExecute={executeSub} onDismiss={dismissAlert} subMode={subMode} />
      )}

      {/* Players on Field */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.greenBright, margin: 0, letterSpacing: 1 }}>
            PÅ BANEN ({onField.length + 1})
          </h3>
          {manualSwapOut && (
            <button onClick={cancelManualSwap} style={{
              background: "transparent", border: "none", color: COLORS.textMuted,
              fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
            }}>
              Avbryt valg
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <PlayerChip name={getPlayerName(keeper)} variant="keeper" onClick={!matchEnded ? () => setShowKeeperSwap(true) : undefined} />
          {onField.map((id) => (
            <PlayerChip
              key={id}
              name={getPlayerName(id)}
              variant={manualSwapOut === id ? "swapOut" : "field"}
              selected={manualSwapOut === id}
              onClick={!matchEnded && !alertSub && onBench.length > 0 ? () => setManualSwapOut(manualSwapOut === id ? null : id) : undefined}
              onRemove={!matchEnded && !manualSwapOut ? () => removePlayerFromMatch(id) : undefined}
            />
          ))}
        </div>
        {!matchEnded && !manualSwapOut && (
          <p style={{ color: COLORS.textDim, fontSize: 11, marginTop: 8, fontFamily: "'DM Sans', sans-serif" }}>
            {onBench.length > 0 ? "Trykk på en utespiller for manuelt bytte · Trykk 🧤 for keeperbytte" : "Trykk på keeperen for å bytte keeperrolle"}
          </p>
        )}
        {manualSwapOut && !manualSwapIn && (
          <p style={{ color: COLORS.orangeBright, fontSize: 12, marginTop: 8, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
            ↓ Velg spiller fra benken som skal inn
          </p>
        )}
      </Card>

      {/* Players on Bench */}
      {onBench.length > 0 && (
        <Card style={{
          marginBottom: 12,
          border: manualSwapOut ? `1px solid ${COLORS.orange}60` : `1px solid ${COLORS.border}`,
          transition: "border-color 0.3s",
        }}>
          <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.orangeBright, margin: 0, marginBottom: 12, letterSpacing: 1 }}>
            PÅ BENKEN ({onBench.length})
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {onBench.map((id) => (
              <PlayerChip
                key={id}
                name={getPlayerName(id)}
                variant={manualSwapIn === id ? "swapIn" : "bench"}
                selected={manualSwapIn === id}
                onClick={manualSwapOut && !matchEnded && !alertSub ? () => setManualSwapIn(manualSwapIn === id ? null : id) : undefined}
                onRemove={!matchEnded && !manualSwapOut ? () => removePlayerFromMatch(id) : undefined}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Manual Swap Confirmation */}
      {manualSwapOut && manualSwapIn && (
        <Card style={{
          marginBottom: 12,
          background: `linear-gradient(135deg, ${COLORS.green}15, ${COLORS.fieldGreen})`,
          border: `2px solid ${COLORS.greenBright}80`,
          padding: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 14, fontFamily: "'DM Sans', sans-serif" }}>
            <PlayerChip name={getPlayerName(manualSwapOut)} variant="swapOut" small />
            <span style={{ color: COLORS.textMuted, fontSize: 18 }}>→</span>
            <PlayerChip name={getPlayerName(manualSwapIn)} variant="swapIn" small />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Button onClick={executeManualSwap} variant="primary" size="md">
              ✓ Utfør bytte
            </Button>
            <Button onClick={cancelManualSwap} variant="ghost" size="md">
              Avbryt
            </Button>
          </div>
        </Card>
      )}

      {/* Add Player */}
      {!matchEnded && (
        <div style={{ marginBottom: 16 }}>
          {showAddPlayer ? (
            <Card>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPlayerToMatch()} placeholder="Spillernavn..." style={{ ...inputStyle, flex: 1, marginBottom: 0 }} autoFocus />
                <Button onClick={addPlayerToMatch} variant="primary" size="md">+</Button>
                <Button onClick={() => setShowAddPlayer(false)} variant="ghost" size="md">✕</Button>
              </div>
            </Card>
          ) : (
            <Button onClick={() => setShowAddPlayer(true)} variant="ghost" size="sm" style={{ width: "100%" }}>+ Legg til spiller</Button>
          )}
        </div>
      )}

      {/* Play Time Stats */}
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.text, margin: 0, marginBottom: 14, letterSpacing: 1 }}>
          SPILLETID
        </h3>
        {(() => {
          const outfieldIds = players.filter((p) => p.id !== keeper).map((p) => p.id);
          const times = outfieldIds.map((id) => ({ id, time: playTimes[id] || 0 }));
          const maxTime = Math.max(...times.map((t) => t.time), 1);
          times.sort((a, b) => b.time - a.time);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <div style={{ minWidth: 90, fontSize: 13, fontWeight: 600, color: COLORS.blue, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 4 }}>
                  🧤 {getPlayerName(keeper)}
                </div>
                <div style={{ flex: 1, height: 20, background: COLORS.bg, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${((playTimes[keeper] || 0) / Math.max(maxTime, elapsedSec || 1)) * 100}%`, background: `linear-gradient(90deg, ${COLORS.blue}60, ${COLORS.blue}30)`, borderRadius: 10, transition: "width 1s" }} />
                </div>
                <div style={{ minWidth: 44, fontSize: 12, color: COLORS.textMuted, textAlign: "right", fontFamily: "'DM Sans', sans-serif" }}>
                  {formatTime(playTimes[keeper] || 0)}
                </div>
              </div>
              {times.map(({ id, time }) => {
                const isOnField = onField.includes(id);
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 90, fontSize: 13, fontWeight: 600, color: isOnField ? COLORS.greenBright : COLORS.orangeBright, fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {getPlayerName(id)}
                    </div>
                    <div style={{ flex: 1, height: 20, background: COLORS.bg, borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(time / Math.max(maxTime, elapsedSec || 1)) * 100}%`, background: isOnField ? `linear-gradient(90deg, ${COLORS.green}80, ${COLORS.green}40)` : `linear-gradient(90deg, ${COLORS.orange}60, ${COLORS.orange}30)`, borderRadius: 10, transition: "width 1s" }} />
                    </div>
                    <div style={{ minWidth: 44, fontSize: 12, color: COLORS.textMuted, textAlign: "right", fontFamily: "'DM Sans', sans-serif" }}>
                      {formatTime(time)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Card>

      {/* Substitution Schedule */}
      {schedule.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: COLORS.text, margin: 0, marginBottom: 14, letterSpacing: 1 }}>
            BYTTEPLAN
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {schedule.map((sub, idx) => {
              const subId = `${sub.time}`;
              const isDone = completedSubs.has(subId);
              const isNext = nextSub && nextSub.time === sub.time && !isDone;
              const isPast = sub.timeSeconds < elapsedSec && !isDone;
              return (
                <div key={idx} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8,
                  background: isNext ? `${COLORS.green}15` : isDone ? `${COLORS.textDim}10` : "transparent",
                  border: isNext ? `1px solid ${COLORS.green}40` : "1px solid transparent",
                  opacity: isDone ? 0.5 : 1, transition: "all 0.3s",
                }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: isNext ? COLORS.greenBright : isDone ? COLORS.textDim : COLORS.textMuted, minWidth: 52, textDecoration: isDone ? "line-through" : "none" }}>
                    {formatMinSec(sub.time)}
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                    {sub.swaps.map((swap, si) => (
                      <div key={si} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>
                        <span style={{ color: COLORS.red, fontWeight: 600 }}>{getPlayerName(swap.outId)}</span>
                        <span style={{ color: COLORS.textDim }}>→</span>
                        <span style={{ color: COLORS.greenBright, fontWeight: 600 }}>{getPlayerName(swap.inId)}</span>
                      </div>
                    ))}
                  </div>
                  {isDone && <span style={{ color: COLORS.greenBright, fontSize: 16 }}>✓</span>}
                  {isNext && !alertSub && (
                    <Button onClick={() => { setAlertSub(sub); playSubAlert(); }} variant="primary" size="sm">Bytt</Button>
                  )}
                  {isPast && !isDone && (
                    <Button onClick={() => { setAlertSub(sub); }} variant="warning" size="sm">Bytt</Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <p style={{ textAlign: "center", color: COLORS.textDim, fontSize: 12, marginTop: 24, paddingBottom: 16, fontFamily: "'DM Sans', sans-serif" }}>
        Tilbakemeldinger: vegar.strand@gmail.com
      </p>
    </div>
  );
}

// --- Shared Styles ---
const labelStyle = {
  display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: 13,
  fontWeight: 600, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8,
};
const inputStyle = {
  width: "100%", padding: "10px 14px", borderRadius: 8,
  border: `1px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.text,
  fontSize: 16, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box", marginBottom: 4,
};

// --- Main App ---
export default function App() {
  const [phase, setPhase] = useState("setup");
  const [config, setConfig] = useState(null);
  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { overscroll-behavior: none; }
        body { background: ${COLORS.bg}; position: fixed; width: 100%; height: 100%; overflow: hidden; }
        #root { height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; }
        input::placeholder { color: ${COLORS.textDim}; }
        input:focus { border-color: ${COLORS.green} !important; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
      `}</style>
      {phase === "setup" && <SetupScreen onStart={(cfg) => { setConfig(cfg); setPhase("match"); }} />}
      {phase === "match" && config && <MatchScreen config={config} onEnd={() => { setPhase("setup"); setConfig(null); }} onBack={() => { setPhase("setup"); setConfig(null); }} />}
    </div>
  );
}
