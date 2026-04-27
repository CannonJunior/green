// Web dashboard — Signal chat history is the spine.
// LEFT: full chat thread (scrollable). User bubbles + Green response cards.
// CENTER: when a Green response is selected → its full markdown content.
// RIGHT: trace (services called in order, with caps/limits/risk + per-step latency
//        and tokens), plus today's service-health overview underneath.

const { useState, useMemo, useRef, useEffect } = React;

const TIER_COLOR = { free: "var(--tier-free)", pro: "var(--tier-pro)", paid: "var(--tier-paid)" };
const RISK_COLOR = { low: "var(--g-4)", med: "var(--amber)", high: "var(--red)" };

function fmtTime(ts) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
}

function WebDashboard({ tweaks, signalApi }) {
  const data = window.GREEN_DATA;
  const [selected, setSelected] = useState("m010"); // default to ALPHA
  const [filter, setFilter] = useState("");

  const messages = data.conversation;
  const greenById = useMemo(() => Object.fromEntries(messages.filter(m => m.role === "green").map(m => [m.id, m])), [messages]);
  const sel = greenById[selected];

  const filtered = filter
    ? messages.filter(m => (m.text || m.title || (m.blocks || []).map(b => b.text || "").join(" ") || m.cmd || "").toLowerCase().includes(filter.toLowerCase()))
    : messages;

  return (
    <div style={{ width: "100%", height: "100%", background: "var(--bg-0)", color: "var(--ink-1)", display: "grid", gridTemplateColumns: "440px 1fr 380px", gridTemplateRows: "44px 1fr", overflow: "hidden" }}>
      {/* top bar — full width */}
      <TopBar filter={filter} setFilter={setFilter} />

      {/* LEFT — chat thread */}
      <ChatThread messages={filtered} selected={selected} onSelect={setSelected} />

      {/* CENTER — selected response */}
      <ResponseDetail msg={sel} userMsg={messages.find(m => m.id === sel?.parent)} signalApi={signalApi} />

      {/* RIGHT — trace + service health */}
      <RightRail msg={sel} />
    </div>
  );
}

function TopBar({ filter, setFilter }) {
  return (
    <div style={{ gridColumn: "1 / -1", borderBottom: "1px solid var(--line)", background: "var(--bg-1)", display: "flex", alignItems: "center", padding: "0 16px", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--g-4)", boxShadow: "0 0 12px var(--g-4)" }}></div>
        <span style={{ fontFamily: "var(--mono)", fontWeight: 600, letterSpacing: ".06em", color: "var(--g-6)" }}>GREEN</span>
        <span className="dim mono" style={{ fontSize: 11 }}>signal · web · cli</span>
      </div>
      <div style={{ flex: 1 }}></div>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter conversation…"
        style={{ background: "var(--bg-2)", border: "1px solid var(--line)", color: "var(--ink-1)", borderRadius: 3, padding: "5px 10px", fontFamily: "var(--mono)", fontSize: 12, width: 240, outline: "none" }} />
      <span className="dim mono" style={{ fontSize: 11 }}>{fmtDate(Date.now())}</span>
    </div>
  );
}

function ChatThread({ messages, selected, onSelect }) {
  const ref = useRef(null);
  return (
    <div style={{ borderRight: "1px solid var(--line)", background: "var(--bg-1)", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: ".1em", textTransform: "uppercase" }}>Signal · #green</span>
        <span style={{ flex: 1 }}></span>
        <span className="chip ok"><span className="dot pro"></span>linked</span>
      </div>
      <div ref={ref} className="scroll" style={{ flex: 1, overflow: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((m, i) => {
          const prev = messages[i-1];
          const showDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
          return (
            <React.Fragment key={m.id}>
              {showDay && <DayDivider ts={m.ts} />}
              {m.role === "user"
                ? <UserBubble msg={m} />
                : <GreenBubble msg={m} active={m.id === selected} onClick={() => onSelect(m.id)} />}
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ borderTop: "1px solid var(--line)", padding: "10px 14px", background: "var(--bg-2)", display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dim mono" style={{ fontSize: 11 }}>›</span>
        <span className="dim mono" style={{ fontSize: 12, opacity: .6 }}>type a slash command or "#api …"</span>
      </div>
    </div>
  );
}

function DayDivider({ ts }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 2px" }}>
      <div style={{ flex: 1, height: 1, background: "var(--line)" }}></div>
      <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: ".1em" }}>{fmtDate(ts).toUpperCase()}</span>
      <div style={{ flex: 1, height: 1, background: "var(--line)" }}></div>
    </div>
  );
}

function UserBubble({ msg }) {
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "78%" }}>
      <div style={{ background: "var(--g-3)", color: "var(--g-6)", padding: "8px 12px", borderRadius: "12px 12px 2px 12px", fontFamily: "var(--mono)", fontSize: 12.5, lineHeight: 1.5, wordBreak: "break-word" }}>
        {msg.text}
      </div>
      <div className="mono dim2" style={{ fontSize: 10, textAlign: "right", marginTop: 2 }}>{fmtTime(msg.ts)}</div>
    </div>
  );
}

