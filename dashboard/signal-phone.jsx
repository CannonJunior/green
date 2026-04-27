// Signal phone — what the user actually sees on their device.
// Renders the same conversation as a Signal-style chat: user bubbles right,
// Green replies left. New messages from the dashboard append at the bottom.

const { useEffect, useRef, useMemo } = React;

function SignalPhone({ signalApi, theme = "dark" }) {
  const data = window.GREEN_DATA;
  const baseMessages = data.conversation;

  const live = signalApi?.messages || [];
  const typing = signalApi?.typing;

  const all = useMemo(() => {
    const extra = live.map((m, i) => {
      if (m.role === "user") return { id: "live-u-"+i, role: "user", ts: m.ts, text: m.text };
      if (m.kind === "run" && m.payload) return { ...m.payload, id: "live-g-"+i, role: "green", ts: m.ts, parent: null };
      if (m.kind === "digest" && m.payload) return { id: "live-g-"+i, role: "green", ts: m.ts, cmd: "/digest",
        channel: "pro",
        title: "Digest — last 7 days",
        blocks: [
          { kind: "kv", items: [
            ["runs", String(m.payload.stats?.total ?? "—")],
            ["ok", String(m.payload.stats?.ok ?? "—")],
            ["tokens", (m.payload.stats?.tokens ?? 0).toLocaleString()],
          ] },
        ],
        latencyMs: 800, tokens: 240, confidence: 92, cost: 0,
        trace: [{ svc: "claude-pro", step: "build digest", t: 800, tokens: 240 }],
      };
      return null;
    }).filter(Boolean);
    return [...baseMessages, ...extra];
  }, [baseMessages, live]);

  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [all.length, typing]);

  const dark = theme !== "light";
  const C = dark
    ? { bg: "#0a0f0c", card: "#11201a", line: "#1f3028", ink: "#e8f5ec", dim: "#7a8e82", out: "#2d6a4a", outInk: "#c8ffdd", in: "#1a2820", inInk: "#e8f5ec" }
    : { bg: "#f4faf6", card: "#ffffff", line: "#dbe7e0", ink: "#0a0f0c", dim: "#5b7768", out: "#3fb87a", outInk: "#06120a", in: "#e6f1ea", inInk: "#0a0f0c" };

  return (
    <div style={{
      width: 340, height: 700, borderRadius: 38, background: "#000",
      padding: 8, boxShadow: "0 30px 80px rgba(0,0,0,.6), 0 0 0 1px #222 inset",
      position: "relative",
    }}>
      <div style={{
        width: "100%", height: "100%", background: C.bg, borderRadius: 32, overflow: "hidden",
        display: "flex", flexDirection: "column", color: C.ink, fontFamily: "var(--sans)",
      }}>
        {/* status bar */}
        <div style={{ height: 28, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
          <span>2:31</span>
          <span style={{ width: 80, height: 18, background: "#000", borderRadius: 12 }}></span>
          <span>●●●●●</span>
        </div>
        {/* nav header */}
        <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: C.dim, fontSize: 18 }}>‹</span>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--g-3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#06120a", fontFamily: "var(--mono)", fontWeight: 700 }}>g</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Green</div>
            <div style={{ fontSize: 11, color: C.dim, fontFamily: "var(--mono)" }}>signal-cli · localhost</div>
          </div>
          <span style={{ color: C.dim, fontSize: 16 }}>⋯</span>
        </div>
        {/* messages */}
        <div ref={scrollRef} className="scroll" style={{ flex: 1, overflow: "auto", padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {all.map((m, i) => {
            const prev = all[i-1];
            const showDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
            return (
              <React.Fragment key={m.id}>
                {showDay && <SDay ts={m.ts} C={C} />}
                {m.role === "user" ? <SUser msg={m} C={C} /> : <SGreen msg={m} C={C} />}
              </React.Fragment>
            );
          })}
          {typing && <STyping C={C} />}
        </div>
        {/* composer */}
        <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 32, borderRadius: 16, background: dark ? "#1a2820" : "#e6f1ea", display: "flex", alignItems: "center", padding: "0 12px", color: C.dim, fontFamily: "var(--mono)", fontSize: 12 }}>
            Signal message
          </div>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--g-3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#06120a" }}>↑</div>
        </div>
        {/* home indicator */}
        <div style={{ height: 18, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ width: 110, height: 4, borderRadius: 2, background: dark ? "#2c3a32" : "#aebcb3" }}></div>
        </div>
      </div>
    </div>
  );
}

