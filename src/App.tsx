import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase     = createClient(SUPABASE_URL, SUPABASE_KEY);

type Item      = { id:number; level:number; type:string; word:string; reading:string; meaning:string; alt:string[]; hint:string; };
type UItem     = { item_id:number; stage:number; next_review:string; correct_count:number; wrong_count:number; learned:boolean; last_wrong_at:string|null; };
type QResult   = { item_id:number; correct:boolean };
type Direction = "id_fr"|"fr_id";
type View      = "dashboard"|"lesson"|"review"|"review_errors"|"level_detail"|"profile"|"admin";
type SessionLog= { session_type:string; item_count:number; correct:number; wrong:number; created_at:string; };
type HeatDay   = { day:string; items_done:number };
type UserPrefs = { fr_id_enabled:boolean; daily_goal:number };

const SRS_STAGES = [
  { name:"Touriste 1", icon:"🧳", color:"#e06b8b", bg:"#fde8ef", hours:4        },
  { name:"Touriste 2", icon:"🧳", color:"#e06b8b", bg:"#fde8ef", hours:8        },
  { name:"Touriste 3", icon:"🧳", color:"#e06b8b", bg:"#fde8ef", hours:24       },
  { name:"Touriste 4", icon:"🧳", color:"#e06b8b", bg:"#fde8ef", hours:48       },
  { name:"Voyageur 1", icon:"🗺️", color:"#9b59b6", bg:"#f0e6f6", hours:168      },
  { name:"Voyageur 2", icon:"🗺️", color:"#9b59b6", bg:"#f0e6f6", hours:336      },
  { name:"Expatrié 1", icon:"🏠", color:"#3b82f6", bg:"#e0ecff", hours:720      },
  { name:"Expatrié 2", icon:"🏠", color:"#3b82f6", bg:"#e0ecff", hours:1440     },
  { name:"Local 1",    icon:"🤝", color:"#0ea5e9", bg:"#e0f5ff", hours:2880     },
  { name:"Local 2",    icon:"🤝", color:"#0ea5e9", bg:"#e0f5ff", hours:5760     },
  { name:"Natif",      icon:"🌴", color:"#374151", bg:"#f3f4f6", hours:Infinity },
];

// Calcule le nouveau stage SRS après une réponse, même logique que apply_review_results() côté SQL :
// bonne réponse -> stage+1 (max 10) ; mauvaise réponse -> stage-2 si stage>=4, sinon stage-1 (min 0)
function calcNewStage(currentStage:number, correct:boolean): number {
  if (correct) return Math.min(currentStage+1, 10);
  return Math.max(0, currentStage-(currentStage>=4?2:1));
}

// Un niveau est "terminé" quand tous ses items sont appris (learned)
function isLevelComplete(level:number, items:Item[], uItems:UItem[]): boolean {
  const lvItems=items.filter(i=>i.level===level);
  if (!lvItems.length) return false;
  return lvItems.every(i=>uItems.find(u=>u.item_id===i.id)?.learned);
}

const PALIERS = [
  { l:"Touriste",  icon:"🧳", c:"#e06b8b", stages:[0,1,2,3] },
  { l:"Voyageur",  icon:"🗺️", c:"#9b59b6", stages:[4,5]     },
  { l:"Expatrié",  icon:"🏠", c:"#3b82f6", stages:[6,7]     },
  { l:"Local",     icon:"🤝", c:"#0ea5e9", stages:[8,9]     },
  { l:"Natif",     icon:"🌴", c:"#374151", stages:[10]      },
];

const DIR_CONFIG = {
  id_fr: { bg:"#7c3aed", label:"🇮🇩 → 🇫🇷", prompt:"Quel est le sens en français ?" },
  fr_id: { bg:"#0f766e", label:"🇫🇷 → 🇮🇩", prompt:"Comment dit-on en indonésien ?" },
};

const TYPE_META: Record<string,{bg:string;text:string;label:string}> = {
  vocab:   { bg:"#e06b8b", text:"#fff", label:"Vocabulaire" },
  grammar: { bg:"#0891b2", text:"#fff", label:"Grammaire"   },
  expr:    { bg:"#d97706", text:"#fff", label:"Expression"  },
};

const card = (dark=false): React.CSSProperties => ({
  background: dark?"#1e293b":"#fff",
  border: `1px solid ${dark?"#334155":"#e5e7eb"}`,
  borderRadius:16,
});

const btn = (bg:string, disabled=false, dark=false): React.CSSProperties => ({
  background:disabled?(dark?"#334155":"#d1d5db"):bg,
  color:"#fff", border:"none", borderRadius:12, padding:"16px 0",
  fontSize:16, fontWeight:700, cursor:disabled?"default":"pointer",
  width:"100%", fontFamily:"inherit", transition:"background .2s",
});

function Badge({ type }:{ type:string }) {
  const m = TYPE_META[type]??TYPE_META.vocab;
  return <span style={{ background:m.bg, color:m.text, padding:"2px 10px", borderRadius:99, fontSize:12, fontWeight:600 }}>{m.label}</span>;
}

function Bar({ value, total, color="#3b82f6", height=8 }:{ value:number; total:number; color?:string; height?:number }) {
  return (
    <div style={{ height, background:"#e5e7eb", borderRadius:99, overflow:"hidden" }}>
      <div style={{ width:`${total?Math.round(value/total*100):0}%`, height:"100%", background:color, borderRadius:99, transition:"width .4s" }}/>
    </div>
  );
}

function normalize(s:string): string {
  return s.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // supprime les accents
    .replace(/œ/g,"oe").replace(/æ/g,"ae")            // ligatures
    .replace(/['']/g,"'");                             // apostrophes
}

function checkAnswer(input:string, item:Item, dir:Direction): boolean {
  const ans = normalize(input);
  if (dir==="id_fr") {
    const acc = [item.meaning,...(item.alt??[])].map(normalize);
    return acc.some(a=>ans===a||a.split(" / ").includes(ans)||(ans.length>3&&a.includes(ans)));
  }
  return ans===normalize(item.word)||(ans.length>2&&normalize(item.word).includes(ans));
}

// Distance de Levenshtein (nombre minimal d'ajout/suppression/substitution de caractères)
function levenshtein(a:string, b:string): number {
  const m=a.length, n=b.length;
  if (m===0) return n;
  if (n===0) return m;
  const dp:number[]=Array(n+1);
  for (let j=0;j<=n;j++) dp[j]=j;
  for (let i=1;i<=m;i++) {
    let prev=dp[0];
    dp[0]=i;
    for (let j=1;j<=n;j++) {
      const tmp=dp[j];
      dp[j]=a[i-1]===b[j-1]?prev:1+Math.min(prev,dp[j],dp[j-1]);
      prev=tmp;
    }
  }
  return dp[n];
}

// Distance la plus courte entre la réponse tapée et l'une des réponses acceptées
function closestDistance(input:string, item:Item, dir:Direction): number {
  const ans = normalize(input);
  if (!ans) return Infinity;
  const targets = dir==="id_fr"
    ? [item.meaning,...(item.alt??[])].flatMap(t=>normalize(t).split(" / "))
    : [normalize(item.word)];
  return Math.min(...targets.map(t=>levenshtein(ans,t)));
}

// Faute de frappe probable : proche (1-2 caractères) mais pas exact
function isTypo(input:string, item:Item, dir:Direction): boolean {
  const d = closestDistance(input,item,dir);
  return d>0 && d<=2;
}