function GreenBubble({ msg, active, onClick }) {
  const previewText = (msg.title || (msg.blocks && (msg.blocks[0]?.text || (msg.blocks[0]?.items || [])[0])) || msg.cmd || "");
  return (
    <div onClick={onClick} style={{ alignSelf: "flex-start", maxWidth: "92%", cursor: "pointer", outline: active ? "1px solid var(--g-4)" : "none", borderRadius: "12px 12px 12px 2px" }}>
      <div style={{ background: active ? "var(--bg-3)" : "var(--bg-2)", border: "1px solid " + (active ? "var(--g-3)" : "var(--line)"), padding: "10px 12px", borderRadius: "12px 12px 12px 2px", transition: "all .15s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--g-5)", letterSpacing: ".05em" }}>GREEN</span>
          <span className={"chip " + (msg.channel === "pro" ? "pro" : "api")}>{msg.channel === "pro" ? "Pro" : "API"}</span>
          {msg.bug && <span className="chip fail" title={msg.bug.description}>● bug</span>}
          <span style={{ flex: 1 }}></span>
          <span className="mono dim2" style={{ fontSize: 10 }}>{(msg.latencyMs/1000).toFixed(1)}s · {msg.tokens.toLocaleString()}t</span>
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink-1)", lineHeight: 1.5, fontWeight: 600, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {previewText}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {msg.trace.map((t, i) => (
            <ServicePill key={i} svc={window.GREEN_DATA.svcMap[t.svc]} compact />
          ))}
        </div>
      </div>
      <div className="mono dim2" style={{ fontSize: 10, marginTop: 2, marginLeft: 4 }}>{fmtTime(msg.ts)}</div>
    </div>
  );
}

function ServicePill({ svc, compact, active, onClick }) {
  if (!svc) return null;
  return (
    <span onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: compact ? "1px 7px" : "3px 9px",
      borderRadius: 3,
      fontFamily: "var(--mono)", fontSize: compact ? 10.5 : 11.5,
      background: active ? "var(--bg-4)" : "var(--bg-3)",
      border: "1px solid " + (active ? TIER_COLOR[svc.tier] : "var(--line)"),
      color: "var(--ink-2)",
      cursor: onClick ? "pointer" : "default",
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 1, background: TIER_COLOR[svc.tier] }}></span>
      {svc.name}
    </span>
  );
}

