import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase     = createClient(SUPABASE_URL, SUPABASE_KEY);

type Item  = { id:number; level:number; type:string; word:string; reading:string; meaning:string; alt:string[]; hint:string; };
type UItem = { item_id:number; stage:number; next_review:string; correct_count:number; wrong_count:number; learned:boolean; };
type QResult = { item_id:number; correct:boolean };
type Direction = "id_fr" | "fr_id";

const SRS_STAGES = ["Apprentice 1","Apprentice 2","Apprentice 3","Apprentice 4","Guru 1","Guru 2","Master","Enlightened","Burned"];

// Couleurs par direction
const DIR = {
  id_fr: { bg:"#9b59b6", label:"🇮🇩 → 🇫🇷", prompt:"Quel est le sens en français ?" },
  fr_id: { bg:"#e06b8b", label:"🇫🇷 → 🇮🇩", prompt:"Comment dit-on en indonésien ?" },
};

const TYPE_META: Record<string,{bg:string;text:string;label:string}> = {
  vocab:   { bg:"#e06b8b", text:"#fff", label:"Vocabulaire" },
  grammar: { bg:"#9b59b6", text:"#fff", label:"Grammaire"   },
  expr:    { bg:"#f59e0b", text:"#fff", label:"Expression"  },
};

const card: React.CSSProperties = { background:"#fff", border:"1px solid #e5e7eb", borderRadius:14 };
const btn = (bg:string, disabled=false): React.CSSProperties => ({
  background: disabled?"#d1d5db":bg, color:"#fff", border:"none",
  borderRadius:12, padding:"13px 0", fontSize:15, fontWeight:600,
  cursor: disabled?"default":"pointer", width:"100%", fontFamily:"inherit", transition:"background .2s",
});

function Badge({ type }:{ type:string }) {
  const m = TYPE_META[type] ?? TYPE_META.vocab;
  return <span style={{ background:m.bg, color:m.text, padding:"2px 10px", borderRadius:99, fontSize:12, fontWeight:500 }}>{m.label}</span>;
}

function Bar({ value, total, color="#3b82f6" }:{ value:number; total:number; color?:string }) {
  return (
    <div style={{ height:6, background:"#e5e7eb", borderRadius:99, overflow:"hidden" }}>
      <div style={{ width:`${total?Math.round(value/total*100):0}%`, height:"100%", background:color, borderRadius:99, transition:"width .4s" }}/>
    </div>
  );
}