function SDay({ ts, C }) {
  const d = new Date(ts);
  return (
    <div style={{ alignSelf: "center", color: C.dim, fontFamily: "var(--mono)", fontSize: 10, padding: "4px 0" }}>
      {d.toDateString()}
    </div>
  );
}

function SUser({ msg, C }) {
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "82%" }}>
      <div style={{ background: C.out, color: C.outInk, padding: "7px 11px", borderRadius: "16px 16px 4px 16px", fontFamily: "var(--mono)", fontSize: 12.5, lineHeight: 1.4, wordBreak: "break-word" }}>
        {msg.text}
      </div>
      <div style={{ fontSize: 9.5, color: C.dim, textAlign: "right", marginTop: 2, fontFamily: "var(--mono)" }}>{fmtSTime(msg.ts)} ✓✓</div>
    </div>
  );
}

function SGreen({ msg, C }) {
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
      <div style={{ background: C.in, color: C.inInk, padding: "8px 11px", borderRadius: "16px 16px 16px 4px", fontSize: 12.5, lineHeight: 1.45 }}>
        {msg.title && <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, fontWeight: 700, color: "var(--g-5)", marginBottom: 4 }}>{msg.title}</div>}
        {(msg.blocks || []).slice(0, 4).map((b, i) => <SBlock key={i} b={b} C={C} />)}
        {msg.blocks && msg.blocks.length > 4 && <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.dim, marginTop: 4 }}>… {msg.blocks.length - 4} more</div>}
      </div>
      <div style={{ fontSize: 9.5, color: C.dim, marginTop: 2, marginLeft: 4, fontFamily: "var(--mono)" }}>
        {fmtSTime(msg.ts)} · {msg.channel === "pro" ? "pro" : "api"} · {(msg.latencyMs/1000).toFixed(1)}s
      </div>
    </div>
  );
}

function SBlock({ b, C }) {
  if (b.kind === "h2") return <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--g-4)", textTransform: "uppercase", letterSpacing: ".1em", marginTop: 6, marginBottom: 2 }}>{b.text}</div>;
  if (b.kind === "h3") return <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--g-4)", textTransform: "uppercase", letterSpacing: ".1em", marginTop: 4, marginBottom: 2 }}>{b.text}</div>;
  if (b.kind === "p")  return <div style={{ marginBottom: 4, fontFamily: "var(--mono)" }}>{b.text}</div>;
  if (b.kind === "list") return (
    <div style={{ marginBottom: 4, fontFamily: "var(--mono)" }}>
      {b.items.slice(0, 4).map((it, i) => <div key={i}><span style={{ color: "var(--g-4)" }}>›</span> {it}</div>)}
    </div>
  );
  if (b.kind === "kv") return (
    <div style={{ marginBottom: 4, fontFamily: "var(--mono)" }}>
      {b.items.slice(0, 6).map(([k, v], i) => (
        <div key={i}><span style={{ color: "var(--g-4)" }}>{k}:</span> {v}</div>
      ))}
    </div>
  );
  if (b.kind === "sources") return (
    <div style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: 10.5, color: C.dim }}>
      {b.items.length} source{b.items.length !== 1 ? "s" : ""}
    </div>
  );
  return null;
}

function STyping({ C }) {
  return (
    <div style={{ alignSelf: "flex-start", background: C.in, color: C.dim, padding: "8px 12px", borderRadius: "16px 16px 16px 4px", fontFamily: "var(--mono)", fontSize: 12 }}>
      green is typing<span style={{ animation: "blink 1.2s infinite" }}>…</span>
    </div>
  );
}

function fmtSTime(ts) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

window.SignalPhone = SignalPhone;