// ── center: full Green response with the actual markdown-ish content ──
function ResponseDetail({ msg, userMsg, signalApi }) {
  if (!msg) return <div style={{ background: "var(--bg-0)" }}></div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-0)" }}>
      <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: ".1em", textTransform: "uppercase" }}>Response</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--g-5)", fontWeight: 600 }}>{msg.cmd}</span>
        <span className="dim mono" style={{ fontSize: 11 }}>{userMsg?.text}</span>
        <span style={{ flex: 1 }}></span>
        <button onClick={() => signalApi.sendRun(msg)} style={{
          all: "unset", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11,
          padding: "5px 12px", borderRadius: 3, background: "var(--g-3)", color: "var(--g-6)",
          border: "1px solid var(--g-4)",
        }}>resend → signal</button>
      </div>
      <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
        <ResponseBody msg={msg} />
        {msg.bug && <BugCallout bug={msg.bug} />}
        <Stats msg={msg} />
      </div>
    </div>
  );
}

function ResponseBody({ msg }) {
  return (
    <div style={{ fontFamily: "var(--mono)", fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-1)" }}>
      {msg.title && <h2 style={{ fontFamily: "var(--mono)", fontSize: 16, color: "var(--g-6)", margin: "0 0 14px", letterSpacing: ".02em", fontWeight: 700 }}>{msg.title}</h2>}
      {msg.blocks.map((b, i) => <Block key={i} b={b} />)}
    </div>
  );
}

function Block({ b }) {
  if (b.kind === "h2") return <h3 style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--g-5)", letterSpacing: ".1em", textTransform: "uppercase", margin: "20px 0 8px", fontWeight: 600 }}>{b.text}</h3>;
  if (b.kind === "h3") return <h4 style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--g-4)", letterSpacing: ".15em", textTransform: "uppercase", margin: "16px 0 6px", fontWeight: 600 }}>{b.text}</h4>;
  if (b.kind === "p")  return <p style={{ margin: "0 0 10px", color: "var(--ink-1)" }}>{b.text}</p>;
  if (b.kind === "list") return (
    <ul style={{ margin: "0 0 10px", paddingLeft: 0, listStyle: "none" }}>
      {b.items.map((it, i) => (
        <li key={i} style={{ display: "flex", gap: 10, padding: "3px 0" }}>
          <span style={{ color: "var(--g-4)" }}>›</span>
          <span style={{ flex: 1 }}>{it}</span>
        </li>
      ))}
    </ul>
  );
  if (b.kind === "kv") return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 4, columnGap: 16, margin: "0 0 10px" }}>
      {b.items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <div style={{ color: "var(--g-5)" }}>{k}:</div>
          <div style={{ color: "var(--ink-2)" }}>{v}</div>
        </React.Fragment>
      ))}
    </div>
  );
  if (b.kind === "sources") return (
    <div style={{ marginTop: 12, padding: "10px 12px", border: "1px dashed var(--line-2)", borderRadius: 4, background: "var(--bg-1)" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: ".15em", textTransform: "uppercase", marginBottom: 6 }}>Sources</div>
      {b.items.map((s, i) => (
        <div key={i} style={{ fontSize: 11.5, color: "var(--ink-2)", padding: "2px 0", wordBreak: "break-all" }}>
          <span style={{ color: "var(--ink-4)" }}>[{i+1}]</span> {s}
        </div>
      ))}
    </div>
  );
  return null;
}

function BugCallout({ bug }) {
  return (
    <div style={{ marginTop: 16, padding: "10px 12px", border: "1px solid var(--red-d)", background: "rgba(255,107,91,.06)", borderRadius: 4, fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-2)" }}>
      <span className="chip fail" style={{ marginRight: 8 }}>{bug.severity || "bug"}</span>
      {bug.description}
    </div>
  );
}

function Stats({ msg }) {
  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px dashed var(--line)", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
      <Stat label="latency" value={`${(msg.latencyMs/1000).toFixed(2)}s`} />
      <Stat label="tokens" value={msg.tokens.toLocaleString()} />
      <Stat label="cost" value={msg.cost === 0 ? "free" : `$${msg.cost.toFixed(4)}`} accent={msg.cost > 0 ? "amber" : "g"} />
      <Stat label="confidence" value={`${msg.confidence}%`} />
    </div>
  );
}

