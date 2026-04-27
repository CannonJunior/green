// CLI / TUI mirror — same conversation, keyboard-driven.
// Top: scrollable transcript (matches the user's pasted style exactly).
// Bottom: trace pane for the selected Green response.
// j/k navigate Green responses, enter to expand, s to send to signal,
// / filter, q reset filter.

const { useState, useEffect, useMemo, useRef } = React;

const CLI_BG = "#06090b";
const CLI_FG = "#cfe9d8";
const CLI_DIM = "#5b7768";
const CLI_GREEN = "#7ee8b0";
const CLI_AMBER = "#f0b341";
const CLI_RED = "#ff6b5b";

function CliDashboard({ signalApi }) {
  const data = window.GREEN_DATA;
  const messages = data.conversation;
  const greenIds = useMemo(() => messages.filter(m => m.role === "green").map(m => m.id), [messages]);
  const [selectedIdx, setSelectedIdx] = useState(greenIds.indexOf("m010") >= 0 ? greenIds.indexOf("m010") : 0);
  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [flash, setFlash] = useState("");
  const [expanded, setExpanded] = useState({});
  const containerRef = useRef(null);
  const transcriptRef = useRef(null);
  const selectedMsg = messages.find(m => m.id === greenIds[selectedIdx]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e) => {
      if (filterMode) {
        if (e.key === "Enter" || e.key === "Escape") {
          setFilterMode(false); e.preventDefault();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "j") { setSelectedIdx(i => Math.min(greenIds.length - 1, i + 1)); e.preventDefault(); }
      else if (k === "k") { setSelectedIdx(i => Math.max(0, i - 1)); e.preventDefault(); }
      else if (k === "g") { setSelectedIdx(0); e.preventDefault(); }
      else if (e.shiftKey && e.key === "G") { setSelectedIdx(greenIds.length - 1); e.preventDefault(); }
      else if (k === "enter") {
        const id = greenIds[selectedIdx];
        setExpanded(x => ({ ...x, [id]: !x[id] }));
        e.preventDefault();
      }
      else if (k === "s" && selectedMsg) {
        signalApi.sendRun(selectedMsg);
        setFlash(`signal ← ${selectedMsg.cmd}`);
        e.preventDefault();
      }
      else if (k === "/") { setFilterMode(true); e.preventDefault(); }
      else if (k === "q") { setFilter(""); e.preventDefault(); }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [greenIds, selectedIdx, selectedMsg, signalApi, filterMode]);

  useEffect(() => {
    if (flash) { const t = setTimeout(() => setFlash(""), 1600); return () => clearTimeout(t); }
  }, [flash]);

  useEffect(() => {
    const node = transcriptRef.current?.querySelector(`[data-id="${greenIds[selectedIdx]}"]`);
    if (node) node.scrollIntoView({ block: "nearest" });
  }, [selectedIdx, greenIds]);

  const filtered = filter
    ? messages.filter(m => (m.text || m.title || (m.blocks||[]).map(b=>b.text||"").join(" ") || "").toLowerCase().includes(filter.toLowerCase()))
    : messages;

  return (
    <div ref={containerRef} tabIndex={0}
      onClick={() => containerRef.current?.focus()}
      style={{
        width: "100%", height: "100%", background: CLI_BG, color: CLI_FG,
        fontFamily: "var(--mono)", fontSize: 12.5, lineHeight: 1.55,
        outline: "none", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
      <Titlebar />
      <div ref={transcriptRef} className="scroll" style={{ flex: "1 1 60%", overflow: "auto", padding: "6px 14px", minHeight: 0 }}>
        <Transcript messages={filtered} selectedId={greenIds[selectedIdx]} expanded={expanded} />
      </div>
      <div style={{ borderTop: `1px solid #1f3028`, background: "#080d0a", flex: "1 1 40%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <TraceHeader msg={selectedMsg} />
        <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "4px 14px 10px" }}>
          {selectedMsg && <CliTrace msg={selectedMsg} />}
        </div>
      </div>
      <CliStatusBar selectedMsg={selectedMsg} flash={flash} filter={filter} filterMode={filterMode} setFilter={setFilter} />
    </div>
  );
}

function Titlebar() {
  return (
    <div style={{ background: "#0c1410", borderBottom: "1px solid #1f3028", padding: "5px 14px", display: "flex", gap: 12, alignItems: "center", fontSize: 11 }}>
      <span style={{ color: CLI_GREEN, fontWeight: 600, letterSpacing: ".06em" }}>● green</span>
      <span style={{ color: CLI_DIM }}>~/code/green</span>
      <span style={{ flex: 1 }}></span>
      <span style={{ color: CLI_DIM }}>signal · linked</span>
    </div>
  );
}

function Transcript({ messages, selectedId, expanded }) {
  return (
    <>
      {messages.map((m, i) => {
        const prev = messages[i-1];
        const showDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
        return (
          <div key={m.id} data-id={m.id}>
            {showDay && (
              <div style={{ color: CLI_DIM, padding: "8px 0 2px" }}>
                ─── {fmtCliDate(m.ts)} ───
              </div>
            )}
            {m.role === "user"
              ? <CliUserLine msg={m} />
              : <CliGreenLine msg={m} active={m.id === selectedId} expanded={!!expanded[m.id]} />}
          </div>
        );
      })}
    </>
  );
}

function CliUserLine({ msg }) {
  return (
    <div style={{ padding: "6px 0 2px" }}>
      <span style={{ color: CLI_DIM }}>{fmtCliTimeFull(msg.ts)} </span>
      <span style={{ color: "#9ed1b4", fontWeight: 600 }}>YOU: </span>
      <span style={{ color: CLI_FG }}>{msg.text}</span>
    </div>
  );
}

function CliGreenLine({ msg, active, expanded }) {
  const cursor = active ? "▌" : " ";
  const headColor = active ? CLI_GREEN : "#9ed1b4";
  return (
    <div style={{ padding: "2px 0 8px", background: active ? "rgba(126,232,176,.04)" : "transparent", borderLeft: `2px solid ${active ? CLI_GREEN : "transparent"}`, paddingLeft: 8, marginLeft: -10 }}>
      <div>
        <span style={{ color: active ? CLI_GREEN : CLI_DIM }}>{cursor} </span>
        <span style={{ color: headColor, fontWeight: 600 }}>GREEN: </span>
        {msg.title && <span style={{ color: CLI_FG }}>{msg.title}</span>}
        <span style={{ color: CLI_DIM }}>  [{msg.channel === "pro" ? "pro" : "api"} · {(msg.latencyMs/1000).toFixed(1)}s · {msg.tokens.toLocaleString()}t]</span>
        {msg.bug && <span style={{ color: CLI_RED }}>  ⚑ bug</span>}
      </div>
      {(expanded || active) && (
        <div style={{ marginLeft: 0, marginTop: 2 }}>
          {msg.blocks.map((b, i) => <CliBlock key={i} b={b} />)}
        </div>
      )}
    </div>
  );
}

function CliBlock({ b }) {
  if (b.kind === "h2") return <div style={{ color: CLI_GREEN, marginTop: 6, marginBottom: 2, fontWeight: 600 }}>{b.text.toUpperCase()}</div>;
  if (b.kind === "h3") return <div style={{ color: "#5fc790", marginTop: 4, marginBottom: 2 }}>{b.text}</div>;
  if (b.kind === "p")  return <div style={{ color: CLI_FG, marginBottom: 4, whiteSpace: "pre-wrap" }}>{b.text}</div>;
  if (b.kind === "list") return (
    <div style={{ marginBottom: 4 }}>
      {b.items.map((it, i) => <div key={i}>  <span style={{ color: CLI_GREEN }}>›</span> {it}</div>)}
    </div>
  );
  if (b.kind === "kv") return (
    <div style={{ marginBottom: 4 }}>
      {b.items.map(([k, v], i) => (
        <div key={i}><span style={{ color: CLI_GREEN }}>{k}:</span> <span style={{ color: CLI_FG }}>{v}</span></div>
      ))}
    </div>
  );
  if (b.kind === "sources") return (
    <div style={{ marginTop: 4, color: CLI_DIM }}>
      Sources:{b.items.map((s, i) => <div key={i}>  - {s}</div>)}
    </div>
  );
  return null;
}

function TraceHeader({ msg }) {
  return (
    <div style={{ padding: "5px 14px", borderBottom: "1px solid #1f3028", color: CLI_DIM, display: "flex", gap: 14, fontSize: 11 }}>
      <span>── trace ──</span>
      {msg && (
        <>
          <span>{msg.cmd}</span>
          <span>{msg.trace.length} steps</span>
          <span>{(msg.latencyMs/1000).toFixed(2)}s total</span>
          <span style={{ color: msg.cost ? CLI_AMBER : CLI_DIM }}>{msg.cost ? `$${msg.cost.toFixed(4)}` : "free"}</span>
          <span>conf {msg.confidence}%</span>
        </>
      )}
    </div>
  );
}

function CliTrace({ msg }) {
  const total = msg.trace.reduce((a, t) => a + t.t, 0);
  const tierGlyph = { free: "·", pro: "+", paid: "$" };
  const tierColor = { free: CLI_GREEN, pro: CLI_AMBER, paid: "#ff8e6b" };
  return (
    <div>
      {msg.trace.map((t, i) => {
        const svc = window.GREEN_DATA.svcMap[t.svc];
        const pct = total ? Math.round(t.t / total * 30) : 0;
        const bar = "█".repeat(pct) + "░".repeat(Math.max(0, 30 - pct));
        return (
          <div key={i} style={{ marginBottom: 6 }}>
            <div>
              <span style={{ color: CLI_DIM }}>{String(i+1).padStart(2, "0")}  </span>
              <span style={{ color: tierColor[svc.tier], width: 14, display: "inline-block" }}>[{tierGlyph[svc.tier]}]</span>
              <span style={{ color: CLI_FG, fontWeight: 600 }}>{svc.name.padEnd(22, " ")}</span>
              <span style={{ color: CLI_DIM }}>{t.step}</span>
            </div>
            <div style={{ marginLeft: 18, color: CLI_DIM, fontSize: 11.5 }}>
              <span style={{ color: tierColor[svc.tier] }}>{bar}</span> {String(t.t).padStart(5, " ")}ms
              {"  "}cap: {svc.cap}
              {"  "}limit: {svc.limit}
              {"  "}risk: <span style={{ color: svc.risk === "high" ? CLI_RED : (svc.risk === "med" ? CLI_AMBER : CLI_GREEN) }}>{svc.risk}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CliStatusBar({ selectedMsg, flash, filter, filterMode, setFilter }) {
  return (
    <div style={{ background: "#0c1410", borderTop: "1px solid #1f3028", padding: "4px 14px", display: "flex", gap: 16, alignItems: "center", fontSize: 11 }}>
      {filterMode ? (
        <>
          <span style={{ color: CLI_GREEN }}>/</span>
          <input autoFocus value={filter} onChange={e => setFilter(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", color: CLI_FG, fontFamily: "var(--mono)", fontSize: 12, outline: "none" }} />
          <span style={{ color: CLI_DIM }}>enter / esc</span>
        </>
      ) : (
        <>
          <span style={{ color: CLI_DIM }}>j/k</span><span style={{ color: CLI_FG }}>nav</span>
          <span style={{ color: CLI_DIM }}>↵</span><span style={{ color: CLI_FG }}>expand</span>
          <span style={{ color: CLI_DIM }}>s</span><span style={{ color: CLI_FG }}>signal</span>
          <span style={{ color: CLI_DIM }}>/</span><span style={{ color: CLI_FG }}>filter</span>
          {filter && <span style={{ color: CLI_AMBER }}>["{filter}"]</span>}
          <span style={{ flex: 1 }}></span>
          {flash && <span style={{ color: CLI_GREEN }}>{flash}</span>}
          {selectedMsg && <span style={{ color: CLI_DIM }}>{selectedMsg.cmd}</span>}
        </>
      )}
    </div>
  );
}

function fmtCliTimeFull(ts) {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}
function fmtCliDate(ts) {
  const d = new Date(ts);
  return d.toDateString();
}

window.CliDashboard = CliDashboard;
