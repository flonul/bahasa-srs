import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── CONFIG SUPABASE (remplace par tes vraies valeurs) ──────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string;
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase      = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── TYPES ───────────────────────────────────────────────────────────────────
type Item = {
  id: number; level: number; type: "vocab"|"grammar"|"expr";
  word: string; reading: string; meaning: string; alt: string[]; hint: string;
};
type UItem = {
  item_id: number; stage: number; next_review: string;
  correct_count: number; wrong_count: number; learned: boolean;
};
type QResult = { item_id: number; correct: boolean };

// ─── SRS ─────────────────────────────────────────────────────────────────────
const SRS = [
  { name:"Apprentice 1", hours:4,       color:"#e06b8b", bg:"#fde8ef" },
  { name:"Apprentice 2", hours:8,       color:"#e06b8b", bg:"#fde8ef" },
  { name:"Apprentice 3", hours:24,      color:"#e06b8b", bg:"#fde8ef" },
  { name:"Apprentice 4", hours:48,      color:"#e06b8b", bg:"#fde8ef" },
  { name:"Guru 1",       hours:168,     color:"#9b59b6", bg:"#f0e6f6" },
  { name:"Guru 2",       hours:336,     color:"#9b59b6", bg:"#f0e6f6" },
  { name:"Master",       hours:720,     color:"#3b82f6", bg:"#e0ecff" },
  { name:"Enlightened",  hours:2880,    color:"#0ea5e9", bg:"#e0f5ff" },
  { name:"Burned",       hours:Infinity,color:"#374151", bg:"#f3f4f6" },
];

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background:"#fff", border:"1px solid #e5e7eb", borderRadius:14
};
const btn = (bg: string, disabled = false): React.CSSProperties => ({
  background: disabled ? "#d1d5db" : bg, color:"#fff", border:"none",
  borderRadius:12, padding:"13px 0", fontSize:15, fontWeight:600,
  cursor: disabled ? "default" : "pointer", width:"100%",
  fontFamily:"inherit", transition:"background .2s",
});
const TYPE_META: Record<string, {bg:string;text:string;label:string}> = {
  vocab:   { bg:"#e06b8b", text:"#fff", label:"Vocabulaire" },
  grammar: { bg:"#9b59b6", text:"#fff", label:"Grammaire"   },
  expr:    { bg:"#f59e0b", text:"#fff", label:"Expression"  },
};

// ─── PETITS COMPOSANTS ────────────────────────────────────────────────────────
function Badge({ type }: { type: string }) {
  const m = TYPE_META[type] ?? TYPE_META.vocab;
  return (
    <span style={{ background:m.bg, color:m.text, padding:"2px 10px",
      borderRadius:99, fontSize:12, fontWeight:500 }}>{m.label}</span>
  );
}
function SrsChip({ stage }: { stage: number }) {
  const s = SRS[stage] ?? SRS[0];
  return (
    <span style={{ background:s.bg, color:s.color, padding:"2px 10px",
      borderRadius:99, fontSize:12, fontWeight:500 }}>{s.name}</span>
  );
}
function Bar({ value, total, color="#3b82f6" }: { value:number; total:number; color?:string }) {
  return (
    <div style={{ height:6, background:"#e5e7eb", borderRadius:99, overflow:"hidden" }}>
      <div style={{ width:`${total ? Math.round(value/total*100) : 0}%`,
        height:"100%", background:color, borderRadius:99, transition:"width .4s" }}/>
    </div>
  );
}