function Stat({ label, value, accent }) {
  const color = accent === "amber" ? "var(--amber)" : "var(--g-5)";
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: ".15em", textTransform: "uppercase" }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, color, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ── right rail: per-response trace, then service-health overview ──
function RightRail({ msg }) {
  return (
    <div style={{ borderLeft: "1px solid var(--line)", background: "var(--bg-1)", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {msg && <TraceView msg={msg} />}
      <ServiceHealth />
    </div>
  );
}

function TraceView({ msg }) {
  const total = msg.trace.reduce((a, t) => a + t.t, 0);
  return (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: ".1em", textTransform: "uppercase" }}>Processing trace</span>
        <span style={{ flex: 1 }}></span>
        <span className="mono dim2" style={{ fontSize: 10 }}>{msg.trace.length} steps · {(total/1000).toFixed(2)}s</span>
      </div>
      <div className="scroll" style={{ maxHeight: 360, overflow: "auto", padding: "8px 8px" }}>
        {msg.trace.map((t, i) => {
          const svc = window.GREEN_DATA.svcMap[t.svc];
          const pct = total ? Math.max(2, Math.round(t.t / total * 100)) : 0;
          return (
            <div key={i} style={{ padding: "8px 10px", borderRadius: 4, marginBottom: 4, background: i % 2 ? "transparent" : "rgba(255,255,255,.012)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", width: 16 }}>{String(i+1).padStart(2, "0")}</span>
                <ServicePill svc={svc} compact />
                <span style={{ flex: 1 }}></span>
                <span className="mono dim2" style={{ fontSize: 10 }}>{t.t}ms</span>
              </div>
              <div style={{ marginLeft: 24 }}>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginBottom: 4 }}>{t.step}</div>
                <div style={{ height: 3, background: "var(--bg-3)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: pct + "%", background: TIER_COLOR[svc?.tier || "free"] }}></div>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <span className="mono dim2" style={{ fontSize: 10 }}>cap: <span style={{ color: "var(--ink-3)" }}>{svc?.cap}</span></span>
                  <span className="mono dim2" style={{ fontSize: 10 }}>limit: <span style={{ color: "var(--ink-3)" }}>{svc?.limit}</span></span>
                  <span className="mono dim2" style={{ fontSize: 10 }}>risk: <span style={{ color: RISK_COLOR[svc?.risk] }}>●</span></span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ServiceHealth() {
  const data = window.GREEN_DATA;
  const tally = {};
  data.conversation.filter(m => m.role === "green").forEach(m => {
    m.trace.forEach(t => {
      tally[t.svc] = tally[t.svc] || { calls: 0, ms: 0, tok: 0 };
      tally[t.svc].calls++;
      tally[t.svc].ms += t.t;
      tally[t.svc].tok += t.tokens;
    });
  });
  const rows = data.SERVICES.map(s => ({ svc: s, ...(tally[s.id] || { calls: 0, ms: 0, tok: 0 }) }))
    .sort((a, b) => b.calls - a.calls);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: ".1em", textTransform: "uppercase" }}>Service health · today</span>
      </div>
      <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {rows.map((r, i) => (
          <div key={r.svc.id} style={{ display: "grid", gridTemplateColumns: "12px 1fr 50px 50px", alignItems: "center", gap: 8, padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,.02)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 1, background: TIER_COLOR[r.svc.tier] }}></span>
            <div style={{ minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 11.5, color: r.calls ? "var(--ink-1)" : "var(--ink-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.svc.name}</div>
              <div className="mono dim2" style={{ fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.svc.cap}</div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", textAlign: "right" }}>{r.calls || "—"}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textAlign: "right" }}>{r.ms ? r.ms + "ms" : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.WebDashboard = WebDashboard;