function Heatmap({ data, streak, dark }:{ data:HeatDay[]; streak:number; dark:boolean }) {
  const dataMap: Record<string,number> = {};
  data.forEach(d=>{ dataMap[d.day]=d.items_done; });

  const today = new Date();
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth()-11);
  startDate.setDate(1);

  // Génère toutes les semaines
  const weeks: (Date|null)[][] = [];
  const cur = new Date(startDate);
  // Aligne sur le dimanche
  cur.setDate(cur.getDate()-cur.getDay());
  while (cur<=today) {
    const week: (Date|null)[] = [];
    for (let d=0;d<7;d++) {
      const day = new Date(cur);
      week.push(day<=today?day:null);
      cur.setDate(cur.getDate()+1);
    }
    weeks.push(week);
  }

  const months = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  const maxVal = Math.max(...data.map(d=>d.items_done),1);

  function getColor(val:number): string {
    if (!val) return dark?"#2d3748":"#ebedf0";
    const pct = val/maxVal;
    if (pct<0.25) return dark?"#0d4429":"#9be9a8";
    if (pct<0.5)  return dark?"#006d32":"#40c463";
    if (pct<0.75) return dark?"#26a641":"#30a14e";
    return dark?"#39d353":"#216e39";
  }

  const totalDays = data.length;
  const totalItems = data.reduce((a,d)=>a+d.items_done,0);

  return (
    <div style={{ ...card(dark), padding:"20px 24px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:700, color:dark?"#f1f5f9":"#1f2937" }}>Activité</div>
        <div style={{ display:"flex", gap:24 }}>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#f59e0b" }}>🔥 {streak}</div>
            <div style={{ fontSize:11, color:dark?"#94a3b8":"#6b7280" }}>Streak</div>
          </div>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:18, fontWeight:800, color:dark?"#f1f5f9":"#1f2937" }}>{totalDays}</div>
            <div style={{ fontSize:11, color:dark?"#94a3b8":"#6b7280" }}>Jours actifs</div>
          </div>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:18, fontWeight:800, color:dark?"#f1f5f9":"#1f2937" }}>{totalItems}</div>
            <div style={{ fontSize:11, color:dark?"#94a3b8":"#6b7280" }}>Items révisés</div>
          </div>
        </div>
      </div>

      <div style={{ overflowX:"auto" }}>
        <div style={{ display:"flex", gap:3, minWidth:"fit-content" }}>
          {/* Labels mois */}
          <div style={{ display:"flex", flexDirection:"column", gap:3, marginRight:4 }}>
            <div style={{ height:14 }}/>
            {["D","L","M","M","J","V","S"].map((d,i)=>(
              <div key={i} style={{ height:12, fontSize:9, color:dark?"#64748b":"#9ca3af", display:"flex", alignItems:"center" }}>{d}</div>
            ))}
          </div>

          {weeks.map((week,wi)=>{
            // Détermine si on affiche le mois
            const firstDay = week.find(d=>d!==null);
            const showMonth = firstDay && firstDay.getDate()<=7;
            return (
              <div key={wi} style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <div style={{ height:14, fontSize:9, color:dark?"#64748b":"#9ca3af",
                  whiteSpace:"nowrap", overflow:"visible" }}>
                  {showMonth?months[firstDay!.getMonth()]:""}
                </div>
                {week.map((day,di)=>{
                  if (!day) return <div key={di} style={{ width:12, height:12 }}/>;
                  const key = day.toISOString().split("T")[0];
                  const val = dataMap[key]??0;
                  const isToday = key===today.toISOString().split("T")[0];
                  return (
                    <div key={di} title={`${key}: ${val} items`}
                      style={{ width:12, height:12, borderRadius:2,
                        background:getColor(val),
                        border:isToday?`1.5px solid ${dark?"#f59e0b":"#f59e0b"}`:"none",
                        cursor:"default" }}/>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10, justifyContent:"flex-end" }}>
        <span style={{ fontSize:10, color:dark?"#64748b":"#9ca3af" }}>Moins</span>
        {[0,0.2,0.5,0.8,1].map((v,i)=>(
          <div key={i} style={{ width:10, height:10, borderRadius:2, background:getColor(v*maxVal) }}/>
        ))}
        <span style={{ fontSize:10, color:dark?"#64748b":"#9ca3af" }}>Plus</span>
      </div>
    </div>
  );
}

// ─── PLANNING ─────────────────────────────────────────────────────────────────
function ReviewSchedule({ uItems, dark }:{ uItems:UItem[]; dark:boolean }) {
  const now  = new Date();
  const days = Array.from({length:7},(_,i)=>{ const d=new Date(now); d.setDate(d.getDate()+i); return d; });
  const DAY_NAMES = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
  const [selectedDay, setSelectedDay] = useState<number|null>(null);

  const counts = days.map(day=>{
    const start=new Date(day); start.setHours(0,0,0,0);
    const end=new Date(day);   end.setHours(23,59,59,999);
    return uItems.filter(u=>{
      if (!u.learned||u.stage===10) return false;
      const nr=new Date(u.next_review);
      return nr>=start&&nr<=end;
    }).length;
  });

  function getHourlyDetail(dayIdx:number) {
    const day=days[dayIdx];
    const start=new Date(day); start.setHours(0,0,0,0);
    const end=new Date(day);   end.setHours(23,59,59,999);
    const byHour:Record<number,number>={};
    uItems.forEach(u=>{
      if (!u.learned||u.stage===10) return;
      const nr=new Date(u.next_review);
      // Arrondi à l'heure pleine la plus proche en manipulant un Date complet
      // (et non un simple nombre d'heures) : setHours() gère nativement le
      // débordement de minuit et fait automatiquement passer au jour suivant.
      const rounded=new Date(nr);
      if (rounded.getMinutes()>=30) rounded.setHours(rounded.getHours()+1);
      rounded.setMinutes(0,0,0);
      // L'arrondi peut faire glisser l'item sur le jour suivant (ex: 23h45 → 00h00 J+1).
      // Dans ce cas, il n'appartient plus au détail horaire de CE jour-ci.
      if (rounded<start||rounded>end) return;
      const h=rounded.getHours();
      byHour[h]=(byHour[h]||0)+1;
    });
    return Object.entries(byHour).map(([h,n])=>({hour:Number(h),count:n})).sort((a,b)=>a.hour-b.hour);
  }

  const upcoming=uItems.filter(u=>{
    if (!u.learned||u.stage===10) return false;
    const nr=new Date(u.next_review);
    return nr>now&&nr<=new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59,59);
  }).map(u=>new Date(u.next_review)).sort((a,b)=>a.getTime()-b.getTime());

  const nextHour=upcoming.length>0?(()=>{
    const d=new Date(upcoming[0]);
    if (d.getMinutes()>=30) d.setHours(d.getHours()+1);
    d.setMinutes(0,0,0); return d;
  })():null;

  const maxCount=Math.max(...counts,1);
  const tc = dark?"#f1f5f9":"#1f2937";
  const sc = dark?"#94a3b8":"#6b7280";

  if (selectedDay!==null) {
    const detail=getHourlyDetail(selectedDay);
    const day=days[selectedDay];
    const dayLabel=`${DAY_NAMES[day.getDay()]} ${day.getDate()}/${day.getMonth()+1}`;
    const maxH=Math.max(...detail.map(d=>d.count),1);
    return (
      <div style={{ ...card(dark), padding:"24px 28px", height:340, display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
          <button onClick={()=>setSelectedDay(null)} style={{ background:"none", border:"none",
            cursor:"pointer", color:"#3b82f6", fontSize:14, fontWeight:600, fontFamily:"inherit", padding:0 }}>
            ← Retour
          </button>
          <span style={{ fontSize:16, fontWeight:700, color:tc }}>{dayLabel}</span>
          <span style={{ marginLeft:"auto", color:"#16a34a", fontWeight:700 }}>+{counts[selectedDay]}</span>
        </div>
        <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10 }}>
          {detail.length===0
            ?<div style={{ color:sc, fontSize:14, textAlign:"center", padding:"20px 0" }}>Aucune révision ce jour</div>
            :detail.map(({hour,count})=>{
              const pct=Math.round(count/maxH*100);
              return (
                <div key={hour} style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:44, fontSize:13, fontWeight:600, color:sc }}>{hour}h00</div>
                  <div style={{ flex:1, height:20, background:dark?"#334155":"#f3f4f6", borderRadius:6, overflow:"hidden" }}>
                    <div style={{ width:`${pct}%`, height:"100%", background:"#16a34a", borderRadius:6, minWidth:6 }}/>
                  </div>
                  <div style={{ width:40, fontSize:13, fontWeight:700, color:"#16a34a", textAlign:"right" }}>+{count}</div>
                </div>
              );
            })
          }
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...card(dark), padding:"24px 28px", height:340 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:12, color:sc, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.06em" }}>Planning révisions</div>
          <div style={{ fontSize:26, fontWeight:800, color:tc, marginTop:4 }}>+{counts[0]} aujourd'hui</div>
        </div>
        {nextHour&&(
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:12, color:sc }}>Prochaine vague</div>
            <div style={{ fontSize:22, fontWeight:800, color:"#3b82f6", marginTop:2 }}>{nextHour.getHours()}h00</div>
          </div>
        )}
      </div>
      {days.map((day,i)=>{
        const isToday=i===0;
        const pct=Math.round(counts[i]/maxCount*100);
        const clickable=counts[i]>0;
        return (
          <div key={i} onClick={()=>clickable&&setSelectedDay(i)}
            style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6,
              cursor:clickable?"pointer":"default", borderRadius:8, padding:"4px 6px", margin:"0 -6px 6px",
              transition:"background .15s" }}
            onMouseEnter={e=>{ if(clickable) e.currentTarget.style.background=dark?"#334155":"#f3f4f6"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}>
            <div style={{ width:36, fontSize:13, fontWeight:700, color:isToday?tc:sc }}>{DAY_NAMES[day.getDay()]}</div>
            <div style={{ flex:1, height:20, background:dark?"#334155":"#f3f4f6", borderRadius:6, overflow:"hidden" }}>
              {counts[i]>0&&<div style={{ width:`${pct}%`, height:"100%",
                background:isToday?"#16a34a":"#93c5fd", borderRadius:6, minWidth:6 }}/>}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              {counts[i]>0
                ?<span style={{ color:isToday?"#16a34a":"#3b82f6", fontWeight:700, fontSize:13 }}>+{counts[i]}</span>
                :<span style={{ color:dark?"#475569":"#d1d5db", fontSize:13 }}>—</span>}
              {clickable&&<span style={{ color:sc, fontSize:11 }}>›</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── STATS PANEL ─────────────────────────────────────────────────────────────
function StatsPanel({ logs, uItems, palierCounts, dark }:{
  logs:SessionLog[]; uItems:UItem[];
  palierCounts:{l:string;icon:string;c:string;count:number}[];
  dark:boolean;
}) {
  const [tab, setTab] = useState<"activite"|"precision"|"repartition"|"progression">("activite");
  const tc = dark?"#f1f5f9":"#1f2937";
  const sc = dark?"#94a3b8":"#6b7280";
  const bg2= dark?"#0f172a":"#f9fafb";
  const bg3= dark?"#334155":"#f3f4f6";

  const days7=Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-6+i); return d; });
  const DAY=["D","L","M","M","J","V","S"];

  const byDay=days7.map(day=>{
    const s=new Date(day); s.setHours(0,0,0,0);
    const e=new Date(day); e.setHours(23,59,59,999);
    const dl=logs.filter(l=>{ const d=new Date(l.created_at); return d>=s&&d<=e; });
    const tc2=dl.reduce((a,l)=>a+l.correct,0);
    const tw=dl.reduce((a,l)=>a+l.wrong,0);
    const tot=tc2+tw;
    return {
      dayLabel:DAY[day.getDay()],
      lessonItems:dl.filter(l=>l.session_type==="lesson").reduce((a,l)=>a+l.item_count,0),
      reviewItems:dl.filter(l=>l.session_type==="review").reduce((a,l)=>a+l.item_count,0),
      precision:tot>0?Math.round(tc2/tot*100):null,
      correct:tc2, wrong:tw,
    };
  });

  const TABS=[{id:"activite",label:"Activité"},{id:"precision",label:"Précision"},
    {id:"repartition",label:"Répartition"},{id:"progression",label:"Progression"}];
  const maxItems=Math.max(...byDay.map(d=>d.lessonItems+d.reviewItems),1);
  const totalLearned=uItems.filter(u=>u.learned).length;

  // Items appris par semaine (8 dernières semaines), à partir des sessions de type "lesson"
  const weeks8=Array.from({length:8},(_,i)=>{
    const end=new Date(); end.setHours(23,59,59,999); end.setDate(end.getDate()-7*(7-i));
    const start=new Date(end); start.setDate(start.getDate()-6); start.setHours(0,0,0,0);
    return { start, end };
  });
  const byWeek=weeks8.map(({start,end})=>{
    const learned=logs.filter(l=>l.session_type==="lesson")
      .filter(l=>{ const d=new Date(l.created_at); return d>=start&&d<=end; })
      .reduce((a,l)=>a+l.item_count,0);
    return { label:`${start.getDate()}/${start.getMonth()+1}`, learned };
  });

  return (
    <div style={{ ...card(dark), padding:"24px 28px" }}>
      <div style={{ display:"flex", gap:4, marginBottom:24, background:bg3, borderRadius:10, padding:4 }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id as any)}
            style={{ flex:1, padding:"10px 0", fontSize:14, fontWeight:600, border:"none", cursor:"pointer",
              borderRadius:8, fontFamily:"inherit", transition:"all .2s",
              background:tab===t.id?(dark?"#1e293b":"#fff"):"transparent",
              color:tab===t.id?tc:sc,
              boxShadow:tab===t.id?"0 1px 4px rgba(0,0,0,.12)":"none" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==="activite"&&(
        <div>
          <div style={{ display:"flex", gap:16, marginBottom:16 }}>
            {[{c:"#e06b8b",l:"Leçons"},{c:"#3b82f6",l:"Révisions"}].map(({c,l})=>(
              <div key={l} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:sc }}>
                <div style={{ width:12, height:12, borderRadius:3, background:c }}/>{l}
              </div>
            ))}
          </div>
          <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:140 }}>
            {byDay.map((d,i)=>{
              const lPct=Math.round(d.lessonItems/maxItems*100);
              const rPct=Math.round(d.reviewItems/maxItems*100);
              return (
                <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  <div style={{ width:"100%", display:"flex", gap:2, alignItems:"flex-end", height:120 }}>
                    <div style={{ flex:1, background:"#e06b8b", borderRadius:"4px 4px 0 0", height:`${lPct}%`, minHeight:d.lessonItems>0?4:0 }}/>
                    <div style={{ flex:1, background:"#3b82f6", borderRadius:"4px 4px 0 0", height:`${rPct}%`, minHeight:d.reviewItems>0?4:0 }}/>
                  </div>
                  <div style={{ fontSize:11, color:sc, fontWeight:600 }}>{d.dayLabel}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:12, marginTop:20 }}>
            {[
              {l:"Leçons (7j)",    n:byDay.reduce((a,d)=>a+d.lessonItems,0), c:"#e06b8b"},
              {l:"Révisions (7j)", n:byDay.reduce((a,d)=>a+d.reviewItems,0), c:"#3b82f6"},
              {l:"Items appris",   n:totalLearned,                            c:tc},
            ].map(({l,n,c})=>(
              <div key={l} style={{ flex:1, background:bg2, borderRadius:12, padding:"14px 16px" }}>
                <div style={{ fontSize:24, fontWeight:800, color:c }}>{n}</div>
                <div style={{ fontSize:12, color:sc, marginTop:4 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==="precision"&&(
        <div>
          <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:140 }}>
            {byDay.map((d,i)=>{
              const pct=d.precision??0;
              const color=pct>=80?"#16a34a":pct>=60?"#f59e0b":"#dc2626";
              return (
                <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  {d.precision!==null&&<div style={{ fontSize:10, fontWeight:700, color }}>{pct}%</div>}
                  <div style={{ width:"100%", height:120, display:"flex", alignItems:"flex-end" }}>
                    <div style={{ width:"100%", background:d.precision!==null?color:bg3,
                      borderRadius:"4px 4px 0 0", height:`${d.precision!==null?pct:6}%`,
                      minHeight:d.precision!==null?4:6, opacity:d.precision!==null?1:0.3 }}/>
                  </div>
                  <div style={{ fontSize:11, color:sc, fontWeight:600 }}>{d.dayLabel}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:12, marginTop:20 }}>
            {(()=>{
              const ac=byDay.reduce((a,d)=>a+d.correct,0);
              const aw=byDay.reduce((a,d)=>a+d.wrong,0);
              const tot=ac+aw;
              const pct=tot>0?Math.round(ac/tot*100):0;
              const color=pct>=80?"#16a34a":pct>=60?"#f59e0b":"#dc2626";
              return [
                {l:"Précision moyenne", n:tot>0?`${pct}%`:"—", c:color},
                {l:"Correctes (7j)",    n:ac,                   c:"#16a34a"},
                {l:"Incorrectes (7j)",  n:aw,                   c:"#dc2626"},
              ].map(({l,n,c})=>(
                <div key={l} style={{ flex:1, background:bg2, borderRadius:12, padding:"14px 16px" }}>
                  <div style={{ fontSize:24, fontWeight:800, color:c }}>{n}</div>
                  <div style={{ fontSize:12, color:sc, marginTop:4 }}>{l}</div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {tab==="repartition"&&(
        <div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {palierCounts.map(({l,icon,c,count})=>(
              <div key={l} style={{ display:"flex", alignItems:"center", gap:14 }}>
                <div style={{ fontSize:22 }}>{icon}</div>
                <div style={{ width:100, fontSize:14, fontWeight:700, color:c }}>{l}</div>
                <div style={{ flex:1 }}>
                  <Bar value={count} total={Math.max(...palierCounts.map(p=>p.count),1)} color={c} height={12}/>
                </div>
                <div style={{ width:40, fontSize:16, fontWeight:800, color:c, textAlign:"right" }}>{count}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex", gap:12, marginTop:20 }}>
            {[
              {l:"Total appris", n:uItems.filter(u=>u.learned).length, c:tc},
              {l:"Non appris",   n:uItems.filter(u=>!u.learned).length, c:sc},
              {l:"Natifs 🌴",    n:palierCounts.find(p=>p.l==="Natif")?.count??0, c:"#374151"},
            ].map(({l,n,c})=>(
              <div key={l} style={{ flex:1, background:bg2, borderRadius:12, padding:"14px 16px" }}>
                <div style={{ fontSize:24, fontWeight:800, color:c }}>{n}</div>
                <div style={{ fontSize:12, color:sc, marginTop:4 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==="progression"&&(()=>{
        const width=560, height=180, padL=14, padR=14, padT=24, padB=28;
        const plotW=width-padL-padR, plotH=height-padT-padB;
        const maxVal=Math.max(...byWeek.map(w=>w.learned),1);
        const stepX=byWeek.length>1?plotW/(byWeek.length-1):0;
        const points=byWeek.map((w,i)=>({
          x:padL+stepX*i,
          y:padT+plotH-(w.learned/maxVal)*plotH,
          ...w,
        }));
        const pathD=points.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
        const areaD=`${pathD} L${points[points.length-1].x},${padT+plotH} L${points[0].x},${padT+plotH} Z`;
        const total8w=byWeek.reduce((a,w)=>a+w.learned,0);
        return (
          <div>
            <svg viewBox={`0 0 ${width} ${height}`} style={{ width:"100%", height:"auto", display:"block" }}>
              {[0,0.5,1].map(f=>(
                <line key={f} x1={padL} x2={width-padR} y1={padT+plotH*(1-f)} y2={padT+plotH*(1-f)}
                  stroke={dark?"#334155":"#e5e7eb"} strokeWidth={1}/>
              ))}
              <path d={areaD} fill="#3b82f6" opacity={0.12}/>
              <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2.5}/>
              {points.map((p,i)=>(
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={4} fill="#3b82f6"/>
                  {p.learned>0&&<text x={p.x} y={p.y-10} fontSize={11} fill={tc} textAnchor="middle" fontWeight={700}>{p.learned}</text>}
                  <text x={p.x} y={height-8} fontSize={10} fill={sc} textAnchor="middle">{p.label}</text>
                </g>
              ))}
            </svg>
            <div style={{ display:"flex", gap:12, marginTop:20 }}>
              {[
                {l:"Items appris (8 sem.)", n:total8w,                                     c:"#3b82f6"},
                {l:"Moyenne / semaine",     n:Math.round(total8w/byWeek.length*10)/10,      c:tc},
              ].map(({l,n,c})=>(
                <div key={l} style={{ flex:1, background:bg2, borderRadius:12, padding:"14px 16px" }}>
                  <div style={{ fontSize:24, fontWeight:800, color:c }}>{n}</div>
                  <div style={{ fontSize:12, color:sc, marginTop:4 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── LEVEL DETAIL ─────────────────────────────────────────────────────────────
function LevelDetail({ level, items, uItems, onBack, dark, onUpdateItem }:{
  level:number; items:Item[]; uItems:UItem[]; onBack:()=>void; dark:boolean;
  onUpdateItem:(item:Item)=>void;
}) {
  const lvItems=items.filter(i=>i.level===level);
  const tc=dark?"#f1f5f9":"#1f2937";
  const sc=dark?"#94a3b8":"#6b7280";
  const [editingId, setEditingId] = useState<number|null>(null);
  const [editForm, setEditForm]   = useState({ word:"", reading:"", meaning:"", alt:"", hint:"" });
  const [saving, setSaving]       = useState(false);

  function startEdit(item:Item) {
    setEditingId(item.id);
    setEditForm({ word:item.word, reading:item.reading, meaning:item.meaning,
      alt:(item.alt??[]).join(", "), hint:item.hint??"" });
  }

  async function saveEdit(item:Item) {
    setSaving(true);
    const updated:Item = {
      ...item,
      word:editForm.word.trim(), reading:editForm.reading.trim(), meaning:editForm.meaning.trim(),
      alt:editForm.alt?editForm.alt.split(",").map(s=>s.trim()).filter(Boolean):[],
      hint:editForm.hint.trim(),
    };
    const { error } = await supabase.from("items").update({
      word:updated.word, reading:updated.reading, meaning:updated.meaning,
      alt:updated.alt, hint:updated.hint,
    }).eq("id", item.id);
    setSaving(false);
    if (!error) { onUpdateItem(updated); setEditingId(null); }
  }

  const editInputStyle: React.CSSProperties = {
    width:"100%", boxSizing:"border-box", padding:"9px 12px", fontSize:14,
    borderRadius:8, border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
    outline:"none", fontFamily:"inherit", background:dark?"#0f172a":"#fff", color:tc, marginBottom:7,
  };

  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"28px 28px 60px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:24 }}>
        <button onClick={onBack} style={{ background:"none", border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
          borderRadius:10, padding:"8px 16px", fontSize:14, color:sc, cursor:"pointer" }}>
          ← Retour
        </button>
        <div style={{ fontSize:22, fontWeight:800, color:tc }}>Niveau {level}</div>
        <div style={{ color:sc, fontSize:15 }}>{lvItems.length} items</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {lvItems.map(item=>{
          const u=uItems.find(x=>x.item_id===item.id);
          const stage=u?SRS_STAGES[u.stage]:null;
          const learned=u?.learned??false;
          const isNew=!learned;
          const isEditing=editingId===item.id;
          return (
            <div key={item.id} style={{
              ...card(dark), padding:"14px 18px",
              opacity:isNew&&!isEditing?0.45:1,
              background:isEditing?(dark?"#1e293b":"#fff"):isNew?(dark?"#0f172a":"#f9fafb"):(dark?"#1e293b":"#fff"),
              borderColor:isEditing?"#3b82f6":isNew?(dark?"#1e293b":"#f3f4f6"):learned&&stage?stage.color+"33":(dark?"#334155":"#e5e7eb"),
              borderWidth:isEditing||learned?1.5:1, transition:"all .2s",
            }}>
              {isEditing?(
                <div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <input value={editForm.word} placeholder="Mot indonésien"
                      onChange={e=>setEditForm(f=>({...f,word:e.target.value}))} style={editInputStyle}/>
                    <input value={editForm.reading} placeholder="Lecture"
                      onChange={e=>setEditForm(f=>({...f,reading:e.target.value}))} style={editInputStyle}/>
                  </div>
                  <input value={editForm.meaning} placeholder="Sens en français"
                    onChange={e=>setEditForm(f=>({...f,meaning:e.target.value}))} style={editInputStyle}/>
                  <input value={editForm.alt} placeholder="Sens alternatifs (séparés par des virgules)"
                    onChange={e=>setEditForm(f=>({...f,alt:e.target.value}))} style={editInputStyle}/>
                  <input value={editForm.hint} placeholder="Astuce mnémotechnique"
                    onChange={e=>setEditForm(f=>({...f,hint:e.target.value}))} style={{ ...editInputStyle, marginBottom:10 }}/>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>saveEdit(item)} disabled={saving||!editForm.word||!editForm.meaning}
                      style={{ ...btn("#16a34a",saving||!editForm.word||!editForm.meaning,dark), width:"auto", padding:"9px 20px", fontSize:13 }}>
                      {saving?"…":"✓ Enregistrer"}
                    </button>
                    <button onClick={()=>setEditingId(null)}
                      style={{ ...btn(dark?"#334155":"#9ca3af",false,dark), width:"auto", padding:"9px 20px", fontSize:13 }}>
                      Annuler
                    </button>
                  </div>
                </div>
              ):(
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
                    <div style={{ flex:1, cursor:"pointer" }} onClick={()=>startEdit(item)} title="Cliquer pour modifier ce mot">
                      <span style={{ fontWeight:800, fontSize:17, color:isNew?sc:tc }}>{item.word}</span>
                      <span style={{ color:sc, fontSize:13, marginLeft:10 }}>/{item.reading}/</span>
                      <span style={{ color:sc, fontSize:12, marginLeft:8, opacity:.6 }}>✏️</span>
                    </div>
                    <Badge type={item.type} />
                  </div>
                  <div style={{ color:isNew?sc:(dark?"#cbd5e1":"#374151"), fontSize:15, marginBottom:learned?8:0, cursor:"pointer" }}
                    onClick={()=>startEdit(item)}>
                    {isNew?"———":item.meaning}
                  </div>
                  {learned&&stage&&(
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <span style={{ background:stage.bg, color:stage.color, padding:"3px 12px", borderRadius:99, fontSize:13, fontWeight:600 }}>
                        {stage.icon} {stage.name}
                      </span>
                      {u&&(
                        <div style={{ display:"flex", gap:14, fontSize:13 }}>
                          <span style={{ color:"#16a34a", fontWeight:700 }}>✓ {u.correct_count}</span>
                          <span style={{ color:"#dc2626", fontWeight:700 }}>✗ {u.wrong_count}</span>
                          {u.correct_count+u.wrong_count>0&&(
                            <span style={{ color:sc }}>{Math.round(u.correct_count/(u.correct_count+u.wrong_count)*100)}%</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PROFILE PAGE ─────────────────────────────────────────────────────────────
function exportProgressCSV(items:Item[], uItems:UItem[]) {
  const header=["level","type","word","reading","meaning","alt","stage","palier","correct_count","wrong_count","learned","next_review"];
  const esc=(v:unknown)=>`"${String(v??"").replace(/"/g,'""')}"`;
  const rows=items
    .slice()
    .sort((a,b)=>a.level-b.level)
    .map(it=>{
      const u=uItems.find(x=>x.item_id===it.id);
      const stageInfo=u?SRS_STAGES[u.stage]:null;
      return [
        it.level, it.type, it.word, it.reading, it.meaning, (it.alt??[]).join("|"),
        u?.stage??"", stageInfo?.name??"", u?.correct_count??0, u?.wrong_count??0,
        u?.learned?"oui":"non", u?.next_review??"",
      ].map(esc).join(",");
    });
  const csv=[header.map(esc).join(","), ...rows].join("\n");
  const blob=new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`bahasa-srs-progression-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ProfilePage({ prefs, onSave, onBack, dark, items, uItems }:{
  prefs:UserPrefs; onSave:(p:UserPrefs)=>void; onBack:()=>void; dark:boolean;
  items:Item[]; uItems:UItem[];
}) {
  const [frId, setFrId]   = useState(prefs.fr_id_enabled);
  const [goal, setGoal]   = useState(prefs.daily_goal);
  const tc=dark?"#f1f5f9":"#1f2937";
  const sc=dark?"#94a3b8":"#6b7280";

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"28px 28px 60px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:32 }}>
        <button onClick={onBack} style={{ background:"none", border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
          borderRadius:10, padding:"8px 16px", fontSize:14, color:sc, cursor:"pointer" }}>← Retour</button>
        <div style={{ fontSize:22, fontWeight:800, color:tc }}>Profil & Préférences</div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        {/* FR→ID toggle */}
        <div style={{ ...card(dark), padding:"20px 24px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:tc }}>Questions Français → Indonésien</div>
              <div style={{ fontSize:13, color:sc, marginTop:4 }}>Activer les questions dans les deux sens pendant les révisions et leçons</div>
            </div>
            <div onClick={()=>setFrId(!frId)}
              style={{ width:52, height:28, borderRadius:99,
                background:frId?"#16a34a":"#d1d5db",
                cursor:"pointer", position:"relative", transition:"background .2s", flexShrink:0 }}>
              <div style={{ width:22, height:22, borderRadius:99, background:"#fff",
                position:"absolute", top:3, left:frId?26:3, transition:"left .2s",
                boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
            </div>
          </div>
        </div>

        {/* Objectif journalier */}
        <div style={{ ...card(dark), padding:"20px 24px" }}>
          <div style={{ fontSize:16, fontWeight:700, color:tc, marginBottom:8 }}>Objectif journalier</div>
          <div style={{ fontSize:13, color:sc, marginBottom:16 }}>Nombre d'items à apprendre ou réviser par jour</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {[5,10,20,30,50].map(n=>(
              <button key={n} onClick={()=>setGoal(n)}
                style={{ padding:"10px 20px", borderRadius:10, border:`2px solid ${goal===n?"#3b82f6":(dark?"#334155":"#e5e7eb")}`,
                  background:goal===n?"#3b82f6":"transparent", color:goal===n?"#fff":tc,
                  fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Mode sombre */}
        <div style={{ ...card(dark), padding:"20px 24px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:tc }}>Mode sombre</div>
              <div style={{ fontSize:13, color:sc, marginTop:4 }}>Interface sombre pour les révisions nocturnes 🌙</div>
            </div>
            <div style={{ fontSize:24 }}>{dark?"🌙":"☀️"}</div>
          </div>
          <div style={{ fontSize:12, color:sc, marginTop:8 }}>
            Le mode sombre se toggle depuis le bouton en haut du dashboard.
          </div>
        </div>

        {/* Export CSV */}
        <div style={{ ...card(dark), padding:"20px 24px" }}>
          <div style={{ fontSize:16, fontWeight:700, color:tc }}>Export de la progression</div>
          <div style={{ fontSize:13, color:sc, marginTop:4, marginBottom:14 }}>
            Télécharge un fichier CSV avec tous tes mots, leur palier SRS et tes stats (✓/✗) par item.
          </div>
          <button onClick={()=>exportProgressCSV(items,uItems)}
            style={{ ...btn("#3b82f6",false,dark), width:"auto", padding:"10px 20px", fontSize:14 }}>
            ⬇ Exporter en CSV
          </button>
        </div>

        <button onClick={()=>onSave({fr_id_enabled:frId, daily_goal:goal})}
          style={btn("#16a34a",false,dark)}>
          ✓ Sauvegarder les préférences
        </button>
      </div>
    </div>
  );
}

// ─── ADMIN PAGE ───────────────────────────────────────────────────────────────
function AdminPage({ onBack, dark, userId }:{ onBack:()=>void; dark:boolean; userId:string }) {
  const [tab, setTab]       = useState<"add"|"csv"|"delete">("add");
  const [form, setForm]     = useState({ level:1, type:"vocab", word:"", reading:"", meaning:"", alt:"", hint:"" });
  const [csvText, setCsvText]     = useState("");
  const [allItems, setAllItems]   = useState<Item[]>([]);
  const [filterLevel, setFilterLevel] = useState<number|"">("");
  const [filterType, setFilterType]   = useState<string>("");
  const [confirmId, setConfirmId]     = useState<number|null>(null);

  useEffect(()=>{
    if (tab==="delete") {
      supabase.from("items").select("*").order("level").then(({data})=>setAllItems(data??[]));
    }
  },[tab]);
  const [status, setStatus] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  const tc=dark?"#f1f5f9":"#1f2937";
  const sc=dark?"#94a3b8":"#6b7280";
  const bg3=dark?"#334155":"#f3f4f6";

  async function addItem() {
    if (!form.word||!form.meaning) { setStatus("❌ Mot et sens obligatoires"); return; }
    setLoading(true);
    const { error } = await supabase.from("items").insert({
      level:Number(form.level), type:form.type, word:form.word.trim(),
      reading:form.reading.trim(), meaning:form.meaning.trim(),
      alt:form.alt?form.alt.split(",").map(s=>s.trim()).filter(Boolean):[],
      hint:form.hint.trim(),
    });
    if (error) setStatus(`❌ ${error.message}`);
    else { setStatus("✅ Item ajouté !"); setForm({level:1,type:"vocab",word:"",reading:"",meaning:"",alt:"",hint:""}); }
    setLoading(false);
  }

  async function importCSV() {
    // Format attendu: level,type,word,reading,meaning,alt,hint
    const lines = csvText.trim().split("\n").slice(1); // skip header
    const rows = lines.map(l=>{
      const [level,type,word,reading,meaning,alt,hint] = l.split(",").map(s=>s.trim().replace(/^"|"$/g,""));
      return { level:Number(level)||1, type:type||"vocab", word, reading, meaning,
        alt:alt?alt.split("|").map(s=>s.trim()).filter(Boolean):[],
        hint:hint||"" };
    }).filter(r=>r.word&&r.meaning);

    if (!rows.length) { setStatus("❌ Aucune ligne valide trouvée"); return; }
    setLoading(true);
    const { error } = await supabase.from("items").insert(rows);
    if (error) setStatus(`❌ ${error.message}`);
    else {
      setStatus(`✅ ${rows.length} items importés !`);
      setCsvText("");
      // Ajoute les nouveaux items pour tous les users
      const { data:newItems } = await supabase.from("items").select("id").order("id",{ascending:false}).limit(rows.length);
      if (newItems) {
        await supabase.from("user_items").insert(
          newItems.map((it:any)=>({ user_id:userId, item_id:it.id, stage:0,
            next_review:new Date().toISOString(), correct_count:0, wrong_count:0, learned:false }))
        );
      }
    }
    setLoading(false);
  }

  const inputStyle: React.CSSProperties = {
    width:"100%", boxSizing:"border-box", padding:"12px 14px",
    borderRadius:10, border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
    fontSize:15, outline:"none", fontFamily:"inherit",
    background:dark?"#0f172a":"#fff", color:tc,
  };

  return (
    <div style={{ maxWidth:700, margin:"0 auto", padding:"28px 28px 60px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:32 }}>
        <button onClick={onBack} style={{ background:"none", border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
          borderRadius:10, padding:"8px 16px", fontSize:14, color:sc, cursor:"pointer" }}>← Retour</button>
        <div style={{ fontSize:22, fontWeight:800, color:tc }}>Administration</div>
      </div>

      <div style={{ display:"flex", gap:4, marginBottom:24, background:bg3, borderRadius:10, padding:4 }}>
        {[{id:"add",label:"Ajouter / Modifier"},{id:"csv",label:"Import CSV"},{id:"delete",label:"Supprimer"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id as any)}
            style={{ flex:1, padding:"10px 0", fontSize:14, fontWeight:600, border:"none", cursor:"pointer",
              borderRadius:8, fontFamily:"inherit", transition:"all .2s",
              background:tab===t.id?(dark?"#1e293b":"#fff"):"transparent",
              color:tab===t.id?tc:sc,
              boxShadow:tab===t.id?"0 1px 4px rgba(0,0,0,.12)":"none" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==="add"&&(
        <div style={{ ...card(dark), padding:"24px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:sc, display:"block", marginBottom:6 }}>Niveau</label>
              <input type="number" min={1} max={20} value={form.level}
                onChange={e=>setForm(f=>({...f,level:Number(e.target.value)}))} style={inputStyle}/>
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:sc, display:"block", marginBottom:6 }}>Type</label>
              <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}
                style={{ ...inputStyle }}>
                <option value="vocab">Vocabulaire</option>
                <option value="grammar">Grammaire</option>
                <option value="expr">Expression</option>
              </select>
            </div>
          </div>
          {[
            {key:"word",    label:"Mot indonésien"},
            {key:"reading", label:"Lecture (ex: ma-kan)"},
            {key:"meaning", label:"Sens en français"},
            {key:"alt",     label:"Sens alternatifs (séparés par des virgules)"},
            {key:"hint",    label:"Astuce mnémotechnique"},
          ].map(({key,label})=>(
            <div key={key} style={{ marginBottom:12 }}>
              <label style={{ fontSize:12, fontWeight:600, color:sc, display:"block", marginBottom:6 }}>{label}</label>
              <input value={(form as any)[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                style={inputStyle} placeholder={label}/>
            </div>
          ))}
          {status&&<div style={{ color:status.startsWith("✅")?"#16a34a":"#dc2626", fontSize:14, marginBottom:12 }}>{status}</div>}
          <button onClick={addItem} disabled={loading} style={btn("#e06b8b",loading,dark)}>
            {loading?"…":"+ Ajouter l'item"}
          </button>
        </div>
      )}

      {tab==="delete"&&(()=>{
        const levels = Array.from(new Set(allItems.map(i=>i.level))).sort((a,b)=>a-b);
        const filtered = allItems.filter(i=>
          (filterLevel===""||i.level===filterLevel) &&
          (filterType===""||i.type===filterType)
        );

        async function deleteItem(id:number) {
          setLoading(true);
          await supabase.from("user_items").delete().eq("item_id",id);
          await supabase.from("items").delete().eq("id",id);
          setAllItems(prev=>prev.filter(i=>i.id!==id));
          setConfirmId(null);
          setStatus("✅ Item supprimé.");
          setLoading(false);
        }

        return (
          <div style={{ ...card(dark), padding:"24px" }}>
            {/* Filtres */}
            <div style={{ display:"flex", gap:10, marginBottom:16 }}>
              <select value={filterLevel} onChange={e=>setFilterLevel(e.target.value===""?"":Number(e.target.value))}
                style={{ ...inputStyle, flex:1 }}>
                <option value="">Tous les niveaux</option>
                {levels.map(lv=><option key={lv} value={lv}>Niveau {lv}</option>)}
              </select>
              <select value={filterType} onChange={e=>setFilterType(e.target.value)}
                style={{ ...inputStyle, flex:1 }}>
                <option value="">Tous les types</option>
                <option value="vocab">Vocabulaire</option>
                <option value="grammar">Grammaire</option>
                <option value="expr">Expression</option>
              </select>
            </div>

            <div style={{ fontSize:12, color:sc, marginBottom:10 }}>{filtered.length} item{filtered.length>1?"s":""} trouvé{filtered.length>1?"s":""}</div>

            {/* Liste */}
            <div style={{ maxHeight:380, overflowY:"auto", display:"flex", flexDirection:"column", gap:6 }}>
              {filtered.map(item=>(
                <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10,
                  background:dark?"#0f172a":"#f9fafb", borderRadius:10, padding:"10px 14px",
                  border:`1px solid ${dark?"#334155":"#e5e7eb"}` }}>
                  <div style={{ flex:1 }}>
                    <span style={{ fontWeight:700, fontSize:14, color:tc }}>{item.word}</span>
                    <span style={{ color:sc, fontSize:12, marginLeft:8 }}>{item.meaning}</span>
                  </div>
                  <span style={{ fontSize:11, color:sc, background:dark?"#1e293b":"#e5e7eb",
                    padding:"2px 8px", borderRadius:99 }}>Niv.{item.level}</span>
                  <span style={{ fontSize:11, color:TYPE_META[item.type]?.bg,
                    background:dark?"#1e293b":"#e5e7eb", padding:"2px 8px", borderRadius:99 }}>
                    {TYPE_META[item.type]?.label}
                  </span>
                  {confirmId===item.id ? (
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={()=>deleteItem(item.id)} disabled={loading}
                        style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:8,
                          padding:"5px 10px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                        Confirmer
                      </button>
                      <button onClick={()=>setConfirmId(null)}
                        style={{ background:"none", border:`1px solid ${dark?"#334155":"#e5e7eb"}`,
                          borderRadius:8, padding:"5px 10px", fontSize:12, color:sc, cursor:"pointer", fontFamily:"inherit" }}>
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button onClick={()=>setConfirmId(item.id)}
                      style={{ background:"none", border:"1px solid #dc2626", borderRadius:8,
                        padding:"5px 10px", fontSize:12, color:"#dc2626", cursor:"pointer", fontFamily:"inherit" }}>
                      🗑 Supprimer
                    </button>
                  )}
                </div>
              ))}
            </div>
            {status&&<div style={{ color:status.startsWith("✅")?"#16a34a":"#dc2626", fontSize:14, marginTop:12 }}>{status}</div>}
          </div>
        );
      })()}

      {tab==="csv"&&(
        <div style={{ ...card(dark), padding:"24px" }}>
          <div style={{ fontSize:14, color:sc, marginBottom:16, lineHeight:1.6 }}>
            Format CSV attendu (avec en-tête) :<br/>
            <code style={{ background:bg3, padding:"2px 6px", borderRadius:4, fontSize:12 }}>
              level,type,word,reading,meaning,alt,hint
            </code><br/>
            Les sens alternatifs sont séparés par <code>|</code> dans la colonne alt.
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)}
            placeholder={"level,type,word,reading,meaning,alt,hint\n1,vocab,makan,ma-kan,manger,bouffer,Racine courante"}
            style={{ ...inputStyle, height:200, resize:"vertical", fontFamily:"monospace", fontSize:13 }}/>
          {status&&<div style={{ color:status.startsWith("✅")?"#16a34a":"#dc2626", fontSize:14, margin:"12px 0" }}>{status}</div>}
          <button onClick={importCSV} disabled={loading||!csvText.trim()} style={{ ...btn("#3b82f6",loading||!csvText.trim(),dark), marginTop:12 }}>
            {loading?"…":"⬆ Importer le CSV"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ items, uItems, logs, heatmap, streak, prefs, dark, onLesson, onReview, onErrors, onLogout, onLevelClick, onProfile, onAdmin, onToggleDark }:{
  items:Item[]; uItems:UItem[]; logs:SessionLog[]; heatmap:HeatDay[]; streak:number;
  prefs:UserPrefs; dark:boolean;
  onLesson:()=>void; onReview:()=>void; onErrors:()=>void; onLogout:()=>void;
  onLevelClick:(lv:number)=>void; onProfile:()=>void; onAdmin:()=>void; onToggleDark:()=>void;
}) {
  const now=new Date().toISOString();
  const dueCount=uItems.filter(u=>u.learned&&u.next_review<=now&&u.stage<10).length;
  const lessonCount=items.filter(i=>!uItems.find(u=>u.item_id===i.id)?.learned).length;
  const errorCutoff=new Date(Date.now()-24*3600*1000).toISOString();
  const errorCount=uItems.filter(u=>u.learned&&u.last_wrong_at&&u.last_wrong_at>=errorCutoff).length;
  const learned=uItems.filter(u=>u.learned);
  const levels=Array.from(new Set(items.map(i=>i.level))).sort((a,b)=>a-b);
  const palierCounts=PALIERS.map(p=>({...p,count:uItems.filter(u=>p.stages.includes(u.stage)&&u.learned).length}));
  const tc=dark?"#f1f5f9":"#1f2937";
  const sc=dark?"#94a3b8":"#6b7280";

  // Objectif journalier
  const today=new Date(); today.setHours(0,0,0,0);
  const todayLogs=logs.filter(l=>new Date(l.created_at)>=today);
  const todayItems=todayLogs.reduce((a,l)=>a+l.item_count,0);
  const goalPct=Math.min(Math.round(todayItems/prefs.daily_goal*100),100);

  // Raccourcis clavier globaux : L = leçons, R = révisions
  useEffect(()=>{
    function handleKey(e:KeyboardEvent) {
      if (e.ctrlKey||e.metaKey||e.altKey) return;
      const target=e.target as HTMLElement|null;
      if (target&&["INPUT","TEXTAREA","SELECT"].includes(target.tagName)) return;
      const k=e.key.toLowerCase();
      if (k==="l"&&lessonCount>0) onLesson();
      else if (k==="r"&&dueCount>0) onReview();
    }
    window.addEventListener("keydown",handleKey);
    return ()=>window.removeEventListener("keydown",handleKey);
  },[lessonCount,dueCount,onLesson,onReview]);

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:"32px 32px 80px" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:32, flexWrap:"wrap", gap:14 }}>
        <div>
          <div style={{ fontSize:30, fontWeight:800, letterSpacing:"-0.5px", color:tc }}>🇮🇩 Bahasa SRS</div>
          <div style={{ color:sc, fontSize:15, marginTop:4 }}>{items.length} items · {levels.length} niveaux</div>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <button onClick={onToggleDark} style={{ background:"none", border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
            borderRadius:10, padding:"8px 14px", fontSize:18, cursor:"pointer" }}>
            {dark?"☀️":"🌙"}
          </button>
          <button onClick={onProfile} style={{ background:"none", border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
            borderRadius:10, padding:"8px 14px", fontSize:14, color:sc, cursor:"pointer" }}>
            ⚙️ Profil
          </button>
          <button onClick={onAdmin} style={{ background:"none", border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
            borderRadius:10, padding:"8px 14px", fontSize:14, color:sc, cursor:"pointer" }}>
            🛠 Admin
          </button>
          <button onClick={onLogout} style={{ background:"none", border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`,
            borderRadius:10, padding:"8px 14px", fontSize:14, color:sc, cursor:"pointer" }}>
            Déconnexion
          </button>
        </div>
      </div>

      {/* Boutons */}
      <div style={{ display:"flex", gap:14, marginBottom:6 }}>
        <button onClick={onLesson} disabled={lessonCount===0} style={{ ...btn("#e06b8b",lessonCount===0,dark), flex:1 }}>
          📚 Leçons ({lessonCount})
        </button>
        <button onClick={onReview} disabled={dueCount===0} style={{ ...btn("#3b82f6",dueCount===0,dark), flex:1 }}>
          🔁 Révisions ({dueCount})
        </button>
        {errorCount>0&&(
          <button onClick={onErrors} style={{ ...btn("#f97316",false,dark), flex:1 }}>
            🔥 Erreurs récentes ({errorCount})
          </button>
        )}
      </div>
      <div style={{ fontSize:12, color:sc, marginBottom:22 }}>
        Raccourcis clavier : <b>L</b> leçons · <b>R</b> révisions
      </div>

      {/* Objectif journalier */}
      <div style={{ ...card(dark), padding:"16px 24px", marginBottom:20, display:"flex", alignItems:"center", gap:20 }}>
        <div style={{ fontSize:13, fontWeight:700, color:sc, whiteSpace:"nowrap" }}>Objectif du jour</div>
        <div style={{ flex:1 }}>
          <Bar value={todayItems} total={prefs.daily_goal} color={goalPct>=100?"#16a34a":"#3b82f6"} height={10}/>
        </div>
        <div style={{ fontSize:14, fontWeight:700, color:goalPct>=100?"#16a34a":tc, whiteSpace:"nowrap" }}>
          {todayItems}/{prefs.daily_goal} {goalPct>=100?"🎉":""}
        </div>
      </div>

      {/* Ligne 1 : Progression + Planning */}
      <div style={{ display:"flex", gap:20, marginBottom:20, alignItems:"flex-start", flexWrap:"wrap" }}>
        <div style={{ flex:"2 1 320px", display:"flex", flexDirection:"column", gap:20 }}>
          <div style={{ ...card(dark), padding:"24px 28px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
              <span style={{ fontWeight:700, fontSize:17, color:tc }}>Progression globale</span>
              <span style={{ color:sc, fontSize:15 }}>{learned.length}/{items.length}</span>
            </div>
            <Bar value={learned.length} total={items.length} color="#e06b8b" height={10}/>
            <div style={{ display:"flex", gap:10, marginTop:24, flexWrap:"wrap" }}>
              {palierCounts.map(({l,icon,c,count})=>(
                <div key={l} style={{ flex:"1 1 70px", background:dark?"#0f172a":"#f9fafb",
                  border:`1px solid ${dark?"#334155":"#e5e7eb"}`, padding:"16px 8px", textAlign:"center", borderRadius:14 }}>
                  <div style={{ fontSize:28, marginBottom:6 }}>{icon}</div>
                  <div style={{ fontSize:28, fontWeight:800, color:c }}>{count}</div>
                  <div style={{ fontSize:12, color:sc, marginTop:6, fontWeight:600 }}>{l}</div>
                </div>
              ))}
            </div>

            {/* Weekly streak intégré */}
            <div style={{ marginTop:20, paddingTop:16, borderTop:`1px solid ${dark?"#334155":"#e5e7eb"}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <span style={{ fontSize:13, fontWeight:600, color:sc }}>Cette semaine</span>
                <span style={{ fontSize:13, color:"#f59e0b", fontWeight:700 }}>🔥 {streak} jour{streak>1?"s":""}</span>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                {Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-6+i); return d; }).map((day,i)=>{
                  const key=day.toISOString().split("T")[0];
                  const today=new Date().toISOString().split("T")[0];
                  const val=(()=>{ const d=heatmap.find(h=>h.day===key); return d?.items_done??0; })();
                  const isToday=key===today;
                  const isFuture=key>today;
                  const goalMet=val>=prefs.daily_goal;
                  const partial=val>0&&!goalMet;
                  const bg=isFuture?(dark?"#1e293b":"#f9fafb"):goalMet?"#16a34a":partial?"#f59e0b":(dark?"#2d3748":"#f3f4f6");
                  const DAY=["D","L","M","M","J","V","S"];
                  return (
                    <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                      <div style={{ fontSize:10, color:isToday?tc:sc, fontWeight:600 }}>{DAY[day.getDay()]}</div>
                      <div style={{ width:"100%", height:24, borderRadius:6, background:bg,
                        border:`1.5px solid ${isToday?"#3b82f6":bg}`,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:10, fontWeight:700, color:goalMet||partial?"#fff":(dark?"#475569":"#d1d5db") }}>
                        {!isFuture&&val>0?val:""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div style={{ flex:"1 1 260px" }}>
          <ReviewSchedule uItems={uItems} dark={dark}/>
        </div>
      </div>
      {/* Heatmap */}
      <div style={{ marginBottom:20 }}>
        <Heatmap data={heatmap} streak={streak} dark={dark}/>
      </div>

      {/* Graphiques */}
      <div style={{ marginBottom:24 }}>
        <StatsPanel logs={logs} uItems={uItems} palierCounts={palierCounts} dark={dark}/>
      </div>

      {/* Niveaux */}
      <div style={{ fontSize:15, fontWeight:700, color:tc, marginBottom:12 }}>Par niveau</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:10 }}>
        {levels.map(lv=>{
          const lvItems=items.filter(i=>i.level===lv);
          const done=lvItems.filter(i=>uItems.find(u=>u.item_id===i.id)?.learned).length;
          return (
            <button key={lv} onClick={()=>onLevelClick(lv)}
              style={{ ...card(dark), padding:"16px 18px", textAlign:"left", cursor:"pointer",
                border:`1.5px solid ${dark?"#334155":"#e5e7eb"}`, width:"100%",
                fontFamily:"inherit", transition:"all .2s" }}
              onMouseEnter={e=>{ e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,.15)";
                e.currentTarget.style.borderColor="#3b82f6"; }}
              onMouseLeave={e=>{ e.currentTarget.style.boxShadow="none";
                e.currentTarget.style.borderColor=dark?"#334155":"#e5e7eb"; }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontWeight:700, fontSize:15, color:tc }}>Niveau {lv}</span>
                <span style={{ fontSize:13, color:sc }}>{done}/{lvItems.length}</span>
              </div>
              <Bar value={done} total={lvItems.length} color={done===lvItems.length?"#16a34a":"#3b82f6"} height={8}/>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── QUIZ CARD ────────────────────────────────────────────────────────────────
function QuizCard({ item, dir, questionNum, totalQuestions, onResult, onQuit, showHintBtn, dark, currentStage }:{
  item:Item; dir:Direction; questionNum:number; totalQuestions:number;
  onResult:(correct:boolean)=>void; onQuit:()=>void;
  showHintBtn:boolean; dark:boolean; currentStage:number;
}) {
  const [input, setInput]       = useState("");
  const [result, setResult]     = useState<null|"correct"|"wrong">(null);
  const [hintShown, setHint]    = useState(false);
  const [shakeCount, setShakeCount] = useState(0);
  const [flashing, setFlashing]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimeout = useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(()=>{ setInput(""); setResult(null); setHint(false); setShakeCount(0); setFlashing(false); setTimeout(()=>inputRef.current?.focus(),50); },[item.id,dir]);

  // Rejoue l'animation de secousse à chaque faute de frappe détectée (même répétée)
  useEffect(()=>{
    if (shakeCount===0) return;
    setFlashing(true);
    const el=inputRef.current;
    if (el) {
      el.style.animation="none";
      void el.offsetWidth; // force le reflow pour pouvoir rejouer l'animation
      el.style.animation="bahasa-shake .4s";
    }
    if (flashTimeout.current) clearTimeout(flashTimeout.current);
    flashTimeout.current=setTimeout(()=>setFlashing(false),500);
    return ()=>{ if(flashTimeout.current) clearTimeout(flashTimeout.current); };
  },[shakeCount]);

  // Swipe support
  const touchStart = useRef<number|null>(null);
  function onTouchStart(e:React.TouchEvent) { touchStart.current=e.touches[0].clientX; }
  function onTouchEnd(e:React.TouchEvent) {
    if (touchStart.current===null) return;
    const diff=e.changedTouches[0].clientX-touchStart.current;
    if (Math.abs(diff)>60 && result) { onResult(result==="correct"); }
    touchStart.current=null;
  }

  const accentBg=result==="correct"?"#16a34a":result==="wrong"?"#dc2626":DIR_CONFIG[dir].bg;
  const displayed=dir==="id_fr"?item.word:item.meaning;
  const expected =dir==="id_fr"?item.meaning:item.word;
  const newStage =result?calcNewStage(currentStage,result==="correct"):null;

  function check() {
    if (result) { onResult(result==="correct"); return; }
    const ok=checkAnswer(input,item,dir);
    if (!ok && isTypo(input,item,dir)) {
      // Faute de frappe probable : on secoue et on laisse l'utilisateur corriger, sans valider
      setShakeCount(c=>c+1);
      return;
    }
    setResult(ok?"correct":"wrong");
    // Son
    try {
      const ctx=new AudioContext();
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value=ok?880:220;
      gain.gain.setValueAtTime(0.3,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);
      osc.start(); osc.stop(ctx.currentTime+0.3);
    } catch {}
  }

  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"0 14px" }}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div style={{ background:accentBg, borderRadius:"0 0 24px 24px",
        padding:"20px 24px 30px", marginBottom:24, transition:"background .25s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <button onClick={onQuit} style={{ background:"rgba(255,255,255,.2)", border:"none",
            cursor:"pointer", color:"#fff", borderRadius:8, padding:"5px 12px",
            fontSize:14, fontFamily:"inherit" }}>← Quitter</button>
          <span style={{ color:"rgba(255,255,255,.8)", fontSize:13 }}>{questionNum}/{totalQuestions}</span>
          <div style={{ flex:1, height:5, background:"rgba(255,255,255,.3)", borderRadius:99, overflow:"hidden" }}>
            <div style={{ width:`${(questionNum-1)/totalQuestions*100}%`, height:"100%",
              background:"rgba(255,255,255,.85)", transition:"width .3s" }}/>
          </div>
          <span style={{ background:"rgba(255,255,255,.2)", color:"#fff",
            padding:"2px 8px", borderRadius:99, fontSize:11, fontWeight:600 }}>
            {DIR_CONFIG[dir].label}
          </span>
        </div>
        <div style={{ textAlign:"center" }}>
          <Badge type={item.type}/>
          <div style={{ fontSize:displayed.length>15?28:56, fontWeight:800, color:"#fff",
            margin:"14px 0 8px", lineHeight:1.1 }}>{displayed}</div>
          {!result&&<div style={{ color:"rgba(255,255,255,.75)", fontSize:15 }}>{DIR_CONFIG[dir].prompt}</div>}
          {result &&<div style={{ color:"rgba(255,255,255,.85)", fontSize:15 }}>
            {dir==="id_fr"?`/${item.reading}/`:item.word}
          </div>}
        </div>
      </div>
      <div style={{ padding:"0 8px" }}>
        <style>{`@keyframes bahasa-shake{
          10%,90%{transform:translateX(-1px)}
          20%,80%{transform:translateX(2px)}
          30%,50%,70%{transform:translateX(-4px)}
          40%,60%{transform:translateX(4px)}
        }`}</style>
        <input ref={inputRef} autoFocus value={input}
          onChange={e=>{ if(!result) setInput(e.target.value); }}
          onKeyDown={e=>e.key==="Enter"&&check()}
          placeholder={dir==="id_fr"?"Sens en français…":"Mot en indonésien…"}
          style={{ width:"100%", boxSizing:"border-box", padding:"15px 16px", fontSize:17,
            border:`2px solid ${result?accentBg:(flashing?"#f59e0b":(dark?"#334155":"#e5e7eb"))}`,
            borderRadius:14, outline:"none", marginBottom:12, fontFamily:"inherit",
            background:result?(result==="correct"?"#dcfce7":"#fee2e2"):(dark?"#1e293b":"#fff"),
            color:dark&&!result?"#f1f5f9":"#1f2937" }}
          autoComplete="off"/>
        {flashing&&!result&&<div style={{ textAlign:"center", marginTop:-6, marginBottom:10,
          fontSize:13, color:"#d97706" }}>Presque ! Vérifie l'orthographe ✏️</div>}

        {/* Bouton indice */}
        {showHintBtn&&!result&&item.hint&&!hintShown&&(
          <button onClick={()=>setHint(true)}
            style={{ background:"none", border:`1px solid ${dark?"#334155":"#e5e7eb"}`,
              borderRadius:10, padding:"8px 16px", fontSize:13, color:dark?"#94a3b8":"#6b7280",
              cursor:"pointer", marginBottom:10, fontFamily:"inherit" }}>
            💡 Voir l'astuce
          </button>
        )}
        {hintShown&&item.hint&&!result&&(
          <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:10,
            padding:"10px 14px", marginBottom:10, fontSize:13, color:"#78350f" }}>
            💡 {item.hint}
          </div>
        )}

        {result&&(
          <div style={{ background:result==="correct"?"#dcfce7":"#fee2e2",
            border:`1px solid ${result==="correct"?"#86efac":"#fca5a5"}`,
            borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
            <div style={{ fontWeight:700, color:result==="correct"?"#166534":"#991b1b", fontSize:16 }}>
              {result==="correct"?"✓ Correct !":` ✗  ${expected}`}
            </div>
            {result==="wrong"&&(
              <div style={{ color:"#6b7280", fontSize:14, marginTop:4 }}>
                {item.word} = {item.meaning}
                {item.hint&&<div style={{ color:"#9ca3af", marginTop:3 }}>💡 {item.hint}</div>}
              </div>
            )}
            {result==="correct"&&item.hint&&
              <div style={{ color:"#6b7280", fontSize:14, marginTop:4 }}>💡 {item.hint}</div>}
          </div>
        )}

        {result&&newStage!==null&&(
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:12 }}>
            <span style={{ background:SRS_STAGES[currentStage].bg, color:SRS_STAGES[currentStage].color,
              padding:"4px 12px", borderRadius:99, fontSize:13, fontWeight:600 }}>
              {SRS_STAGES[currentStage].icon} {SRS_STAGES[currentStage].name}
            </span>
            <span style={{ fontSize:16, fontWeight:800,
              color:newStage>currentStage?"#16a34a":newStage<currentStage?"#dc2626":(dark?"#64748b":"#9ca3af") }}>
              {newStage>currentStage?"↑":newStage<currentStage?"↓":"="}
            </span>
            <span style={{ background:SRS_STAGES[newStage].bg, color:SRS_STAGES[newStage].color,
              padding:"4px 12px", borderRadius:99, fontSize:13, fontWeight:700 }}>
              {SRS_STAGES[newStage].icon} {SRS_STAGES[newStage].name}
            </span>
          </div>
        )}
        <button onClick={check} style={btn(accentBg,false,dark)}>
          {result?"Suivant →":"Valider"}
        </button>
        {result&&<div style={{ textAlign:"center", marginTop:8, fontSize:12, color:dark?"#475569":"#9ca3af" }}>
          ou swipe →
        </div>}
      </div>
    </div>
  );
}

// ─── LESSON VIEW ──────────────────────────────────────────────────────────────
function LessonView({ items, prefs, onComplete, dark }:{
  items:Item[]; prefs:UserPrefs; onComplete:(r:QResult[])=>void; dark:boolean;
}) {
  const BATCH=Math.min(5,items.length);
  const batch=useRef(items.slice(0,BATCH)).current;
  const [learnIdx, setLearnIdx]=useState(0);
  const [phase, setPhase]=useState<"learn"|"quiz">("learn");
  const [queue, setQueue]=useState<{item:Item;dir:Direction}[]>(()=>[
    ...batch.map(item=>({item,dir:"id_fr" as Direction})),
    ...(prefs.fr_id_enabled?batch.map(item=>({item,dir:"fr_id" as Direction})):[]),
  ]);
  const [qIdx, setQIdx]=useState(0);
  const [results, setResults]=useState<QResult[]>([]);
  const [answered, setAnswered]=useState<Set<number>>(new Set());
  const learnItem=batch[learnIdx];
  const tc=dark?"#f1f5f9":"#1f2937";
  const sc=dark?"#94a3b8":"#6b7280";

  useEffect(()=>{
    if (phase!=="learn") return;
    function handleKey(e:KeyboardEvent) {
      if (e.key==="ArrowRight"||e.key==="ArrowDown") {
        if (learnIdx<BATCH-1) setLearnIdx(i=>i+1); else setPhase("quiz");
      }
      if (e.key==="ArrowLeft"||e.key==="ArrowUp") {
        if (learnIdx>0) setLearnIdx(i=>i-1);
      }
    }
    window.addEventListener("keydown",handleKey);
    return ()=>window.removeEventListener("keydown",handleKey);
  },[phase,learnIdx,BATCH]);

  useEffect(()=>{
    if (qIdx<queue.length) return;
    const allDone=batch.every(item=>answered.has(item.id));
    if (!allDone) {
      const missing=batch.filter(item=>!answered.has(item.id)).flatMap(item=>[
        {item,dir:"id_fr" as Direction},
        ...(prefs.fr_id_enabled?[{item,dir:"fr_id" as Direction}]:[]),
      ]);
      setQueue(q=>[...q,...missing]);
    } else {
      onComplete(results);
    }
  },[qIdx, queue.length]);

  if (phase==="learn") return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"0 14px" }}>
      <div style={{ background:"#e06b8b", borderRadius:"0 0 24px 24px", padding:"20px 24px 30px", marginBottom:24 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <button onClick={()=>onComplete([])} style={{ background:"rgba(255,255,255,.2)", border:"none",
            cursor:"pointer", color:"#fff", borderRadius:8, padding:"5px 12px", fontSize:14, fontFamily:"inherit" }}>
            ← Quitter
          </button>
          <span style={{ color:"rgba(255,255,255,.8)", fontSize:13 }}>Leçon {learnIdx+1}/{BATCH}</span>
        </div>
        <div style={{ textAlign:"center" }}>
          <Badge type={learnItem.type}/>
          <div style={{ fontSize:learnItem.word.length>15?28:56, fontWeight:800, color:"#fff",
            margin:"14px 0 4px", lineHeight:1.1 }}>{learnItem.word}</div>
          <div style={{ color:"rgba(255,255,255,.85)", fontSize:17 }}>/{learnItem.reading}/</div>
        </div>
      </div>
      <div style={{ padding:"0 8px" }}>
        <div style={{ ...card(dark), padding:"16px 20px", marginBottom:12 }}>
          <div style={{ fontSize:11, color:sc, marginBottom:6, textTransform:"uppercase", fontWeight:700 }}>Sens</div>
          <div style={{ fontSize:22, fontWeight:700, color:tc }}>{learnItem.meaning}</div>
          {learnItem.alt?.length>0&&
            <div style={{ fontSize:14, color:sc, marginTop:4 }}>Aussi : {learnItem.alt.join(", ")}</div>}
        </div>
        {learnItem.hint&&(
          <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:14,
            padding:"14px 18px", marginBottom:18 }}>
            <div style={{ fontSize:11, color:"#92400e", marginBottom:4, textTransform:"uppercase", fontWeight:700 }}>💡 Astuce</div>
            <div style={{ fontSize:14, color:"#78350f" }}>{learnItem.hint}</div>
          </div>
        )}
        <div style={{ display:"flex", gap:10 }}>
          {learnIdx>0&&(
            <button onClick={()=>setLearnIdx(i=>i-1)}
              style={{ ...btn("#6b7280",false,dark), width:"auto", padding:"16px 20px", fontSize:20 }}>←</button>
          )}
          <button onClick={()=>{ if(learnIdx<BATCH-1) setLearnIdx(i=>i+1); else setPhase("quiz"); }}
            style={btn("#e06b8b",false,dark)}>
            {learnIdx<BATCH-1?"Suivant →":"Passer au quiz →"}
          </button>
        </div>
        <div style={{ textAlign:"center", marginTop:8, fontSize:12, color:sc }}>← → pour naviguer</div>
      </div>
    </div>
  );



  if (qIdx>=queue.length) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh" }}>🌀</div>;
  const {item,dir}=queue[qIdx];
  return (
    <QuizCard item={item} dir={dir} questionNum={qIdx+1} totalQuestions={queue.length}
      showHintBtn={true} dark={dark} currentStage={0}
      onQuit={()=>onComplete([])}
      onResult={correct=>{
        setResults(r=>[...r,{item_id:item.id,correct}]);
        if (correct) { setAnswered(s=>new Set([...s,item.id])); setQIdx(i=>i+1); }
        else { setQueue(q=>[...q,{item,dir}]); setQIdx(i=>i+1); }
      }}/>
  );
}

// ─── REVIEW VIEW ──────────────────────────────────────────────────────────────
// Nombre de mots "en cours" au maximum en même temps pendant une session de révision
// (façon WaniKani : on ne pioche pas tout le pool de mots dus d'un coup, on tire par lots).
const REVIEW_BATCH = 10;

function ReviewView({ dueItems, items, prefs, onComplete, dark, title }:{
  dueItems:UItem[]; items:Item[]; prefs:UserPrefs; onComplete:(r:QResult[])=>void; dark:boolean; title?:string;
}) {
  // Ordre de pioche des mots dus, mélangé une seule fois au montage
  const shuffledPool=useRef(dueItems.slice().sort(()=>Math.random()-.5)).current;

  function buildEntries(pool:UItem[]): {item:Item;dir:Direction}[] {
    return pool.flatMap(u=>{
      const item=items.find(i=>i.id===u.item_id);
      if (!item) return [];
      return [
        {item,dir:"id_fr" as Direction},
        ...(prefs.fr_id_enabled?[{item,dir:"fr_id" as Direction}]:[]),
      ];
    }).sort(()=>Math.random()-.5);
  }

  const initialBatch=shuffledPool.slice(0,Math.min(REVIEW_BATCH,shuffledPool.length));
  const [pulledCount, setPulledCount]=useState(initialBatch.length);
  const [activeIds, setActiveIds]=useState<Set<number>>(()=>new Set(initialBatch.map(u=>u.item_id)));
  const [queue, setQueue]=useState<{item:Item;dir:Direction}[]>(()=>buildEntries(initialBatch));
  const [qIdx, setQIdx]=useState(0);
  const [results, setResults]=useState<QResult[]>([]);
  const [answered, setAnswered]=useState<Set<string>>(new Set());
  const [wrappingUp, setWrappingUp]=useState(false);

  useEffect(()=>{
    if (qIdx<queue.length) return;
    // Les mots actuellement "en cours" ont-ils tous été répondus correctement dans toutes les directions ?
    const activeItems=items.filter(i=>activeIds.has(i.id));
    const allActiveDone=activeItems.every(item=>{
      if (!prefs.fr_id_enabled) return answered.has(`${item.id}_id_fr`);
      return answered.has(`${item.id}_id_fr`)&&answered.has(`${item.id}_fr_id`);
    });
    if (!allActiveDone) {
      // Filet de sécurité : rajoute les directions manquantes des mots déjà actifs (ne devrait
      // normalement pas arriver, les erreurs sont rebouclées directement dans onResult)
      const missing=activeItems.flatMap(item=>{
        const dirs:Direction[]=[];
        if (!answered.has(`${item.id}_id_fr`)) dirs.push("id_fr");
        if (prefs.fr_id_enabled&&!answered.has(`${item.id}_fr_id`)) dirs.push("fr_id");
        return dirs.map(dir=>({item,dir}));
      });
      if (missing.length) setQueue(q=>[...q,...missing]);
      return;
    }
    // Le lot actif est terminé : si on ne "wrap up" pas et qu'il reste des mots dus, on pioche le lot suivant
    if (!wrappingUp && pulledCount<shuffledPool.length) {
      const nextBatch=shuffledPool.slice(pulledCount,pulledCount+REVIEW_BATCH);
      setPulledCount(c=>c+nextBatch.length);
      setActiveIds(new Set(nextBatch.map(u=>u.item_id)));
      setQueue(q=>[...q,...buildEntries(nextBatch)]);
    }
    // Sinon : rien à piocher de plus, l'écran de fin de session s'affiche ci-dessous
  },[qIdx, queue.length]);

  if (qIdx>=queue.length && results.length===0) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh" }}>🌀</div>;
    if (qIdx>=queue.length) {
      const correct=results.filter(r=>r.correct).length;
      const pct=results.length?Math.round(correct/results.length*100):0;
      return (
        <div style={{ maxWidth:520, margin:"0 auto", padding:"60px 16px", textAlign:"center" }}>
          <div style={{ fontSize:64 }}>{pct>=80?"🎉":pct>=50?"💪":"😅"}</div>
          {title&&<div style={{ fontSize:13, fontWeight:700, color:"#f97316", marginBottom:6 }}>{title}</div>}
          <div style={{ fontSize:26, fontWeight:800, margin:"16px 0 8px", color:dark?"#f1f5f9":"#1f2937" }}>Session terminée !</div>
          <div style={{ color:dark?"#94a3b8":"#6b7280", fontSize:16 }}>{correct}/{results.length} correctes ({pct}%)</div>
          <div style={{ marginTop:24, ...card(dark), padding:"20px", textAlign:"left" }}>
            {[
              {l:"Correctes",   n:correct,               c:"#16a34a"},
              {l:"Incorrectes", n:results.length-correct, c:"#dc2626"},
              {l:"Précision",   n:pct+"%",               c:"#3b82f6"},
            ].map(({l,n,c})=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between",
                padding:"10px 0", borderBottom:`1px solid ${dark?"#334155":"#f3f4f6"}` }}>
                <span style={{ color:dark?"#94a3b8":"#6b7280", fontSize:15 }}>{l}</span>
                <span style={{ fontWeight:800, color:c, fontSize:15 }}>{n}</span>
              </div>
            ))}
          </div>
          <button onClick={()=>onComplete(results)}
            style={{ ...btn("#3b82f6",false,dark), marginTop:24, width:"auto", padding:"14px 48px" }}>
            ← Retour
          </button>
        </div>
      );
    }

  const {item,dir}=queue[qIdx];
  const remainingInPool=shuffledPool.length-pulledCount;
  return (
    <>
      {(title||remainingInPool>0)&&(
        <div style={{ maxWidth:560, margin:"10px auto 0", padding:"0 14px",
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
          <div>
            {title&&<div style={{ fontSize:13, fontWeight:700, color:"#f97316" }}>{title}</div>}
            {remainingInPool>0&&<div style={{ fontSize:12, color:dark?"#64748b":"#9ca3af", marginTop:2 }}>
              {activeIds.size} mot{activeIds.size>1?"s":""} en cours · {remainingInPool} en attente
            </div>}
          </div>
          {remainingInPool>0&&(
            wrappingUp
              ? <span style={{ fontSize:12, fontWeight:700, color:"#f59e0b", whiteSpace:"nowrap" }}>🏁 Finalisation…</span>
              : <button onClick={()=>setWrappingUp(true)}
                  style={{ background:"none", border:"1.5px solid #f59e0b", color:"#f59e0b",
                    borderRadius:10, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer",
                    fontFamily:"inherit", whiteSpace:"nowrap" }}>
                  🏁 Terminer la session
                </button>
          )}
        </div>
      )}
      <QuizCard item={item} dir={dir} questionNum={qIdx+1} totalQuestions={queue.length}
        showHintBtn={true} dark={dark} currentStage={dueItems.find(u=>u.item_id===item.id)?.stage??0}
        onQuit={()=>onComplete(results)}
        onResult={correct=>{
          setResults(r=>[...r,{item_id:item.id,correct}]);
          if (correct) { setAnswered(s=>new Set([...s,`${item.id}_${dir}`])); setQIdx(i=>i+1); }
          else { setQueue(q=>[...q,{item,dir}]); setQIdx(i=>i+1); }
        }}/>
    </>
  );
}

// ─── CONFETTIS (niveau terminé) ────────────────────────────────────────────────
function Confetti({ onDone }:{ onDone:()=>void }) {
  useEffect(()=>{ const t=setTimeout(onDone,3400); return ()=>clearTimeout(t); },[onDone]);
  const colors=["#e06b8b","#9b59b6","#3b82f6","#0ea5e9","#16a34a","#f59e0b"];
  const pieces=useRef(Array.from({length:70},(_,i)=>({
    left:Math.random()*100,
    delay:Math.random()*0.5,
    duration:2.4+Math.random()*1.4,
    color:colors[i%colors.length],
    size:6+Math.random()*6,
  }))).current;
  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", overflow:"hidden", zIndex:9999 }}>
      <style>{`@keyframes bahasa-confetti-fall{
        0%{ transform:translateY(-10vh) rotate(0deg); opacity:1; }
        100%{ transform:translateY(110vh) rotate(640deg); opacity:.85; }
      }`}</style>
      {pieces.map((p,i)=>(
        <div key={i} style={{
          position:"absolute", top:0, left:`${p.left}%`,
          width:p.size, height:p.size*0.4, background:p.color, borderRadius:2,
          animation:`bahasa-confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
        }}/>
      ))}
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthForm() {
  const [mode, setMode]=useState<"login"|"register">("login");
  const [email, setEmail]=useState("");
  const [pass, setPass]=useState("");
  const [err, setErr]=useState("");
  const [load, setLoad]=useState(false);

  async function submit(e:React.FormEvent) {
    e.preventDefault(); setErr(""); setLoad(true);
    try {
      if (mode==="login") {
        const {error}=await supabase.auth.signInWithPassword({email,password:pass});
        if (error) throw error;
      } else {
        const {data,error}=await supabase.auth.signUp({email,password:pass});
        if (error) throw error;
        if (data.user) {
          const {data:allItems}=await supabase.from("items").select("id");
          if (allItems?.length) {
            await supabase.from("user_items").insert(
              allItems.map((it:any)=>({user_id:data.user!.id,item_id:it.id,stage:0,
                next_review:new Date().toISOString(),correct_count:0,wrong_count:0,learned:false}))
            );
          }
        }
      }
    } catch(e:any) { setErr(e.message); }
    finally { setLoad(false); }
  }

  return (
    <div style={{ maxWidth:380, margin:"100px auto", padding:"0 24px" }}>
      <div style={{ textAlign:"center", marginBottom:36 }}>
        <div style={{ fontSize:48 }}>🇮🇩</div>
        <div style={{ fontSize:28, fontWeight:800, marginTop:12 }}>Bahasa SRS</div>
        <div style={{ color:"#6b7280", fontSize:15, marginTop:6 }}>
          {mode==="login"?"Connexion à votre compte":"Créer un compte gratuit"}
        </div>
      </div>
      <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" required
          style={{ padding:"14px 16px", borderRadius:12, border:"1.5px solid #e5e7eb", fontSize:16, outline:"none", fontFamily:"inherit" }}/>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
          placeholder="Mot de passe (min. 6 caractères)" required minLength={6}
          style={{ padding:"14px 16px", borderRadius:12, border:"1.5px solid #e5e7eb", fontSize:16, outline:"none", fontFamily:"inherit" }}/>
        {err&&<p style={{ color:"#dc2626", fontSize:14, margin:0 }}>{err}</p>}
        <button type="submit" disabled={load} style={btn(load?"#d1d5db":"#e06b8b",load)}>
          {load?"…":mode==="login"?"Se connecter":"S'inscrire"}
        </button>
      </form>
      <p style={{ textAlign:"center", color:"#6b7280", fontSize:14, marginTop:20 }}>
        {mode==="login"?"Pas de compte ? ":"Déjà inscrit ? "}
        <button onClick={()=>{setErr("");setMode(m=>m==="login"?"register":"login")}}
          style={{ background:"none", border:"none", color:"#e06b8b", cursor:"pointer", fontWeight:700, fontSize:14 }}>
          {mode==="login"?"S'inscrire":"Se connecter"}
        </button>
      </p>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
const DEFAULT_PREFS: UserPrefs = { fr_id_enabled:true, daily_goal:20 };
const PREFS_KEY = "bahasa_prefs";

export default function App() {
  const [user, setUser]           = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [items, setItems]         = useState<Item[]>([]);
  const [uItems, setUItems]       = useState<UItem[]>([]);
  const [logs, setLogs]           = useState<SessionLog[]>([]);
  const [heatmap, setHeatmap]     = useState<HeatDay[]>([]);
  const [streak, setStreak]       = useState(0);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [view, setView]           = useState<View>("dashboard");
  const [selectedLevel, setSelectedLevel] = useState<number|null>(null);
  const [dark, setDark]           = useState(()=>localStorage.getItem("bahasa_dark")==="1");
  const [confettiLevel, setConfettiLevel] = useState<number|null>(null);
  const [prefs, setPrefs]         = useState<UserPrefs>(()=>{
    // Important : fusionner avec DEFAULT_PREFS, sinon un localStorage vide ({}) donne
    // fr_id_enabled=undefined (donc désactivé) au lieu du true attendu par défaut.
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY)||"{}") } as UserPrefs; }
    catch { return DEFAULT_PREFS; }
  });

  useEffect(()=>{
    document.body.style.transition="background .4s, color .4s";
    document.body.style.background=dark?"#0f172a":"#f9fafb";
    document.body.style.color=dark?"#f1f5f9":"#1f2937";
    localStorage.setItem("bahasa_dark",dark?"1":"0");
  },[dark]);

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{ setUser(data.session?.user??null); setAuthReady(true); });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{ setUser(session?.user??null); });
    return ()=>subscription.unsubscribe();
  },[]);

  const loadData=useCallback(async(uid:string)=>{
    setLoading(true);
    const [{data:cat},{data:prog},{data:logData},{data:heat},{data:streakData}]=await Promise.all([
      supabase.from("items").select("*").order("level"),
      supabase.from("user_items").select("*").eq("user_id",uid),
      supabase.from("session_logs").select("*").eq("user_id",uid)
        .gte("created_at",new Date(Date.now()-90*24*3600*1000).toISOString()) // 90j : 7j pour l'onglet Activité + historique pour le graphique de progression hebdo
        .order("created_at",{ascending:true}),
      supabase.rpc("get_heatmap_data",{p_user_id:uid}),
      supabase.rpc("get_user_streak",{p_user_id:uid}),
    ]);
    setItems(cat??[]); setUItems(prog??[]); setLogs(logData??[]);
    setHeatmap(heat??[]); setStreak(streakData??0);
    setLoading(false);
    return prog??[];
  },[]);

  useEffect(()=>{ if(user) loadData(user.id); },[user,loadData]);

  async function applyResults(results:QResult[], sessionType:"lesson"|"review") {
    if (!user||!results.length) { setView("dashboard"); return; }
    setSaving(true);
    const byItem:Record<number,boolean>={};
    results.forEach(({item_id,correct})=>{
      if (byItem[item_id]===undefined) byItem[item_id]=correct;
      else byItem[item_id]=byItem[item_id]&&correct;
    });
    const deduped=Object.entries(byItem).map(([id,correct])=>({item_id:Number(id),correct}));
    const correct=results.filter(r=>r.correct).length;
    const wrong=results.filter(r=>!r.correct).length;
    const prevUItems=uItems;
    await Promise.all([
      supabase.rpc("apply_review_results",{p_user_id:user.id,p_results:deduped}),
      supabase.from("session_logs").insert({
        user_id:user.id,session_type:sessionType,
        item_count:deduped.length,correct,wrong,
      }),
    ]);
    const newUItems=await loadData(user.id);
    // Niveau tout juste terminé ? -> confettis
    const levels=Array.from(new Set(items.map(i=>i.level)));
    const justCompleted=levels.find(lv=>
      !isLevelComplete(lv,items,prevUItems) && isLevelComplete(lv,items,newUItems)
    );
    if (justCompleted!==undefined) {
      setConfettiLevel(justCompleted);
    }
    setSaving(false); setView("dashboard");
  }

  function savePrefs(p:UserPrefs) {
    setPrefs(p);
    localStorage.setItem(PREFS_KEY,JSON.stringify(p));
    setView("dashboard");
  }

  async function logout() { await supabase.auth.signOut(); setItems([]); setUItems([]); setLogs([]); }

  if (!authReady) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontSize:36 }}>🌀</div>;
  if (!user) return <AuthForm/>;
  if (loading||saving) return (
    <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:14 }}>
      <div style={{ fontSize:36 }}>🌀</div>
      <div style={{ color:dark?"#94a3b8":"#6b7280",fontSize:16 }}>{saving?"Sauvegarde…":"Chargement…"}</div>
    </div>
  );

  const now=new Date().toISOString();
  const dueItems=uItems.filter(u=>u.learned&&u.next_review<=now&&u.stage<10);
  const lessonItems=items.filter(i=>!uItems.find(u=>u.item_id===i.id)?.learned);
  const errorCutoff=new Date(Date.now()-24*3600*1000).toISOString();
  const errorItems=uItems.filter(u=>u.learned&&u.last_wrong_at&&u.last_wrong_at>=errorCutoff);

  if (view==="level_detail"&&selectedLevel!==null)
    return <LevelDetail level={selectedLevel} items={items} uItems={uItems} onBack={()=>setView("dashboard")} dark={dark}
      onUpdateItem={updated=>setItems(prev=>prev.map(i=>i.id===updated.id?updated:i))}/>;
  if (view==="profile")
    return <ProfilePage prefs={prefs} onSave={savePrefs} onBack={()=>setView("dashboard")} dark={dark} items={items} uItems={uItems}/>;
  if (view==="admin")
    return <AdminPage onBack={()=>setView("dashboard")} dark={dark} userId={user.id}/>;
  if (view==="lesson")
    return <LessonView items={lessonItems} prefs={prefs} onComplete={async r=>{ if(!r.length){setView("dashboard");return;} await applyResults(r,"lesson"); }} dark={dark}/>;
  if (view==="review")
    return <ReviewView dueItems={dueItems} items={items} prefs={prefs} onComplete={r=>applyResults(r,"review")} dark={dark}/>;
  if (view==="review_errors")
    return <ReviewView dueItems={errorItems} items={items} prefs={prefs} onComplete={r=>applyResults(r,"review")} dark={dark} title="🔥 Erreurs récentes"/>;

  return (
    <>
      <Dashboard items={items} uItems={uItems} logs={logs} heatmap={heatmap} streak={streak}
        prefs={prefs} dark={dark}
        onLesson={()=>setView("lesson")} onReview={()=>setView("review")} onErrors={()=>setView("review_errors")}
        onLogout={logout} onLevelClick={lv=>{setSelectedLevel(lv);setView("level_detail");}}
        onProfile={()=>setView("profile")} onAdmin={()=>setView("admin")}
        onToggleDark={()=>setDark(d=>!d)}/>
      {confettiLevel!==null&&(
        <>
          <Confetti onDone={()=>setConfettiLevel(null)}/>
          <div style={{ position:"fixed", top:24, left:"50%", transform:"translateX(-50%)",
            background:dark?"#1e293b":"#fff", border:"2px solid #f59e0b", borderRadius:16,
            padding:"14px 28px", boxShadow:"0 8px 24px rgba(0,0,0,.18)", zIndex:10000,
            fontWeight:800, fontSize:16, color:dark?"#f1f5f9":"#1f2937" }}>
            🎉 Niveau {confettiLevel} terminé !
          </div>
        </>
      )}
    </>
  );
}