// ─── AUTH FORM ────────────────────────────────────────────────────────────────
function AuthForm() {
  const [mode, setMode]     = useState<"login"|"register">("login");
  const [email, setEmail]   = useState("");
  const [pass, setPass]     = useState("");
  const [err, setErr]       = useState("");
  const [loading, setLoad]  = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setLoad(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password: pass });
        if (error) throw error;
        if (data.user) {
  // Récupère tous les items
  const { data: allItems } = await supabase
    .from("items")
    .select("id");

  if (allItems && allItems.length > 0) {
    const userItems = allItems.map((item: { id: number }) => ({
      user_id: data.user!.id,
      item_id: item.id,
      stage: 0,
      next_review: new Date().toISOString(),
      correct_count: 0,
      wrong_count: 0,
      learned: false,
    }));

    await supabase.from("user_items").insert(userItems);
  }
}
      }
    } catch (e: any) { setErr(e.message); }
    finally { setLoad(false); }
  }

  return (
    <div style={{ maxWidth:360, margin:"80px auto", padding:"0 16px" }}>
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <div style={{ fontSize:36 }}>🇮🇩</div>
        <div style={{ fontSize:24, fontWeight:800, marginTop:8 }}>Bahasa SRS</div>
        <div style={{ color:"#6b7280", fontSize:14, marginTop:4 }}>
          {mode === "login" ? "Connexion" : "Créer un compte"}
        </div>
      </div>
      <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
          placeholder="Email" required
          style={{ padding:"12px 14px", borderRadius:10, border:"1px solid #e5e7eb",
            fontSize:15, outline:"none", fontFamily:"inherit" }}/>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
          placeholder="Mot de passe (min. 6 caractères)" required minLength={6}
          style={{ padding:"12px 14px", borderRadius:10, border:"1px solid #e5e7eb",
            fontSize:15, outline:"none", fontFamily:"inherit" }}/>
        {err && <p style={{ color:"#dc2626", fontSize:13, margin:0 }}>{err}</p>}
        <button type="submit" disabled={loading}
          style={btn(loading ? "#d1d5db" : "#e06b8b", loading)}>
          {loading ? "…" : mode === "login" ? "Se connecter" : "S'inscrire"}
        </button>
      </form>
      <p style={{ textAlign:"center", color:"#6b7280", fontSize:14, marginTop:16 }}>
        {mode === "login" ? "Pas de compte ? " : "Déjà inscrit ? "}
        <button onClick={()=>{ setErr(""); setMode(m=>m==="login"?"register":"login"); }}
          style={{ background:"none", border:"none", color:"#e06b8b",
            cursor:"pointer", fontWeight:600, fontSize:14 }}>
          {mode === "login" ? "S'inscrire" : "Se connecter"}
        </button>
      </p>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ items, uItems, onLesson, onReview, onLogout }: {
  items: Item[]; uItems: UItem[];
  onLesson:()=>void; onReview:()=>void; onLogout:()=>void;
}) {
  const now      = new Date().toISOString();
  const dueCount = uItems.filter(u => u.learned && u.next_review <= now && u.stage < 8).length;
  const lessonCount = items.filter(i => !uItems.find(u=>u.item_id===i.id)?.learned).length;
  const learned  = uItems.filter(u => u.learned);
  const appr     = uItems.filter(u => u.learned && u.stage < 4);
  const guru     = uItems.filter(u => u.stage >= 4 && u.stage < 8);
  const burned   = uItems.filter(u => u.stage === 8);

  const levels = Array.from(new Set(items.map(i=>i.level))).sort((a,b)=>a-b);

  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"20px 14px 60px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800 }}>🇮🇩 Bahasa SRS</div>
          <div style={{ color:"#6b7280", fontSize:13 }}>{items.length} items · {levels.length} niveaux</div>
        </div>
        <button onClick={onLogout}
          style={{ background:"none", border:"1px solid #e5e7eb", borderRadius:8,
            padding:"6px 12px", fontSize:13, color:"#6b7280", cursor:"pointer" }}>
          Déconnexion
        </button>
      </div>

      {/* Boutons */}
      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        <button onClick={onLesson} disabled={lessonCount===0}
          style={{ ...btn("#e06b8b", lessonCount===0), flex:1 }}>
          📚 Leçons ({lessonCount})
        </button>
        <button onClick={onReview} disabled={dueCount===0}
          style={{ ...btn("#3b82f6", dueCount===0), flex:1 }}>
          🔁 Révisions ({dueCount})
        </button>
      </div>

      {/* Progression globale */}
      <div style={{ ...card, padding:"14px 16px", marginBottom:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
          <span style={{ fontWeight:600, fontSize:14 }}>Progression globale</span>
          <span style={{ color:"#6b7280", fontSize:13 }}>{learned.length}/{items.length}</span>
        </div>
        <Bar value={learned.length} total={items.length} color="#e06b8b"/>
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          {[
            { l:"Apprentice", n:appr.length,   c:"#e06b8b" },
            { l:"Guru+",      n:guru.length,    c:"#9b59b6" },
            { l:"Burned 🔥",  n:burned.length,  c:"#374151" },
          ].map(({l,n,c}) => (
            <div key={l} style={{ flex:1, ...card, padding:"10px 6px",
              textAlign:"center", borderRadius:10 }}>
              <div style={{ fontSize:20, fontWeight:700, color:c }}>{n}</div>
              <div style={{ fontSize:11, color:"#6b7280", marginTop:2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Par niveau */}
      <div style={{ fontSize:13, fontWeight:600, color:"#374151", marginBottom:8 }}>Par niveau</div>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {levels.map(lv => {
          const lvItems = items.filter(i => i.level === lv);
          const done    = lvItems.filter(i => uItems.find(u=>u.item_id===i.id)?.learned).length;
          return (
            <div key={lv} style={{ ...card, padding:"10px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontWeight:600, fontSize:13 }}>Niveau {lv}</span>
                <span style={{ fontSize:12, color:"#6b7280" }}>{done}/{lvItems.length}</span>
              </div>
              <Bar value={done} total={lvItems.length}
                color={done===lvItems.length ? "#16a34a" : "#3b82f6"}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── LESSON VIEW ──────────────────────────────────────────────────────────────
function LessonView({ items, onComplete }: {
  items: Item[]; onComplete: (r: QResult[]) => void;
}) {
  const BATCH = Math.min(5, items.length);
  const batch = items.slice(0, BATCH);
  const [idx, setIdx]       = useState(0);
  const [phase, setPhase]   = useState<"learn"|"quiz">("learn");
  const [input, setInput]   = useState("");
  const [mode, setMode]     = useState<"meaning"|"reading">("meaning");
  const [result, setResult] = useState<null|"correct"|"wrong">(null);
  const [results, setResults] = useState<QResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const item = batch[idx];

  function learnNext() {
    if (idx < BATCH-1) setIdx(i=>i+1);
    else { setIdx(0); setPhase("quiz"); setMode(Math.random()<.5?"meaning":"reading"); }
  }

  function check() {
    if (result) {
      const ni = idx+1;
      if (ni >= BATCH) { onComplete(results); return; }
      setIdx(ni); setResult(null); setInput("");
      setMode(Math.random()<.5?"meaning":"reading");
      setTimeout(()=>inputRef.current?.focus(), 50);
      return;
    }
    const ans = input.trim().toLowerCase();
    let ok: boolean;
    if (mode==="meaning") {
      const acc = [item.meaning,...(item.alt??[])].map(s=>s.toLowerCase());
      ok = acc.some(a=>ans===a||a.split(" / ").includes(ans)||(ans.length>3&&a.includes(ans)));
    } else {
      const ref = item.reading.toLowerCase().replace(/-/g,"");
      ok = ans.replace(/-/g,"")=== ref || ans===item.reading.toLowerCase();
    }
    setResult(ok?"correct":"wrong");
    setResults(r=>[...r,{item_id:item.id, correct:ok}]);
  }

  const accent = result==="correct"?"#16a34a":result==="wrong"?"#dc2626":"#e06b8b";

  if (phase==="learn") return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"0 14px" }}>
      <div style={{ background:"#e06b8b", borderRadius:"0 0 20px 20px",
        padding:"18px 20px 26px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <button onClick={()=>onComplete([])}
            style={{ background:"rgba(255,255,255,.2)", border:"none", cursor:"pointer",
              color:"#fff", borderRadius:8, padding:"4px 10px", fontSize:14, fontFamily:"inherit" }}>
            ← Quitter
          </button>
          <span style={{ color:"rgba(255,255,255,.8)", fontSize:13 }}>Leçon {idx+1}/{BATCH}</span>
        </div>
        <div style={{ textAlign:"center" }}>
          <Badge type={item.type}/>
          <div style={{ fontSize:52, fontWeight:800, color:"#fff", margin:"14px 0 4px" }}>{item.word}</div>
          <div style={{ color:"rgba(255,255,255,.8)", fontSize:16 }}>/{item.reading}/</div>
        </div>
      </div>
      <div style={{ padding:"0 6px" }}>
        <div style={{ ...card, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ fontSize:11, color:"#9ca3af", marginBottom:4, textTransform:"uppercase" }}>Sens</div>
          <div style={{ fontSize:20, fontWeight:700 }}>{item.meaning}</div>
          {item.alt?.length>0 &&
            <div style={{ fontSize:13, color:"#6b7280", marginTop:2 }}>Aussi : {item.alt.join(", ")}</div>}
        </div>
        <div style={{ background:"#fffbeb", border:"1px solid #fde68a",
          borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
          <div style={{ fontSize:11, color:"#92400e", marginBottom:4, textTransform:"uppercase" }}>💡 Astuce</div>
          <div style={{ fontSize:14, color:"#78350f" }}>{item.hint}</div>
        </div>
        <button onClick={learnNext} style={btn("#e06b8b")}>
          {idx<BATCH-1 ? "Suivant →" : "Passer au quiz →"}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"0 14px" }}>
      <div style={{ background:accent, borderRadius:"0 0 20px 20px",
        padding:"18px 20px 26px", marginBottom:20, transition:"background .25s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <button onClick={()=>onComplete([])}
            style={{ background:"rgba(255,255,255,.2)", border:"none", cursor:"pointer",
              color:"#fff", borderRadius:8, padding:"4px 10px", fontSize:14, fontFamily:"inherit" }}>
            ← Quitter
          </button>
          <span style={{ color:"rgba(255,255,255,.8)", fontSize:13 }}>Quiz {idx+1}/{BATCH}</span>
          <div style={{ flex:1, height:4, background:"rgba(255,255,255,.3)", borderRadius:99, overflow:"hidden" }}>
            <div style={{ width:`${idx/BATCH*100}%`, height:"100%",
              background:"rgba(255,255,255,.8)", transition:"width .3s" }}/>
          </div>
        </div>
        <div style={{ textAlign:"center" }}>
          <Badge type={item.type}/>
          <div style={{ fontSize:54, fontWeight:800, color:"#fff", margin:"12px 0 6px" }}>{item.word}</div>
          <div style={{ color:"rgba(255,255,255,.75)", fontSize:14 }}>
            {mode==="meaning" ? "Quel est le sens ?" : "Quelle est la lecture ?"}
          </div>
        </div>
      </div>
      <div style={{ padding:"0 6px" }}>
        <input ref={inputRef} autoFocus value={input}
          onChange={e=>{if(!result) setInput(e.target.value)}}
          onKeyDown={e=>e.key==="Enter"&&check()}
          placeholder={mode==="meaning"?"Sens en français…":"Lecture ex: ma-kan…"}
          style={{ width:"100%", boxSizing:"border-box", padding:"13px 14px", fontSize:16,
            border:`2px solid ${result?accent:"#e5e7eb"}`, borderRadius:12, outline:"none",
            marginBottom:10, fontFamily:"inherit",
            background:result?(result==="correct"?"#dcfce7":"#fee2e2"):"#fff" }}/>
        {result && (
          <div style={{ background:result==="correct"?"#dcfce7":"#fee2e2",
            border:`1px solid ${result==="correct"?"#86efac":"#fca5a5"}`,
            borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
            <div style={{ fontWeight:600, color:result==="correct"?"#166534":"#991b1b" }}>
              {result==="correct" ? "✓ Correct !" : `✗  Réponse : ${mode==="meaning"?item.meaning:item.reading}`}
            </div>
            <div style={{ color:"#6b7280", fontSize:13, marginTop:3 }}>💡 {item.hint}</div>
          </div>
        )}
        <button onClick={check} style={btn(accent)}>
          {result ? (idx<BATCH-1?"Suivant →":"Terminer ✓") : "Valider"}
        </button>
      </div>
    </div>
  );
}

// ─── REVIEW VIEW ──────────────────────────────────────────────────────────────
function ReviewView({ dueItems, items, onComplete }: {
  dueItems: UItem[]; items: Item[]; onComplete: (r: QResult[]) => void;
}) {
  const queue = useRef(
    dueItems
      .map(u => items.find(i=>i.id===u.item_id))
      .filter(Boolean) as Item[]
  );
  const qWithMode = useRef(
    queue.current
      .sort(()=>Math.random()-.5)
      .flatMap(item => {
        const qs: {item:Item;mode:"meaning"|"reading"}[] = [{item,mode:"meaning"}];
        if (Math.random()<.4) qs.push({item,mode:"reading"});
        return qs;
      })
  );

  const [idx, setIdx]         = useState(0);
  const [input, setInput]     = useState("");
  const [result, setResult]   = useState<null|"correct"|"wrong">(null);
  const [results, setResults] = useState<QResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = qWithMode.current[idx];

  if (!q) {
    const correct = results.filter(r=>r.correct).length;
    const pct = results.length ? Math.round(correct/results.length*100) : 0;
    return (
      <div style={{ maxWidth:500, margin:"0 auto", padding:"50px 16px", textAlign:"center" }}>
        <div style={{ fontSize:56 }}>{pct>=80?"🎉":pct>=50?"💪":"😅"}</div>
        <div style={{ fontSize:24, fontWeight:700, margin:"14px 0 6px" }}>Session terminée !</div>
        <div style={{ color:"#6b7280" }}>{correct}/{results.length} correctes ({pct}%)</div>
        <div style={{ marginTop:20, ...card, padding:"16px", textAlign:"left" }}>
          {[
            { l:"Correctes",  n:correct,             c:"#16a34a" },
            { l:"Incorrectes",n:results.length-correct,c:"#dc2626"},
            { l:"Précision",  n:pct+"%",             c:"#3b82f6" },
          ].map(({l,n,c})=>(
            <div key={l} style={{ display:"flex", justifyContent:"space-between",
              padding:"7px 0", borderBottom:"1px solid #f3f4f6" }}>
              <span style={{ color:"#6b7280", fontSize:14 }}>{l}</span>
              <span style={{ fontWeight:700, color:c }}>{n}</span>
            </div>
          ))}
        </div>
        <button onClick={()=>onComplete(results)} style={{ ...btn("#3b82f6"), marginTop:20, width:"auto", padding:"13px 40px" }}>
          ← Retour
        </button>
      </div>
    );
  }

  const { item, mode } = q;
  const accent = result==="correct"?"#16a34a":result==="wrong"?"#dc2626":"#3b82f6";

  function check() {
    if (result) {
      setIdx(i=>i+1); setResult(null); setInput("");
      setTimeout(()=>inputRef.current?.focus(), 50);
      return;
    }
    const ans = input.trim().toLowerCase();
    let ok: boolean;
    if (mode==="meaning") {
      const acc = [item.meaning,...(item.alt??[])].map(s=>s.toLowerCase());
      ok = acc.some(a=>ans===a||a.split(" / ").includes(ans)||(ans.length>3&&a.includes(ans)));
    } else {
      const ref = item.reading.toLowerCase().replace(/-/g,"");
      ok = ans.replace(/-/g,"")=== ref || ans===item.reading.toLowerCase();
    }
    setResult(ok?"correct":"wrong");
    setResults(r=>[...r,{item_id:item.id, correct:ok}]);
  }

  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"0 14px" }}>
      <div style={{ background:accent, borderRadius:"0 0 20px 20px",
        padding:"18px 20px 26px", marginBottom:20, transition:"background .25s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <button onClick={()=>onComplete(results)}
            style={{ background:"rgba(255,255,255,.2)", border:"none", cursor:"pointer",
              color:"#fff", borderRadius:8, padding:"4px 10px", fontSize:14, fontFamily:"inherit" }}>
            ← Quitter
          </button>
          <span style={{ color:"rgba(255,255,255,.8)", fontSize:13 }}>{idx+1}/{qWithMode.current.length}</span>
          <div style={{ flex:1, height:4, background:"rgba(255,255,255,.3)", borderRadius:99, overflow:"hidden" }}>
            <div style={{ width:`${idx/qWithMode.current.length*100}%`, height:"100%",
              background:"rgba(255,255,255,.8)", transition:"width .3s" }}/>
          </div>
        </div>
        <div style={{ textAlign:"center" }}>
          <Badge type={item.type}/>
          <div style={{ fontSize:54, fontWeight:800, color:"#fff", margin:"12px 0 4px" }}>{item.word}</div>
          {result
            ? <div style={{ color:"rgba(255,255,255,.8)", fontSize:14 }}>/{item.reading}/</div>
            : <div style={{ color:"rgba(255,255,255,.7)", fontSize:14 }}>
                {mode==="meaning"?"Quel est le sens ?":"Quelle est la lecture ?"}
              </div>
          }
        </div>
      </div>
      <div style={{ padding:"0 6px" }}>
        <input ref={inputRef} autoFocus value={input}
          onChange={e=>{if(!result) setInput(e.target.value)}}
          onKeyDown={e=>e.key==="Enter"&&check()}
          placeholder={mode==="meaning"?"Sens en français…":"Lecture ex: ma-kan…"}
          style={{ width:"100%", boxSizing:"border-box", padding:"13px 14px", fontSize:16,
            border:`2px solid ${result?accent:"#e5e7eb"}`, borderRadius:12, outline:"none",
            marginBottom:10, fontFamily:"inherit",
            background:result?(result==="correct"?"#dcfce7":"#fee2e2"):"#fff" }}/>
        {result && (
          <div style={{ background:result==="correct"?"#dcfce7":"#fee2e2",
            border:`1px solid ${result==="correct"?"#86efac":"#fca5a5"}`,
            borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
            <div style={{ fontWeight:600, color:result==="correct"?"#166534":"#991b1b", fontSize:15 }}>
              {result==="correct" ? "✓ Correct !" : `✗  ${mode==="meaning"?item.meaning:item.reading}`}
            </div>
            <div style={{ color:"#6b7280", fontSize:13, marginTop:3 }}>
              <strong>{item.word}</strong> = {item.meaning} /{item.reading}/
            </div>
            <div style={{ color:"#9ca3af", fontSize:13, marginTop:2 }}>💡 {item.hint}</div>
          </div>
        )}
        <button onClick={check} style={btn(accent)}>
          {result?"Suivant →":"Valider"}
        </button>
      </div>
    </div>
  );
}

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]     = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [items, setItems]   = useState<Item[]>([]);
  const [uItems, setUItems] = useState<UItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView]     = useState<"dashboard"|"lesson"|"review">("dashboard");
  const [saving, setSaving] = useState(false);

  // Écoute l'état de connexion
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Charge les données quand on est connecté
  const loadData = useCallback(async (uid: string) => {
    setLoading(true);
    const [{ data: cat }, { data: prog }] = await Promise.all([
      supabase.from("items").select("*").order("level"),
      supabase.from("user_items").select("*").eq("user_id", uid),
    ]);
    setItems(cat ?? []);
    setUItems(prog ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) loadData(user.id);
  }, [user, loadData]);

  async function applyResults(results: QResult[]) {
    if (!user || !results.length) { setView("dashboard"); return; }
    setSaving(true);
    await supabase.rpc("apply_review_results", {
      p_user_id: user.id,
      p_results: JSON.stringify(results),
    });
    await loadData(user.id);
    setSaving(false);
    setView("dashboard");
  }

  async function logout() {
    await supabase.auth.signOut();
    setItems([]); setUItems([]);
  }

  // ── Rendus ──
  if (!authReady) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:"100vh", fontSize:32 }}>🌀</div>
  );

  if (!user) return <AuthForm />;

  if (loading || saving) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", height:"100vh", gap:12 }}>
      <div style={{ fontSize:32 }}>🌀</div>
      <div style={{ color:"#6b7280" }}>{saving ? "Sauvegarde…" : "Chargement…"}</div>
    </div>
  );

  const now = new Date().toISOString();
  const dueItems    = uItems.filter(u => u.learned && u.next_review <= now && u.stage < 8);
  const lessonItems = items.filter(i => !uItems.find(u=>u.item_id===i.id)?.learned);

  if (view === "lesson") return (
    <LessonView items={lessonItems} onComplete={async r => {
      // Marque tous les items du batch comme learned
      const batch = lessonItems.slice(0, Math.min(5, lessonItems.length));
      const fullResults = batch.map(it => ({
        item_id: it.id,
        correct: r.find(x=>x.item_id===it.id)?.correct ?? true,
      }));
      await applyResults(fullResults);
    }}/>
  );

  if (view === "review") return (
    <ReviewView dueItems={dueItems} items={items} onComplete={applyResults}/>
  );

  return (
    <Dashboard items={items} uItems={uItems}
      onLesson={()=>setView("lesson")}
      onReview={()=>setView("review")}
      onLogout={logout}/>
  );
}