// ─── CHECK ANSWER ─────────────────────────────────────────────────────────────
function checkAnswer(input: string, item: Item, dir: Direction): boolean {
  const ans = input.trim().toLowerCase();
  if (dir === "id_fr") {
    const accepted = [item.meaning, ...(item.alt??[])].map(s=>s.toLowerCase());
    return accepted.some(a => ans===a || a.split(" / ").includes(ans) || (ans.length>3 && a.includes(ans)));
  } else {
    const accepted = [item.word].map(s=>s.toLowerCase());
    return accepted.some(a => ans===a || (ans.length>2 && a.includes(ans)));
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthForm() {
  const [mode, setMode]   = useState<"login"|"register">("login");
  const [email, setEmail] = useState("");
  const [pass, setPass]   = useState("");
  const [err, setErr]     = useState("");
  const [load, setLoad]   = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setLoad(true);
    try {
      if (mode==="login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password:pass });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password:pass });
        if (error) throw error;
        if (data.user) {
          const { data: allItems } = await supabase.from("items").select("id");
          if (allItems?.length) {
            await supabase.from("user_items").insert(
              allItems.map((it:any) => ({
                user_id:data.user!.id, item_id:it.id, stage:0,
                next_review:new Date().toISOString(),
                correct_count:0, wrong_count:0, learned:false,
              }))
            );
          }
        }
      }
    } catch(e:any) { setErr(e.message); }
    finally { setLoad(false); }
  }

  return (
    <div style={{ maxWidth:360, margin:"80px auto", padding:"0 16px" }}>
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <div style={{ fontSize:36 }}>🇮🇩</div>
        <div style={{ fontSize:24, fontWeight:800, marginTop:8 }}>Bahasa SRS</div>
        <div style={{ color:"#6b7280", fontSize:14, marginTop:4 }}>{mode==="login"?"Connexion":"Créer un compte"}</div>
      </div>
      <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" required
          style={{ padding:"12px 14px", borderRadius:10, border:"1px solid #e5e7eb", fontSize:15, outline:"none", fontFamily:"inherit" }}/>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Mot de passe (min. 6 caractères)" required minLength={6}
          style={{ padding:"12px 14px", borderRadius:10, border:"1px solid #e5e7eb", fontSize:15, outline:"none", fontFamily:"inherit" }}/>
        {err && <p style={{ color:"#dc2626", fontSize:13, margin:0 }}>{err}</p>}
        <button type="submit" disabled={load} style={btn(load?"#d1d5db":"#e06b8b", load)}>
          {load?"…":mode==="login"?"Se connecter":"S'inscrire"}
        </button>
      </form>
      <p style={{ textAlign:"center", color:"#6b7280", fontSize:14, marginTop:16 }}>
        {mode==="login"?"Pas de compte ? ":"Déjà inscrit ? "}
        <button onClick={()=>{setErr("");setMode(m=>m==="login"?"register":"login")}}
          style={{ background:"none", border:"none", color:"#e06b8b", cursor:"pointer", fontWeight:600, fontSize:14 }}>
          {mode==="login"?"S'inscrire":"Se connecter"}
        </button>
      </p>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ items, uItems, onLesson, onReview, onLogout }:{
  items:Item[]; uItems:UItem[]; onLesson:()=>void; onReview:()=>void; onLogout:()=>void;
}) {
  const now      = new Date().toISOString();
  const dueCount = uItems.filter(u=>u.learned && u.next_review<=now && u.stage<8).length;
  const lessonCount = items.filter(i=>!uItems.find(u=>u.item_id===i.id)?.learned).length;
  const learned  = uItems.filter(u=>u.learned);
  const appr     = uItems.filter(u=>u.learned && u.stage<4);
  const guru     = uItems.filter(u=>u.stage>=4 && u.stage<8);
  const burned   = uItems.filter(u=>u.stage===8);
  const levels   = Array.from(new Set(items.map(i=>i.level))).sort((a,b)=>a-b);

  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"20px 14px 60px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800 }}>🇮🇩 Bahasa SRS</div>
          <div style={{ color:"#6b7280", fontSize:13 }}>{items.length} items · {levels.length} niveaux</div>
        </div>
        <button onClick={onLogout} style={{ background:"none", border:"1px solid #e5e7eb",
          borderRadius:8, padding:"6px 12px", fontSize:13, color:"#6b7280", cursor:"pointer" }}>
          Déconnexion
        </button>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        <button onClick={onLesson} disabled={lessonCount===0} style={{ ...btn("#e06b8b",lessonCount===0), flex:1 }}>
          📚 Leçons ({lessonCount})
        </button>
        <button onClick={onReview} disabled={dueCount===0} style={{ ...btn("#3b82f6",dueCount===0), flex:1 }}>
          🔁 Révisions ({dueCount})
        </button>
      </div>

      <div style={{ ...card, padding:"14px 16px", marginBottom:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
          <span style={{ fontWeight:600, fontSize:14 }}>Progression globale</span>
          <span style={{ color:"#6b7280", fontSize:13 }}>{learned.length}/{items.length}</span>
        </div>
        <Bar value={learned.length} total={items.length} color="#e06b8b"/>
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          {[
            { l:"Apprentice", n:appr.length,  c:"#e06b8b" },
            { l:"Guru+",      n:guru.length,   c:"#9b59b6" },
            { l:"Burned 🔥",  n:burned.length, c:"#374151" },
          ].map(({l,n,c})=>(
            <div key={l} style={{ flex:1, ...card, padding:"10px 6px", textAlign:"center", borderRadius:10 }}>
              <div style={{ fontSize:20, fontWeight:700, color:c }}>{n}</div>
              <div style={{ fontSize:11, color:"#6b7280", marginTop:2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:"#374151", marginBottom:8 }}>Par niveau</div>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {levels.map(lv=>{
          const lvItems = items.filter(i=>i.level===lv);
          const done    = lvItems.filter(i=>uItems.find(u=>u.item_id===i.id)?.learned).length;
          return (
            <div key={lv} style={{ ...card, padding:"10px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontWeight:600, fontSize:13 }}>Niveau {lv}</span>
                <span style={{ fontSize:12, color:"#6b7280" }}>{done}/{lvItems.length}</span>
              </div>
              <Bar value={done} total={lvItems.length} color={done===lvItems.length?"#16a34a":"#3b82f6"}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── QUIZ CARD (partagé leçon + révision) ────────────────────────────────────
function QuizCard({ item, dir, questionNum, totalQuestions, onResult, onQuit }: {
  item: Item; dir: Direction; questionNum: number; totalQuestions: number;
  onResult: (correct: boolean) => void; onQuit: () => void;
}) {
  const [input, setInput]   = useState("");
  const [result, setResult] = useState<null|"correct"|"wrong">(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset quand l'item change
  useEffect(() => { setInput(""); setResult(null); setTimeout(()=>inputRef.current?.focus(),50); }, [item.id, dir]);

  const accentBg = result==="correct" ? "#16a34a" : result==="wrong" ? "#dc2626" : DIR[dir].bg;
  const displayed = dir==="id_fr" ? item.word : item.meaning;
  const expected  = dir==="id_fr" ? item.meaning : item.word;

  function check() {
    if (result) { onResult(result==="correct"); return; }
    const ok = checkAnswer(input, item, dir);
    setResult(ok?"correct":"wrong");
  }

  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"0 14px" }}>
      {/* Header coloré */}
      <div style={{ background:accentBg, borderRadius:"0 0 20px 20px",
        padding:"18px 20px 26px", marginBottom:20, transition:"background .25s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <button onClick={onQuit} style={{ background:"rgba(255,255,255,.2)", border:"none",
            cursor:"pointer", color:"#fff", borderRadius:8, padding:"4px 10px",
            fontSize:14, fontFamily:"inherit" }}>← Quitter</button>
          <span style={{ color:"rgba(255,255,255,.8)", fontSize:13 }}>
            {questionNum}/{totalQuestions}
          </span>
          <div style={{ flex:1, height:4, background:"rgba(255,255,255,.3)", borderRadius:99, overflow:"hidden" }}>
            <div style={{ width:`${(questionNum-1)/totalQuestions*100}%`, height:"100%",
              background:"rgba(255,255,255,.8)", transition:"width .3s" }}/>
          </div>
          {/* Badge direction */}
          <span style={{ background:"rgba(255,255,255,.2)", color:"#fff",
            padding:"2px 8px", borderRadius:99, fontSize:11, fontWeight:600 }}>
            {DIR[dir].label}
          </span>
        </div>
        <div style={{ textAlign:"center" }}>
          <Badge type={item.type}/>
          <div style={{ fontSize: displayed.length > 15 ? 28 : 52,
            fontWeight:800, color:"#fff", margin:"12px 0 6px", lineHeight:1.1 }}>
            {displayed}
          </div>
          {!result && <div style={{ color:"rgba(255,255,255,.75)", fontSize:14 }}>{DIR[dir].prompt}</div>}
          {result  && <div style={{ color:"rgba(255,255,255,.8)", fontSize:14 }}>
            {dir==="id_fr" ? `/${item.reading}/` : item.word}
          </div>}
        </div>
      </div>

      {/* Input + feedback */}
      <div style={{ padding:"0 6px" }}>
        <input ref={inputRef} autoFocus value={input}
          onChange={e=>{if(!result) setInput(e.target.value)}}
          onKeyDown={e=>e.key==="Enter"&&check()}
          placeholder={dir==="id_fr"?"Sens en français…":"Mot en indonésien…"}
          style={{ width:"100%", boxSizing:"border-box", padding:"13px 14px", fontSize:16,
            border:`2px solid ${result?accentBg:"#e5e7eb"}`, borderRadius:12, outline:"none",
            marginBottom:10, fontFamily:"inherit",
            background:result?(result==="correct"?"#dcfce7":"#fee2e2"):"#fff" }}/>

        {result && (
          <div style={{ background:result==="correct"?"#dcfce7":"#fee2e2",
            border:`1px solid ${result==="correct"?"#86efac":"#fca5a5"}`,
            borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
            <div style={{ fontWeight:600, color:result==="correct"?"#166534":"#991b1b" }}>
              {result==="correct" ? "✓ Correct !" : `✗  ${expected}`}
            </div>
            {result==="wrong" && (
              <div style={{ color:"#6b7280", fontSize:13, marginTop:3 }}>
                {item.word} = {item.meaning}
                {item.hint && <div style={{ color:"#9ca3af", marginTop:2 }}>💡 {item.hint}</div>}
              </div>
            )}
            {result==="correct" && item.hint &&
              <div style={{ color:"#6b7280", fontSize:13, marginTop:3 }}>💡 {item.hint}</div>}
          </div>
        )}

        <button onClick={check} style={btn(accentBg)}>
          {result ? "Suivant →" : "Valider"}
        </button>
      </div>
    </div>
  );
}

// ─── LESSON VIEW ──────────────────────────────────────────────────────────────
function LessonView({ items, onComplete }:{ items:Item[]; onComplete:(r:QResult[])=>void }) {
  const BATCH = Math.min(5, items.length);
  const batch = useRef(items.slice(0, BATCH)).current;

  const [learnIdx, setLearnIdx] = useState(0);
  const [phase, setPhase]       = useState<"learn"|"quiz">("learn");

  // File de quiz avec rebouclage sur les erreurs
  const [queue, setQueue] = useState<{item:Item; dir:Direction}[]>(() =>
    batch.flatMap(item => [
      { item, dir:"id_fr" as Direction },
      { item, dir:"fr_id" as Direction },
    ]).sort(()=>Math.random()-.5)
  );
  const [qIdx, setQIdx]     = useState(0);
  const [results, setResults] = useState<QResult[]>([]);
  const [answered, setAnswered] = useState<Set<number>>(new Set()); // items ayant eu au moins 1 bonne réponse

  const learnItem = batch[learnIdx];

  // ── Phase apprentissage ──
  if (phase==="learn") return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"0 14px" }}>
      <div style={{ background:"#e06b8b", borderRadius:"0 0 20px 20px",
        padding:"18px 20px 26px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <button onClick={()=>onComplete([])} style={{ background:"rgba(255,255,255,.2)",
            border:"none", cursor:"pointer", color:"#fff", borderRadius:8,
            padding:"4px 10px", fontSize:14, fontFamily:"inherit" }}>← Quitter</button>
          <span style={{ color:"rgba(255,255,255,.8)", fontSize:13 }}>Leçon {learnIdx+1}/{BATCH}</span>
        </div>
        <div style={{ textAlign:"center" }}>
          <Badge type={learnItem.type}/>
          <div style={{ fontSize: learnItem.word.length>15?28:52,
            fontWeight:800, color:"#fff", margin:"14px 0 4px", lineHeight:1.1 }}>
            {learnItem.word}
          </div>
          <div style={{ color:"rgba(255,255,255,.8)", fontSize:16 }}>/{learnItem.reading}/</div>
        </div>
      </div>
      <div style={{ padding:"0 6px" }}>
        <div style={{ ...card, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ fontSize:11, color:"#9ca3af", marginBottom:4, textTransform:"uppercase" }}>Sens</div>
          <div style={{ fontSize:20, fontWeight:700 }}>{learnItem.meaning}</div>
          {learnItem.alt?.length>0 &&
            <div style={{ fontSize:13, color:"#6b7280", marginTop:2 }}>Aussi : {learnItem.alt.join(", ")}</div>}
        </div>
        {learnItem.hint && (
          <div style={{ background:"#fffbeb", border:"1px solid #fde68a",
            borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
            <div style={{ fontSize:11, color:"#92400e", marginBottom:4, textTransform:"uppercase" }}>💡 Astuce</div>
            <div style={{ fontSize:14, color:"#78350f" }}>{learnItem.hint}</div>
          </div>
        )}
        <button onClick={()=>{
          if (learnIdx < BATCH-1) setLearnIdx(i=>i+1);
          else setPhase("quiz");
        }} style={btn("#e06b8b")}>
          {learnIdx<BATCH-1 ? "Suivant →" : "Passer au quiz →"}
        </button>
      </div>
    </div>
  );

  // ── Phase quiz avec rebouclage ──
  if (qIdx >= queue.length) {
    // Tous les items ont eu une bonne réponse ?
    const allDone = batch.every(item => answered.has(item.id));
    if (!allDone) {
      // Requeue les items pas encore réussis
      const missing = batch
        .filter(item => !answered.has(item.id))
        .flatMap(item => [
          { item, dir:"id_fr" as Direction },
          { item, dir:"fr_id" as Direction },
        ]).sort(()=>Math.random()-.5);
      setQueue(q=>[...q,...missing]);
      return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" }}>🌀</div>;
    }
    onComplete(results);
    return null;
  }

  const { item, dir } = queue[qIdx];

  return (
    <QuizCard
      item={item} dir={dir}
      questionNum={qIdx+1} totalQuestions={queue.length}
      onQuit={()=>onComplete([])}
      onResult={(correct)=>{
        setResults(r=>[...r,{item_id:item.id, correct}]);
        if (correct) {
          setAnswered(s=>new Set([...s, item.id]));
          setQIdx(i=>i+1);
        } else {
          // Requeue en fin de file
          setQueue(q=>[...q, { item, dir }]);
          setQIdx(i=>i+1);
        }
      }}
    />
  );
}

// ─── REVIEW VIEW ──────────────────────────────────────────────────────────────
function ReviewView({ dueItems, items, onComplete }:{
  dueItems:UItem[]; items:Item[]; onComplete:(r:QResult[])=>void;
}) {
  const initQueue = (): {item:Item; dir:Direction}[] =>
    dueItems
      .map(u=>items.find(i=>i.id===u.item_id))
      .filter(Boolean)
      .sort(()=>Math.random()-.5)
      .flatMap(item => [
        { item: item!, dir:"id_fr" as Direction },
        { item: item!, dir:"fr_id" as Direction },
      ]);

  const [queue, setQueue]     = useState<{item:Item;dir:Direction}[]>(initQueue);
  const [qIdx, setQIdx]       = useState(0);
  const [results, setResults] = useState<QResult[]>([]);
  const [answered, setAnswered] = useState<Set<string>>(new Set()); // "id_dir"
  const totalOriginal = useRef(queue.length).current;

  if (qIdx >= queue.length) {
    // Vérifie si tous les items originaux ont été réussis dans les deux sens
    const allDone = dueItems.every(u => {
      const item = items.find(i=>i.id===u.item_id);
      if (!item) return true;
      return answered.has(`${item.id}_id_fr`) && answered.has(`${item.id}_fr_id`);
    });

    if (!allDone) {
      const missing = dueItems
        .flatMap(u => {
          const item = items.find(i=>i.id===u.item_id);
          if (!item) return [];
          const dirs: Direction[] = [];
          if (!answered.has(`${item.id}_id_fr`)) dirs.push("id_fr");
          if (!answered.has(`${item.id}_fr_id`)) dirs.push("fr_id");
          return dirs.map(dir=>({ item, dir }));
        }).sort(()=>Math.random()-.5);
      setQueue(q=>[...q,...missing]);
      return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" }}>🌀</div>;
    }

    // Session terminée
    const correct = results.filter(r=>r.correct).length;
    const pct = results.length ? Math.round(correct/results.length*100) : 0;
    return (
      <div style={{ maxWidth:500, margin:"0 auto", padding:"50px 16px", textAlign:"center" }}>
        <div style={{ fontSize:56 }}>{pct>=80?"🎉":pct>=50?"💪":"😅"}</div>
        <div style={{ fontSize:24, fontWeight:700, margin:"14px 0 6px" }}>Session terminée !</div>
        <div style={{ color:"#6b7280" }}>{correct}/{results.length} correctes ({pct}%)</div>
        <div style={{ marginTop:20, ...card, padding:"16px", textAlign:"left" }}>
          {[
            { l:"Correctes",   n:correct,              c:"#16a34a" },
            { l:"Incorrectes", n:results.length-correct,c:"#dc2626" },
            { l:"Précision",   n:pct+"%",              c:"#3b82f6" },
          ].map(({l,n,c})=>(
            <div key={l} style={{ display:"flex", justifyContent:"space-between",
              padding:"7px 0", borderBottom:"1px solid #f3f4f6" }}>
              <span style={{ color:"#6b7280", fontSize:14 }}>{l}</span>
              <span style={{ fontWeight:700, color:c }}>{n}</span>
            </div>
          ))}
        </div>
        <button onClick={()=>onComplete(results)}
          style={{ ...btn("#3b82f6"), marginTop:20, width:"auto", padding:"13px 40px" }}>
          ← Retour
        </button>
      </div>
    );
  }

  const { item, dir } = queue[qIdx];

  return (
    <QuizCard
      item={item} dir={dir}
      questionNum={qIdx+1} totalQuestions={queue.length}
      onQuit={()=>onComplete(results)}
      onResult={(correct)=>{
        setResults(r=>[...r,{item_id:item.id, correct}]);
        if (correct) {
          setAnswered(s=>new Set([...s, `${item.id}_${dir}`]));
          setQIdx(i=>i+1);
        } else {
          setQueue(q=>[...q, { item, dir }]);
          setQIdx(i=>i+1);
        }
      }}
    />
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]       = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [items, setItems]     = useState<Item[]>([]);
  const [uItems, setUItems]   = useState<UItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [view, setView]       = useState<"dashboard"|"lesson"|"review">("dashboard");

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{
      setUser(data.session?.user??null); setAuthReady(true);
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user??null);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  const loadData = useCallback(async (uid:string)=>{
    setLoading(true);
    const [{data:cat},{data:prog}] = await Promise.all([
      supabase.from("items").select("*").order("level"),
      supabase.from("user_items").select("*").eq("user_id",uid),
    ]);
    setItems(cat??[]); setUItems(prog??[]); setLoading(false);
  },[]);

  useEffect(()=>{ if(user) loadData(user.id); },[user,loadData]);

  async function applyResults(results:QResult[]) {
    if (!user || !results.length) { setView("dashboard"); return; }
    setSaving(true);
    await supabase.rpc("apply_review_results",{
      p_user_id:user.id, p_results:JSON.stringify(results),
    });
    await loadData(user.id);
    setSaving(false); setView("dashboard");
  }

  async function logout() { await supabase.auth.signOut(); setItems([]); setUItems([]); }

  if (!authReady) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontSize:32 }}>🌀</div>;
  if (!user) return <AuthForm/>;
  if (loading||saving) return (
    <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:12 }}>
      <div style={{ fontSize:32 }}>🌀</div>
      <div style={{ color:"#6b7280" }}>{saving?"Sauvegarde…":"Chargement…"}</div>
    </div>
  );

  const now = new Date().toISOString();
  const dueItems    = uItems.filter(u=>u.learned && u.next_review<=now && u.stage<8);
  const lessonItems = items.filter(i=>!uItems.find(u=>u.item_id===i.id)?.learned);

  if (view==="lesson") return (
    <LessonView items={lessonItems} onComplete={async r=>{
      if (!r.length) { setView("dashboard"); return; }
      const byItem: Record<number, boolean> = {};
      r.forEach(({ item_id, correct }) => {
        if (byItem[item_id] === undefined) byItem[item_id] = correct;
        else byItem[item_id] = byItem[item_id] && correct;
      });
      const full = Object.entries(byItem).map(([id, correct]) => ({
        item_id: Number(id), correct,
      }));
      await applyResults(full);
    }}/>
  );

  if (view==="review") return (
    <ReviewView dueItems={dueItems} items={items} onComplete={applyResults}/>
  );

  return <Dashboard items={items} uItems={uItems}
    onLesson={()=>setView("lesson")} onReview={()=>setView("review")} onLogout={logout}/>;
}