import { useState, useEffect, useRef, useCallback } from "react";

/* ─── HARDCODED API KEYS ──────────────────────────────────────────────────── */
const GROQ_API_KEY   = "";
const HS_API_KEY     = "";
const HS_BASE_URL    = "https://api.hindsight.vectorize.io";

/* ─── GLOBAL CSS ──────────────────────────────────────────────────────────── */
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07090f;--surf:#0d1018;--surf2:#111520;--brd:#1c2235;--brd2:#242b3d;
  --txt:#c4d4e8;--dim:#4a5a72;--mute:#2a3548;
  --grn:#00e5a0;--grnd:#00e5a018;--blu:#3d9aff;--blud:#3d9aff12;
  --red:#ff5e6e;--redd:#ff5e6e12;--gld:#f5c842;--gldd:#f5c84212;
  --pur:#a78bfa;--purd:#a78bfa12;
  --mono:'Space Mono',monospace;--sans:'Bricolage Grotesque',sans-serif;
}
body{background:var(--bg);font-family:var(--mono);color:var(--txt)}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--brd2);border-radius:2px}
::selection{background:#00e5a030}
.blink{animation:blink 1s step-end infinite}
@keyframes blink{50%{opacity:0}}
.spin{animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.fade-in{animation:fadeIn .35s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.slide-up{animation:slideUp .45s cubic-bezier(.16,1,.3,1) both}
@keyframes slideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
input,textarea,select{outline:none;transition:border-color .2s}
`;

/* ─── HINDSIGHT CLIENT ────────────────────────────────────────────────────── */
class HindsightClient {
  constructor() {
    this.base = HS_BASE_URL;
    this.key  = HS_API_KEY;
  }
  _h() {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.key}`,
    };
  }
  // bank path: /v1/default/banks/{bankId}/...
  _url(bankId, op) {
    return `${this.base}/v1/default/banks/${bankId}/${op}`;
  }
  async retain(bankId, content) {
    const r = await fetch(this._url(bankId, "retain"), {
      method: "POST", headers: this._h(),
      body: JSON.stringify({ items: [{ content }] }),
    });
    if (!r.ok) throw new Error(`Retain ${r.status}: ${await r.text()}`);
    return r.json();
  }
  async recall(bankId, query) {
    const r = await fetch(this._url(bankId, "recall"), {
      method: "POST", headers: this._h(),
      body: JSON.stringify({ query, limit: 8 }),
    });
    if (!r.ok) throw new Error(`Recall ${r.status}: ${await r.text()}`);
    return r.json();
  }
  async reflect(bankId, query) {
    const r = await fetch(this._url(bankId, "reflect"), {
      method: "POST", headers: this._h(),
      body: JSON.stringify({ query }),
    });
    if (!r.ok) throw new Error(`Reflect ${r.status}: ${await r.text()}`);
    return r.json();
  }
  // Use /version endpoint — lightweight, no auth required, confirms server is reachable
  async ping() {
    try {
      const r = await fetch(`${this.base}/version`, {
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    } catch { return false; }
  }
}

/* ─── GROQ CLIENT ─────────────────────────────────────────────────────────── */
async function groq(messages, onChunk) {
  const stream = !!onChunk;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 1024,
      stream,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Groq ${res.status}`);
  }
  if (!stream) {
    const d = await res.json();
    return d.choices[0].message.content;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n")) {
      if (!line.startsWith("data:")) continue;
      const s = line.slice(5).trim();
      if (s === "[DONE]") break;
      try {
        const delta = JSON.parse(s).choices?.[0]?.delta?.content;
        if (delta) { full += delta; onChunk(full); }
      } catch {}
    }
  }
  return full;
}

/* ─── LOCAL STORAGE ───────────────────────────────────────────────────────── */
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ─── PRIMITIVES ──────────────────────────────────────────────────────────── */
const C = {
  green:"var(--grn)",blue:"var(--blu)",red:"var(--red)",gold:"var(--gld)",purple:"var(--pur)"
};
const D = {
  green:"var(--grnd)",blue:"var(--blud)",red:"var(--redd)",gold:"var(--gldd)",purple:"var(--purd)"
};

const Spinner = ({ sz = 13 }) => (
  <span style={{ display:"inline-block", width:sz, height:sz,
    border:"2px solid var(--brd2)", borderTopColor:"var(--grn)",
    borderRadius:"50%", flexShrink:0 }} className="spin" />
);

const Tag = ({ color = "green", children }) => (
  <span style={{ background:D[color], border:`1px solid ${C[color]}30`,
    borderRadius:4, padding:"2px 8px", fontSize:".6rem",
    color:C[color], fontFamily:"var(--mono)", whiteSpace:"nowrap" }}>
    {children}
  </span>
);

const Btn = ({ children, onClick, color = "green", disabled, small, full, outline, style: sx }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: small ? "6px 14px" : "10px 22px",
    width: full ? "100%" : undefined,
    background: outline ? "transparent" : disabled ? "#1c2235" : C[color],
    color: outline ? C[color] : disabled ? "var(--dim)" : "#07090f",
    border: outline ? `1px solid ${C[color]}50` : "none",
    borderRadius: 7, fontFamily:"var(--mono)",
    fontSize: small ? ".65rem" : ".72rem",
    fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    transition:"all .15s", whiteSpace:"nowrap", ...sx,
  }}>{children}</button>
);

/* ─── MARKDOWN LITE ───────────────────────────────────────────────────────── */
function MD({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  const els = [];
  let inCode = false, buf = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("```")) {
      if (!inCode) { inCode = true; buf = []; }
      else {
        els.push(
          <pre key={i} style={{ background:"var(--bg)", border:"1px solid var(--brd)",
            borderRadius:8, padding:"12px 14px", fontSize:".7rem",
            overflowX:"auto", lineHeight:1.7, color:"var(--grn)", margin:"10px 0" }}>
            <code>{buf.join("\n")}</code>
          </pre>
        );
        inCode = false;
      }
      continue;
    }
    if (inCode) { buf.push(l); continue; }
    if (!l.trim()) { els.push(<div key={i} style={{ height:8 }} />); continue; }
    const isH = /^#{1,3}\s/.test(l);
    const html = l.replace(/^#+\s/, "")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, `<code style="background:var(--bg);padding:1px 5px;border-radius:3px;color:var(--grn);font-size:.7rem">$1</code>`);
    els.push(
      <div key={i} dangerouslySetInnerHTML={{ __html: html }}
        style={{ fontSize:".75rem", lineHeight:1.85,
          color: isH ? "#e0eaf8" : "var(--dim)",
          fontWeight: isH ? 700 : 400,
          margin: isH ? "10px 0 4px" : 0 }} />
    );
  }
  return <div>{els}</div>;
}

/* ─── MEMORY BADGES ───────────────────────────────────────────────────────── */
function MemBadges({ memories }) {
  if (!memories?.length) return null;
  return (
    <div style={{ background:"var(--blud)", border:"1px solid var(--blu)25",
      borderRadius:8, padding:"10px 14px", fontSize:".67rem", lineHeight:1.9, color:"var(--blu)" }}>
      <div style={{ fontWeight:700, marginBottom:6, letterSpacing:".05em", fontSize:".6rem" }}>
        🧠 HINDSIGHT RECALLED
      </div>
      {memories.map((m, i) => (
        <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
          <span style={{ opacity:.5 }}>›</span>
          <span style={{ color:"var(--dim)" }}>{m.text || m.content || JSON.stringify(m)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── NAME ONBOARDING (minimal) ──────────────────────────────────────────── */
function NameScreen({ onDone }) {
  const [name, setName] = useState("");

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", display:"flex",
      alignItems:"center", justifyContent:"center", padding:24 }}>
      <style>{GLOBAL_CSS}</style>
      <div className="slide-up" style={{ width:"100%", maxWidth:420, background:"var(--surf)",
        border:"1px solid var(--brd)", borderRadius:18, padding:40 }}>
        <div style={{ fontFamily:"var(--sans)", fontWeight:800, fontSize:"1.9rem", color:"#fff", lineHeight:1.1, marginBottom:8 }}>
          code<span style={{ color:"var(--grn)" }}>mentor</span>
          <span style={{ display:"inline-block", width:3, height:"1.2em",
            background:"var(--grn)", marginLeft:3, verticalAlign:"middle" }} className="blink" />
        </div>
        <p style={{ fontSize:".75rem", color:"var(--dim)", marginBottom:28, lineHeight:1.7 }}>
          Powered by <Tag color="green">Groq LLaMA-3.3-70B</Tag> + <Tag color="blue">Hindsight Memory</Tag>
          <br/><br/>An AI mentor that remembers every mistake you make — so you stop repeating them.
        </p>
        <label style={{ display:"block", fontSize:".6rem", color:"var(--dim)",
          letterSpacing:".1em", textTransform:"uppercase", marginBottom:6 }}>Your Name</label>
        <input
          autoFocus
          placeholder="e.g. Arjun Mehta"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && name.trim() && onDone(name.trim())}
          style={{ width:"100%", background:"var(--bg)", border:"1px solid var(--brd)",
            borderRadius:8, padding:"11px 14px", color:"var(--txt)", fontFamily:"var(--mono)",
            fontSize:".8rem", marginBottom:14 }}
          onFocus={e => e.target.style.borderColor = "var(--grn)"}
          onBlur={e => e.target.style.borderColor = "var(--brd)"}
        />
        <Btn onClick={() => name.trim() && onDone(name.trim())} full disabled={!name.trim()}>
          Start Learning →
        </Btn>
      </div>
    </div>
  );
}

/* ─── SIDEBAR ─────────────────────────────────────────────────────────────── */
function Sidebar({ tab, setTab, profile, hsOk }) {
  const tabs = [
    { id:"practice",  icon:"⌨", label:"Code Review"    },
    { id:"challenge", icon:"⚡", label:"Challenges"     },
    { id:"path",      icon:"🗺", label:"Learning Path"  },
    { id:"memory",    icon:"🧠", label:"Memory Browser" },
  ];
  const xpLevel = Math.floor((profile.xp || 0) / 100) + 1;
  const xpPct   = (profile.xp || 0) % 100;

  return (
    <aside style={{ width:220, minHeight:"100vh", background:"var(--surf)",
      borderRight:"1px solid var(--brd)", display:"flex", flexDirection:"column",
      padding:"20px 14px", gap:18, flexShrink:0 }}>

      <div style={{ fontFamily:"var(--sans)", fontWeight:800, fontSize:"1.05rem",
        color:"#fff", letterSpacing:"-.02em" }}>
        code<span style={{ color:"var(--grn)" }}>mentor</span>
        <span style={{ display:"inline-block", width:2, height:"1em",
          background:"var(--grn)", marginLeft:2, verticalAlign:"middle" }} className="blink" />
      </div>

      {/* Profile card */}
      <div style={{ background:"var(--surf2)", border:"1px solid var(--brd)",
        borderRadius:10, padding:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--grnd)",
            border:"1px solid var(--grn)40", display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:".85rem", fontWeight:700,
            color:"var(--grn)", flexShrink:0 }}>
            {(profile.name || "?")[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontFamily:"var(--sans)", fontWeight:700,
              color:"#e0eaf8", fontSize:".8rem" }}>{profile.name}</div>
            <div style={{ fontSize:".6rem", color:"var(--grn)" }}>
              Lvl {xpLevel} · {profile.xp || 0} XP
            </div>
          </div>
        </div>
        <div style={{ height:3, background:"var(--brd)", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${xpPct}%`,
            background:"linear-gradient(90deg,var(--grn),var(--blu))",
            borderRadius:2, transition:"width .4s" }} />
        </div>
      </div>

      {/* Stats */}
      <div>
        {[["Sessions", profile.sessions||0], ["Solved", profile.solved||0], ["Patterns", profile.patterns||0]].map(([l,v]) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0",
            borderBottom:"1px solid var(--brd)", fontSize:".67rem", color:"var(--dim)" }}>
            <span>{l}</span>
            <span style={{ color:"var(--grn)", fontWeight:700 }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Hindsight status */}
      <div style={{ display:"flex", alignItems:"center", gap:7, fontSize:".62rem" }}>
        <span style={{ width:6, height:6, borderRadius:"50%",
          background: hsOk ? "var(--grn)" : "var(--red)", flexShrink:0,
          boxShadow: hsOk ? "0 0 6px var(--grn)" : "0 0 6px var(--red)" }} />
        <span style={{ color: hsOk ? "var(--grn)" : "var(--red)" }}>
          Hindsight {hsOk ? "connected" : "connecting…"}
        </span>
      </div>

      {/* Nav */}
      <nav style={{ display:"flex", flexDirection:"column", gap:3 }}>
        {tabs.map(({ id, icon, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            display:"flex", alignItems:"center", gap:9, padding:"9px 10px",
            borderRadius:7,
            background: tab === id ? "var(--grnd)" : "transparent",
            border: tab === id ? "1px solid var(--grn)25" : "1px solid transparent",
            color: tab === id ? "var(--grn)" : "var(--dim)",
            fontFamily:"var(--mono)", fontSize:".68rem", cursor:"pointer",
            textAlign:"left", transition:"all .15s",
          }}>
            <span>{icon}</span>{label}
          </button>
        ))}
      </nav>

      <div style={{ marginTop:"auto", display:"flex", flexDirection:"column", gap:8 }}>
        <div style={{ fontSize:".58rem", color:"var(--mute)", lineHeight:1.7,
          borderTop:"1px solid var(--brd)", paddingTop:10 }}>
          🧠 Hindsight Cloud<br/>
          ⚡ Groq LLaMA-3.3-70B
        </div>
        <button
          onClick={() => { localStorage.removeItem("mentor:name"); window.location.reload(); }}
          style={{ background:"none", border:"1px solid var(--brd)", borderRadius:7,
            padding:"7px 10px", color:"var(--mute)", fontSize:".62rem",
            fontFamily:"var(--mono)", cursor:"pointer", transition:"all .15s",
            textAlign:"left", width:"100%" }}
          onMouseEnter={e => { e.currentTarget.style.color="var(--red)"; e.currentTarget.style.borderColor="var(--redd)"; }}
          onMouseLeave={e => { e.currentTarget.style.color="var(--mute)"; e.currentTarget.style.borderColor="var(--brd)"; }}
        >
          ⎋ &nbsp;Log out
        </button>
      </div>
    </aside>
  );
}

/* ─── PRACTICE TAB ────────────────────────────────────────────────────────── */
function PracticeTab({ hs, bankId, profile, setProfile }) {
  const LANGS = ["python","javascript","typescript","java","c++","go","rust","c#","swift","kotlin"];
  const [lang, setLang]       = useState("python");
  const [code, setCode]       = useState("# Write your solution here\n\ndef solve(nums):\n    pass\n");
  const [problem, setProblem] = useState("");
  const [memories, setMemories] = useState([]);
  const [stream, setStream]   = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [retained, setRetained] = useState(false);

  const submit = async () => {
    if (!code.trim() || loading) return;
    setLoading(true); setFeedback(""); setStream(""); setMemories([]); setRetained(false);
    try {
      // 1. RECALL
      let mems = [];
      try {
        const q = `Student coding in ${lang}${problem ? ". Problem: " + problem : ""}.`;
        const r = await hs.recall(bankId, q);
        mems = r.results || r.memories || [];
        setMemories(mems);
      } catch (e) { console.warn("Recall failed:", e.message); }

      const memCtx = mems.length
        ? `\nHINDSIGHT MEMORIES (student's documented patterns):\n${mems.map(m => `- ${m.text || m.content || m}`).join("\n")}\n`
        : "";

      // 2. GROQ
      const sys = `You are an expert coding mentor with a perfect memory of this student's history.${memCtx}
Review the submitted code:
- Identify bugs, anti-patterns, and style issues clearly
- If memory shows recurring mistakes, call them out explicitly by name
- Provide a corrected code snippet if relevant
- End your response with a JSON block: \`\`\`json\n{"mistakes":["label1","label2"],"xp":15,"summary":"one sentence"}\n\`\`\`
  (mistakes = short labels like "off-by-one", "nested loop instead of hashmap"; xp = 5–30 based on quality)
Tone: direct, educational, friendly. Max 350 words.`;

      let raw = "";
      await groq(
        [{ role:"system", content:sys },
         { role:"user", content:`Language: ${lang}\n${problem ? "Problem: "+problem+"\n" : ""}Code:\n\`\`\`\n${code}\n\`\`\`` }],
        t => { raw = t; setStream(t); }
      );

      // 3. Parse
      const jm = raw.match(/```json\s*([\s\S]*?)```/);
      let mistakes = [], xp = 10, summary = "";
      if (jm) { try { const m = JSON.parse(jm[1]); mistakes = m.mistakes||[]; xp = m.xp||10; summary = m.summary||""; } catch {} }
      setFeedback(raw.replace(/```json[\s\S]*?```/, "").trim());
      setStream("");

      // 4. RETAIN
      if (mistakes.length || summary) {
        try {
          await hs.retain(bankId,
            `Student submitted ${lang} code${problem ? " for: "+problem : ""}. ` +
            (mistakes.length ? `Mistakes found: ${mistakes.join(", ")}. ` : "") +
            (summary ? `Summary: ${summary}` : "")
          );
          setRetained(true);
        } catch (e) { console.warn("Retain failed:", e.message); }
      }

      setProfile(p => ({
        ...p,
        sessions:  (p.sessions  || 0) + 1,
        xp:        (p.xp        || 0) + xp,
        patterns:  (p.patterns  || 0) + mistakes.length,
      }));
    } catch (e) {
      setFeedback("⚠ " + e.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div>
        <div style={{ fontFamily:"var(--sans)", fontWeight:800, fontSize:"1.4rem", color:"#fff" }}>Code Review</div>
        <div style={{ fontSize:".68rem", color:"var(--dim)", marginTop:3 }}>
          Recall patterns → Groq analyzes → Retain new insights in Hindsight
        </div>
      </div>

      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <select value={lang} onChange={e => setLang(e.target.value)}
          style={{ background:"var(--surf2)", border:"1px solid var(--brd)", borderRadius:7,
            color:"var(--txt)", fontFamily:"var(--mono)", fontSize:".68rem",
            padding:"6px 10px", cursor:"pointer" }}>
          {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <input placeholder="Problem description (optional)…" value={problem}
          onChange={e => setProblem(e.target.value)}
          style={{ flex:1, background:"var(--surf2)", border:"1px solid var(--brd)",
            borderRadius:7, color:"var(--txt)", fontFamily:"var(--mono)",
            fontSize:".68rem", padding:"6px 12px" }}
          onFocus={e => e.target.style.borderColor = "var(--grn)30"}
          onBlur={e => e.target.style.borderColor = "var(--brd)"}
        />
      </div>

      <div style={{ position:"relative" }}>
        <div style={{ position:"absolute", top:10, right:12,
          fontSize:".6rem", color:"var(--mute)", zIndex:1 }}>{lang}</div>
        <textarea value={code} onChange={e => setCode(e.target.value)}
          style={{ width:"100%", minHeight:220, background:"var(--surf2)",
            border:"1px solid var(--brd)", borderRadius:10,
            color:"#a8e6c4", fontFamily:"var(--mono)", fontSize:".75rem",
            padding:16, resize:"vertical", lineHeight:1.8, caretColor:"var(--grn)" }}
          onFocus={e => e.target.style.borderColor = "var(--brd2)"}
          onBlur={e => e.target.style.borderColor = "var(--brd)"}
        />
      </div>

      <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <Btn onClick={submit} disabled={loading || !code.trim()}>
          {loading
            ? <span style={{ display:"flex", alignItems:"center", gap:8 }}><Spinner />Analyzing…</span>
            : "⟶ Submit for Review"}
        </Btn>
        {retained && <Tag color="green">✓ Hindsight Updated</Tag>}
        {memories.length > 0 && <Tag color="blue">🧠 {memories.length} memories recalled</Tag>}
      </div>

      {memories.length > 0 && <MemBadges memories={memories} />}

      {(stream || feedback) && (
        <div className="fade-in" style={{ background:"var(--surf2)",
          border:"1px solid var(--brd)", borderRadius:10, padding:18 }}>
          <div style={{ fontSize:".6rem", color:"var(--mute)",
            letterSpacing:".1em", marginBottom:12 }}>MENTOR FEEDBACK</div>
          <MD text={stream || feedback} />
          {loading && <span style={{ display:"inline-block", width:8, height:14,
            background:"var(--grn)", marginLeft:2 }} className="blink" />}
        </div>
      )}
    </div>
  );
}

/* ─── CHALLENGE TAB ───────────────────────────────────────────────────────── */
function ChallengeTab({ hs, bankId, profile, setProfile }) {
  const [loading, setLoading]   = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [solution, setSolution] = useState("");
  const [stream, setStream]     = useState("");
  const [feedback, setFeedback] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [memories, setMemories] = useState([]);
  const [retained, setRetained] = useState(false);

  const generate = async () => {
    setLoading(true); setChallenge(null); setFeedback(""); setSolution(""); setMemories([]); setRetained(false);
    try {
      let mems = [];
      try {
        const r = await hs.recall(bankId, "student recurring mistakes and weak programming areas");
        mems = r.results || r.memories || [];
        setMemories(mems);
      } catch {}

      const memCtx = mems.length
        ? `Known weak areas: ${mems.map(m => m.text || m.content || m).join("; ")}`
        : "No history yet — generate a solid intermediate challenge.";

      const sys = "You are a coding challenge generator. Return ONLY valid JSON, no markdown, no text outside the JSON.";
      const user = `Generate a personalized coding challenge for ${profile.name}.
${memCtx}
Return JSON: {"title":"...","difficulty":"Easy|Medium|Hard","description":"...","examples":[{"input":"...","output":"..."}],"starterCode":"# Python starter\\n...","hints":["...","..."],"tags":["..."]}`;

      const raw = await groq([{ role:"system", content:sys }, { role:"user", content:user }]);
      const c = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setChallenge(c);
      setSolution(c.starterCode || "");
    } catch (e) {
      setChallenge({ title:"Error", description:"⚠ " + e.message, difficulty:"?", examples:[], hints:[], tags:[], starterCode:"" });
    }
    setLoading(false);
  };

  const review = async () => {
    if (!solution.trim() || reviewing) return;
    setReviewing(true); setStream(""); setFeedback(""); setRetained(false);
    try {
      let mems = [];
      try {
        const r = await hs.recall(bankId, challenge.title + " solution review coding patterns");
        mems = r.results || r.memories || [];
      } catch {}

      const memCtx = mems.length
        ? `Student's known patterns:\n${mems.map(m => `- ${m.text || m.content || m}`).join("\n")}`
        : "";

      const sys = `You are a coding mentor reviewing a challenge solution.${memCtx ? "\n" + memCtx : ""}
Challenge: ${challenge.title} — ${challenge.description}
Note if student avoided or repeated known mistakes. Be concise.
End with \`\`\`json\n{"passed":true|false,"xp":10,"mistakes":[]}\n\`\`\``;

      let raw = "";
      await groq(
        [{ role:"system", content:sys },
         { role:"user", content:`Solution:\n\`\`\`\n${solution}\n\`\`\`` }],
        t => { raw = t; setStream(t); }
      );

      const jm = raw.match(/```json\s*([\s\S]*?)```/);
      let passed = false, xp = 10, mistakes = [];
      if (jm) { try { const m = JSON.parse(jm[1]); passed = m.passed; xp = m.xp||10; mistakes = m.mistakes||[]; } catch {} }
      setFeedback(raw.replace(/```json[\s\S]*?```/, "").trim());
      setStream("");

      try {
        await hs.retain(bankId,
          `Student attempted "${challenge.title}" (${challenge.difficulty}). ` +
          (passed ? "Passed. " : "Needs work. ") +
          (mistakes.length ? `Mistakes: ${mistakes.join(", ")}` : "")
        );
        setRetained(true);
      } catch {}

      if (passed) setProfile(p => ({ ...p, solved:(p.solved||0)+1, xp:(p.xp||0)+xp }));
    } catch (e) { setFeedback("⚠ " + e.message); }
    setReviewing(false);
  };

  const dc = { Easy:"green", Medium:"gold", Hard:"red" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div>
        <div style={{ fontFamily:"var(--sans)", fontWeight:800, fontSize:"1.4rem", color:"#fff" }}>Personalized Challenges</div>
        <div style={{ fontSize:".68rem", color:"var(--dim)", marginTop:3 }}>
          Hindsight recalls your weak spots → Groq crafts a targeted problem
        </div>
      </div>

      <Btn onClick={generate} disabled={loading}>
        {loading
          ? <span style={{ display:"flex", alignItems:"center", gap:8 }}><Spinner />Crafting challenge…</span>
          : "⚡ Generate Challenge"}
      </Btn>

      {memories.length > 0 && <MemBadges memories={memories} />}

      {challenge && (
        <div className="fade-in">
          <div style={{ background:"var(--surf2)", border:"1px solid var(--brd)",
            borderRadius:12, padding:20, marginBottom:14 }}>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
              <div style={{ fontFamily:"var(--sans)", fontWeight:700, color:"#fff", fontSize:"1rem" }}>
                {challenge.title}
              </div>
              {challenge.difficulty && <Tag color={dc[challenge.difficulty] || "blue"}>{challenge.difficulty}</Tag>}
              {(challenge.tags || []).map(t => <Tag key={t} color="purple">{t}</Tag>)}
            </div>
            <div style={{ fontSize:".74rem", color:"var(--dim)", lineHeight:1.8, marginBottom:12 }}>
              {challenge.description}
            </div>
            {(challenge.examples || []).map((ex, i) => (
              <div key={i} style={{ background:"var(--bg)", border:"1px solid var(--brd)",
                borderRadius:7, padding:"8px 12px", marginBottom:8,
                fontSize:".68rem", fontFamily:"var(--mono)" }}>
                <span style={{ color:"var(--mute)" }}>in: </span>
                <span style={{ color:"var(--grn)" }}>{ex.input}</span>
                <span style={{ color:"var(--mute)", marginLeft:16 }}>out: </span>
                <span style={{ color:"var(--blu)" }}>{ex.output}</span>
              </div>
            ))}
            {(challenge.hints || []).length > 0 && (
              <details style={{ marginTop:8 }}>
                <summary style={{ fontSize:".65rem", color:"var(--dim)", cursor:"pointer", userSelect:"none" }}>
                  💡 Hints
                </summary>
                {challenge.hints.map((h, i) => (
                  <div key={i} style={{ fontSize:".68rem", color:"var(--dim)",
                    padding:"4px 0 4px 12px", borderLeft:"2px solid var(--gldd)40", margin:"4px 0" }}>
                    {h}
                  </div>
                ))}
              </details>
            )}
          </div>

          <div style={{ fontSize:".6rem", color:"var(--mute)", letterSpacing:".1em", marginBottom:6 }}>
            YOUR SOLUTION
          </div>
          <textarea value={solution} onChange={e => setSolution(e.target.value)}
            style={{ width:"100%", minHeight:200, background:"var(--surf2)",
              border:"1px solid var(--brd)", borderRadius:10, color:"#a8e6c4",
              fontFamily:"var(--mono)", fontSize:".75rem", padding:14,
              resize:"vertical", lineHeight:1.8 }}
          />

          <div style={{ display:"flex", gap:10, alignItems:"center", marginTop:10, flexWrap:"wrap" }}>
            <Btn onClick={review} disabled={reviewing || !solution.trim()}>
              {reviewing
                ? <span style={{ display:"flex", alignItems:"center", gap:8 }}><Spinner />Reviewing…</span>
                : "✓ Submit Solution"}
            </Btn>
            {retained && <Tag color="green">✓ Hindsight Updated</Tag>}
          </div>

          {(stream || feedback) && (
            <div className="fade-in" style={{ background:"var(--surf2)",
              border:"1px solid var(--brd)", borderRadius:10, padding:18, marginTop:14 }}>
              <MD text={stream || feedback} />
              {reviewing && <span style={{ display:"inline-block", width:8, height:14,
                background:"var(--grn)", marginLeft:2 }} className="blink" />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── LEARNING PATH TAB ───────────────────────────────────────────────────── */
function PathTab({ hs, bankId, profile }) {
  const [loading, setLoading]   = useState(false);
  const [weeks, setWeeks]       = useState([]);
  const [memories, setMemories] = useState([]);

  const generate = async () => {
    setLoading(true); setWeeks([]); setMemories([]);
    try {
      let mems = [];
      try {
        const r = await hs.recall(bankId, "student overall progress mistakes languages strengths weaknesses");
        mems = r.results || r.memories || [];
        setMemories(mems);
      } catch {}

      const memCtx = mems.length
        ? `Student history:\n${mems.map(m => `- ${m.text || m.content || m}`).join("\n")}`
        : "No history — create a well-rounded beginner-to-intermediate path.";

      const sys = "You are a learning path advisor. Return ONLY a JSON array, no markdown.";
      const user = `Create a 6-week plan for ${profile.name}.\n${memCtx}\nReturn:[{"week":1,"topic":"...","focus":"...","goal":"...","resource":"...","tags":["..."]},...] (exactly 6 items)`;

      const raw = await groq([{ role:"system", content:sys }, { role:"user", content:user }]);
      setWeeks(JSON.parse(raw.replace(/```json|```/g, "").trim()));
    } catch { setWeeks([]); }
    setLoading(false);
  };

  const wc = ["green","blue","purple","gold","red","green"];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div>
        <div style={{ fontFamily:"var(--sans)", fontWeight:800, fontSize:"1.4rem", color:"#fff" }}>Learning Path</div>
        <div style={{ fontSize:".68rem", color:"var(--dim)", marginTop:3 }}>
          Hindsight analyzes your full history → personalized 6-week plan
        </div>
      </div>

      <Btn onClick={generate} disabled={loading}>
        {loading
          ? <span style={{ display:"flex", alignItems:"center", gap:8 }}><Spinner />Building path…</span>
          : "🗺 Generate My Path"}
      </Btn>

      {memories.length > 0 && <MemBadges memories={memories} />}

      {weeks.length > 0 && (
        <div className="fade-in">
          {weeks.map((w, i) => {
            const col = wc[i % wc.length];
            return (
              <div key={i} style={{ display:"grid", gridTemplateColumns:"56px 1fr",
                gap:14, padding:"16px 0", borderBottom:"1px solid var(--brd)" }}>
                <div style={{ width:48, height:48, borderRadius:10,
                  background:`${C[col]}10`, border:`1px solid ${C[col]}30`,
                  display:"flex", flexDirection:"column", alignItems:"center",
                  justifyContent:"center", flexShrink:0 }}>
                  <div style={{ fontSize:".55rem", color:C[col], opacity:.7 }}>WK</div>
                  <div style={{ fontSize:"1rem", fontWeight:700, color:C[col] }}>{w.week}</div>
                </div>
                <div>
                  <div style={{ fontFamily:"var(--sans)", fontWeight:700,
                    color:"#e0eaf8", fontSize:".85rem" }}>{w.topic}</div>
                  <div style={{ fontSize:".7rem", color:"var(--dim)",
                    marginTop:3, lineHeight:1.6 }}>{w.focus}</div>
                  {w.goal && <div style={{ fontSize:".67rem", color:C[col], marginTop:5 }}>🎯 {w.goal}</div>}
                  {w.resource && <div style={{ fontSize:".62rem", color:"var(--mute)", marginTop:4 }}>📚 {w.resource}</div>}
                  <div style={{ marginTop:6, display:"flex", gap:5, flexWrap:"wrap" }}>
                    {(w.tags || []).map(t => <Tag key={t} color={col}>{t}</Tag>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── MEMORY BROWSER TAB ──────────────────────────────────────────────────── */
function MemoryTab({ hs, bankId }) {
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState(null);
  const [reflection, setReflection] = useState("");
  const [loading, setLoading]     = useState(false);
  const [mode, setMode]           = useState("recall");
  const [manual, setManual]       = useState("");
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  const search = async () => {
    if (!query.trim() || loading) return;
    setLoading(true); setResults(null); setReflection("");
    try {
      if (mode === "recall") {
        const r = await hs.recall(bankId, query);
        setResults(r.results || r.memories || []);
      } else {
        const r = await hs.reflect(bankId, query);
        setReflection(r.text || r.answer || JSON.stringify(r));
      }
    } catch (e) {
      setResults([]);
      setReflection("⚠ " + e.message);
    }
    setLoading(false);
  };

  const saveManual = async () => {
    if (!manual.trim() || saving) return;
    setSaving(true);
    try {
      await hs.retain(bankId, manual);
      setManual(""); setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div>
        <div style={{ fontFamily:"var(--sans)", fontWeight:800, fontSize:"1.4rem", color:"#fff" }}>Memory Browser</div>
        <div style={{ fontSize:".68rem", color:"var(--dim)", marginTop:3 }}>
          Explore, search, and add to Hindsight's knowledge about your journey
        </div>
      </div>

      <div style={{ display:"flex", gap:8 }}>
        {["recall","reflect"].map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding:"6px 16px", borderRadius:6, fontFamily:"var(--mono)",
            fontSize:".65rem", fontWeight:700, cursor:"pointer",
            background: mode === m ? "var(--grnd)" : "transparent",
            border: mode === m ? "1px solid var(--grn)30" : "1px solid var(--brd)",
            color: mode === m ? "var(--grn)" : "var(--dim)",
          }}>
            {m === "recall" ? "🔍 Recall" : "🔮 Reflect"}
          </button>
        ))}
        <div style={{ fontSize:".62rem", color:"var(--mute)", alignSelf:"center", marginLeft:4 }}>
          {mode === "recall" ? "Raw memory search" : "AI synthesis from memories"}
        </div>
      </div>

      <div style={{ display:"flex", gap:10 }}>
        <input
          placeholder={mode === "recall" ? "e.g. 'python off-by-one errors'" : "e.g. 'What are my biggest weaknesses?'"}
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search()}
          style={{ flex:1, background:"var(--surf2)", border:"1px solid var(--brd)",
            borderRadius:8, color:"var(--txt)", fontFamily:"var(--mono)",
            fontSize:".72rem", padding:"9px 14px" }}
          onFocus={e => e.target.style.borderColor = "var(--blu)50"}
          onBlur={e => e.target.style.borderColor = "var(--brd)"}
        />
        <Btn onClick={search} disabled={loading || !query.trim()} color="blue">
          {loading ? <Spinner /> : "Search"}
        </Btn>
      </div>

      {results !== null && (
        <div className="fade-in">
          {results.length === 0
            ? <div style={{ fontSize:".72rem", color:"var(--mute)", padding:20, textAlign:"center" }}>No memories found.</div>
            : results.map((r, i) => (
              <div key={i} style={{ background:"var(--surf2)", border:"1px solid var(--brd)",
                borderRadius:8, padding:"12px 14px", marginBottom:8 }}>
                <div style={{ fontSize:".72rem", color:"var(--dim)", lineHeight:1.7 }}>
                  {r.text || r.content || JSON.stringify(r)}
                </div>
                {r.score != null && (
                  <div style={{ fontSize:".6rem", color:"var(--mute)", marginTop:4 }}>
                    relevance: {(r.score * 100).toFixed(0)}%
                  </div>
                )}
              </div>
            ))
          }
        </div>
      )}

      {reflection && (
        <div className="fade-in" style={{ background:"var(--blud)",
          border:"1px solid var(--blu)25", borderRadius:10, padding:18 }}>
          <div style={{ fontSize:".6rem", color:"var(--blu)",
            letterSpacing:".1em", marginBottom:10 }}>HINDSIGHT REFLECTION</div>
          <MD text={reflection} />
        </div>
      )}

      {/* Manual retain */}
      <div style={{ background:"var(--surf2)", border:"1px solid var(--brd)",
        borderRadius:10, padding:16 }}>
        <div style={{ fontSize:".6rem", color:"var(--mute)", letterSpacing:".1em", marginBottom:10 }}>
          MANUALLY ADD MEMORY
        </div>
        <textarea
          placeholder="E.g. 'I consistently forget to handle edge cases with empty arrays'"
          value={manual} onChange={e => setManual(e.target.value)}
          style={{ width:"100%", minHeight:70, background:"var(--bg)",
            border:"1px solid var(--brd)", borderRadius:7, color:"var(--txt)",
            fontFamily:"var(--mono)", fontSize:".7rem", padding:10, resize:"vertical" }}
        />
        <div style={{ display:"flex", gap:10, alignItems:"center", marginTop:8 }}>
          <Btn onClick={saveManual} disabled={saving || !manual.trim()} color="green" small>
            {saving ? <Spinner /> : "Retain Memory"}
          </Btn>
          {saved && <Tag color="green">✓ Stored in Hindsight</Tag>}
        </div>
      </div>
    </div>
  );
}

/* ─── ROOT APP ────────────────────────────────────────────────────────────── */
const hs = new HindsightClient();

export default function App() {
  const [name, setName]       = useState(null);
  const [tab, setTab]         = useState("practice");
  const [hsOk, setHsOk]       = useState(false);
  const [profile, setProfile] = useState({ name:"", xp:0, sessions:0, solved:0, patterns:0 });

  // Load saved name
  useEffect(() => {
    const saved = LS.get("mentor:name", null);
    if (saved) {
      setName(saved);
      setProfile(p => ({ ...p, name: saved }));
    }
  }, []);

  // Ping Hindsight on mount
  useEffect(() => {
    hs.ping().then(ok => setHsOk(ok));
  }, []);

  const handleName = useCallback((n) => {
    LS.set("mentor:name", n);
    setName(n);
    setProfile(p => ({ ...p, name: n }));
  }, []);

  if (!name) return <NameScreen onDone={handleName} />;

  const bankId = `mentor-${name.toLowerCase().replace(/\s+/g, "-")}`;
  const tp = { hs, bankId, profile, setProfile };

  return (
    <div style={{ display:"flex", minHeight:"100vh" }}>
      <style>{GLOBAL_CSS}</style>
      <Sidebar tab={tab} setTab={setTab} profile={profile} hsOk={hsOk} />
      <main style={{ flex:1, padding:"28px 32px", overflowY:"auto", background:"var(--bg)" }}>
        {tab === "practice"  && <PracticeTab  {...tp} />}
        {tab === "challenge" && <ChallengeTab {...tp} />}
        {tab === "path"      && <PathTab      {...tp} />}
        {tab === "memory"    && <MemoryTab    {...tp} />}
      </main>
    </div>
  );
}
