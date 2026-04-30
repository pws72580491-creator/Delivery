import { useState, useEffect, useRef, useCallback } from "react";

const TABS = ["내 차량", "정비 기록", "주유 기록", "알림"];

const maintenanceTypes = [
  "엔진오일 교체", "타이어 교환", "브레이크 패드", "에어필터", "배터리 교체",
  "냉각수 교체", "와이퍼 교체", "점화플러그", "변속기 오일", "기타"
];

function formatDate(d) {
  if (!d) return "-";
  const date = new Date(d);
  return `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getDate()).padStart(2,'0')}`;
}
function formatNum(n) { return Number(n).toLocaleString(); }

// ── Theme tokens ─────────────────────────────────────────────────────
const DARK = {
  bg: "#0a0a0f", surface: "#13131a", surface2: "#0d0d14",
  border: "#1e1e2e", border2: "#1a1a28",
  text: "#e8e8f0", textSub: "#888", textMuted: "#555", textDim: "#444",
  tabBar: "#0d0d14",
  inputBg: "#0d0d14", inputBorder: "#1e1e2e", inputText: "#e8e8f0",
  modalBg: "rgba(0,0,0,0.78)", modalSurface: "#13131a", modalBorder: "#2a2a3e",
  cardBg: "#13131a", cardBorder: "#1e1e2e",
  listBg: "#0d0d14", listBorder: "#1a1a28",
  dotInactive: "#2a2a3e", deleteBtnColor: "#444",
  emojiBtnBg: "#0d0d14", emojiBtnBorder: "#1e1e2e",
  toggleBg: "#1a1a28", headingColor: "#ffffff",
};
const LIGHT = {
  bg: "#f0f2f8", surface: "#ffffff", surface2: "#f5f7fc",
  border: "#dde1ee", border2: "#e8ecf5",
  text: "#1a1a2e", textSub: "#666", textMuted: "#999", textDim: "#ccc",
  tabBar: "#ffffff",
  inputBg: "#f5f7fc", inputBorder: "#dde1ee", inputText: "#1a1a2e",
  modalBg: "rgba(0,0,0,0.38)", modalSurface: "#ffffff", modalBorder: "#e0e4ed",
  cardBg: "#ffffff", cardBorder: "#dde1ee",
  listBg: "#f5f7fc", listBorder: "#e8ecf5",
  dotInactive: "#dde1ee", deleteBtnColor: "#ccc",
  emojiBtnBg: "#f0f2f8", emojiBtnBorder: "#dde1ee",
  toggleBg: "#eef0f8", headingColor: "#1a1a2e",
};

const btnPrimary = {
  background: "#ff6b00", color: "#fff", fontFamily: "inherit", fontWeight: 700,
  fontSize: 13, borderRadius: 8, padding: "9px 18px", border: "none", cursor: "pointer", letterSpacing: 0.5,
};

// ── Field helpers ────────────────────────────────────────────────────
function FL({ T, children }) {
  return <div style={{ fontSize:11, color:T.textMuted, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>{children}</div>;
}
function FI({ T, ...props }) {
  return <input {...props} style={{ width:"100%", background:T.inputBg, border:`1px solid ${T.inputBorder}`, color:T.inputText, fontFamily:"inherit", fontSize:14, padding:"10px 14px", borderRadius:8, outline:"none" }} />;
}
function FS({ T, children, ...props }) {
  return <select {...props} style={{ width:"100%", background:T.inputBg, border:`1px solid ${T.inputBorder}`, color:T.inputText, fontFamily:"inherit", fontSize:14, padding:"10px 14px", borderRadius:8, outline:"none" }}>{children}</select>;
}
function FTA({ T, ...props }) {
  return <textarea {...props} style={{ width:"100%", background:T.inputBg, border:`1px solid ${T.inputBorder}`, color:T.inputText, fontFamily:"inherit", fontSize:14, padding:"10px 14px", borderRadius:8, outline:"none", resize:"none" }} />;
}

function EmptyState({ icon, text, sub, T }) {
  return (
    <div style={{ textAlign:"center", padding:"44px 20px", background:T.cardBg, border:`1px solid ${T.cardBorder}`, borderRadius:12 }}>
      <div style={{ fontSize:38, marginBottom:10 }}>{icon}</div>
      <div style={{ fontSize:14, color:T.textSub }}>{text}</div>
      {sub && <div style={{ fontSize:12, color:T.textMuted, marginTop:5 }}>{sub}</div>}
    </div>
  );
}

function CarFilter({ cars, selectedCar, setSelectedCar }) {
  return (
    <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
      {cars.map(c => (
        <button key={c.id} onClick={() => setSelectedCar(c.id)}
          style={{ background:selectedCar===c.id?"#ff6b0018":"transparent", color:"#ff6b00", border:`1px solid ${selectedCar===c.id?"#ff6b00":"#ff6b0050"}`, fontFamily:"inherit", fontWeight:600, fontSize:12, borderRadius:8, padding:"7px 14px", cursor:"pointer" }}>
          {c.name}
        </button>
      ))}
    </div>
  );
}

function ModalShell({ T, title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:T.modalBg, backdropFilter:"blur(4px)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:T.modalSurface, border:`1px solid ${T.modalBorder}`, borderRadius:16, padding:26, width:"100%", maxWidth:440, animation:"fadeIn 0.22s ease", maxHeight:"88vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontFamily:"Rajdhani", fontSize:18, fontWeight:700, color:T.headingColor, letterSpacing:1 }}>{title}</div>
          <button onClick={onClose} style={{ background:"none", color:T.textMuted, fontSize:22, border:"none", cursor:"pointer", lineHeight:1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CarModal({ onClose, onSave, T, initialData }) {
  const isEdit = !!initialData;
  const [form, setForm] = useState(initialData || { name:"", plate:"", year:new Date().getFullYear(), mileage:0, fuel:"휘발유", color:"", insurance:"", emoji:"🚗" });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  const emojis = ["🚗","🚙","🚕","🏎","🚐","🚌","🛻","🚓","🚑","🚒"];
  const stopProp = e => e.stopPropagation();

  return (
    <div style={{ position:"fixed", inset:0, background:T.modalBg, backdropFilter:"blur(4px)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:T.modalSurface, border:`1px solid ${T.modalBorder}`, borderRadius:16, padding:26, width:"100%", maxWidth:440, animation:"fadeIn 0.22s ease", maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontFamily:"Rajdhani", fontSize:18, fontWeight:700, color:T.headingColor, letterSpacing:1 }}>{isEdit ? "차량 정보 수정" : "차량 추가"}</div>
          <button onClick={onClose} style={{ background:"none", color:T.textMuted, fontSize:22, border:"none", cursor:"pointer" }}>×</button>
        </div>
        <div style={{ marginBottom:16 }}>
          <FL T={T}>아이콘 선택</FL>
          <div onTouchStart={stopProp} onTouchMove={stopProp} onTouchEnd={stopProp}
            style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, touchAction:"pan-x", WebkitOverflowScrolling:"touch" }}>
            {emojis.map(e => (
              <button key={e} onClick={() => set("emoji", e)}
                style={{ fontSize:24, flexShrink:0, background:form.emoji===e?"#ff6b0020":T.emojiBtnBg, border:`1px solid ${form.emoji===e?"#ff6b00":T.emojiBtnBorder}`, borderRadius:8, padding:"6px 10px", cursor:"pointer", transition:"all 0.15s" }}>
                {e}
              </button>
            ))}
          </div>
        </div>
        {[["차량명","name","text","예) 내 아반떼"],["번호판","plate","text","예) 12가 3456"],["연식","year","number",""],["현재 주행거리 (km)","mileage","number",""],["색상","color","text","예) 흰색"]].map(([label,key,type,ph]) => (
          <div key={key} style={{ marginBottom:12 }}>
            <FL T={T}>{label}</FL>
            <FI T={T} type={type} placeholder={ph} value={form[key]} onChange={e=>set(key,e.target.value)} />
          </div>
        ))}
        <div style={{ marginBottom:12 }}><FL T={T}>보험 만료일</FL><FI T={T} type="date" value={form.insurance} onChange={e=>set("insurance",e.target.value)} /></div>
        <div style={{ marginBottom:18 }}>
          <FL T={T}>연료 유형</FL>
          <FS T={T} value={form.fuel} onChange={e=>set("fuel",e.target.value)}>
            {["휘발유","경유","LPG","전기","하이브리드"].map(f=><option key={f}>{f}</option>)}
          </FS>
        </div>
        <button style={{ ...btnPrimary, width:"100%", padding:"13px" }}
          onClick={() => { if(!form.name||!form.plate) return alert("차량명과 번호판을 입력해주세요."); onSave(form); }}>저장</button>
      </div>
    </div>
  );
}

function MaintForm({ cars, selectedCar, onSave, T }) {
  const [form, setForm] = useState({ carId:selectedCar||cars[0]?.id, type:maintenanceTypes[0], date:new Date().toISOString().split("T")[0], mileage:"", cost:"", shop:"", note:"" });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  return (
    <div>
      {cars.length>1 && <div style={{marginBottom:12}}><FL T={T}>차량 선택</FL><FS T={T} value={form.carId} onChange={e=>set("carId",e.target.value)}>{cars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</FS></div>}
      <div style={{marginBottom:12}}><FL T={T}>정비 유형</FL><FS T={T} value={form.type} onChange={e=>set("type",e.target.value)}>{maintenanceTypes.map(t=><option key={t}>{t}</option>)}</FS></div>
      {[["날짜","date","date"],["주행거리 (km)","mileage","number"],["비용 (원)","cost","number"],["정비소","shop","text"]].map(([label,key,type])=>(
        <div key={key} style={{marginBottom:12}}><FL T={T}>{label}</FL><FI T={T} type={type} value={form[key]} onChange={e=>set(key,e.target.value)} /></div>
      ))}
      <div style={{marginBottom:18}}><FL T={T}>메모</FL><FTA T={T} rows={2} value={form.note} onChange={e=>set("note",e.target.value)} /></div>
      <button style={{...btnPrimary,width:"100%",padding:"13px"}} onClick={()=>onSave(form)}>저장</button>
    </div>
  );
}

function FuelForm({ cars, selectedCar, onSave, T }) {
  const [form, setForm] = useState({ carId:selectedCar||cars[0]?.id, date:new Date().toISOString().split("T")[0], mileage:"", amount:"", cost:"", station:"" });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  return (
    <div>
      {cars.length>1 && <div style={{marginBottom:12}}><FL T={T}>차량 선택</FL><FS T={T} value={form.carId} onChange={e=>set("carId",e.target.value)}>{cars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</FS></div>}
      {[["날짜","date","date"],["주행거리 (km)","mileage","number"],["주유량 (L)","amount","number"],["금액 (원)","cost","number"],["주유소","station","text"]].map(([label,key,type])=>(
        <div key={key} style={{marginBottom:12}}><FL T={T}>{label}</FL><FI T={T} type={type} value={form[key]} onChange={e=>set(key,e.target.value)} /></div>
      ))}
      <button style={{...btnPrimary,width:"100%",padding:"13px"}} onClick={()=>onSave(form)}>저장</button>
    </div>
  );
}

function ReminderForm({ cars, selectedCar, onSave, T }) {
  const [form, setForm] = useState({ carId:selectedCar||cars[0]?.id, type:maintenanceTypes[0], dueDate:"", dueMileage:"", note:"" });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  return (
    <div>
      {cars.length>1 && <div style={{marginBottom:12}}><FL T={T}>차량 선택</FL><FS T={T} value={form.carId} onChange={e=>set("carId",e.target.value)}>{cars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</FS></div>}
      <div style={{marginBottom:12}}><FL T={T}>정비 유형</FL><FS T={T} value={form.type} onChange={e=>set("type",e.target.value)}>{maintenanceTypes.map(t=><option key={t}>{t}</option>)}</FS></div>
      <div style={{marginBottom:12}}><FL T={T}>예정 날짜</FL><FI T={T} type="date" value={form.dueDate} onChange={e=>set("dueDate",e.target.value)} /></div>
      <div style={{marginBottom:12}}><FL T={T}>예정 주행거리 (km)</FL><FI T={T} type="number" value={form.dueMileage} onChange={e=>set("dueMileage",e.target.value)} /></div>
      <div style={{marginBottom:18}}><FL T={T}>메모</FL><FTA T={T} rows={2} value={form.note} onChange={e=>set("note",e.target.value)} /></div>
      <button style={{...btnPrimary,width:"100%",padding:"13px"}} onClick={()=>onSave(form)}>저장</button>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────
export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const T = darkMode ? DARK : LIGHT;

  const [tab, setTab] = useState(0);
  const [cars, setCars] = useState([]);
  const [maintenances, setMaintenances] = useState([]);
  const [fuels, setFuels] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [selectedCar, setSelectedCar] = useState(null);
  const [showCarModal, setShowCarModal] = useState(false);
  const [editingCar, setEditingCar] = useState(null);
  const [showMaintModal, setShowMaintModal] = useState(false);
  const [showFuelModal, setShowFuelModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load from window.storage on mount
  useEffect(() => {
    async function load() {
      try {
        const c  = await window.storage.get("cars");        if (c)  setCars(JSON.parse(c.value));
        const m  = await window.storage.get("maintenances");if (m)  setMaintenances(JSON.parse(m.value));
        const f  = await window.storage.get("fuels");       if (f)  setFuels(JSON.parse(f.value));
        const r  = await window.storage.get("reminders");   if (r)  setReminders(JSON.parse(r.value));
        const dm = await window.storage.get("darkMode");    if (dm) setDarkMode(JSON.parse(dm.value));
      } catch {}
      setLoaded(true);
    }
    load();
  }, []);

  // Persist to window.storage whenever data changes
  useEffect(() => { if (loaded) window.storage.set("cars",         JSON.stringify(cars)); },         [cars, loaded]);
  useEffect(() => { if (loaded) window.storage.set("maintenances", JSON.stringify(maintenances)); }, [maintenances, loaded]);
  useEffect(() => { if (loaded) window.storage.set("fuels",        JSON.stringify(fuels)); },        [fuels, loaded]);
  useEffect(() => { if (loaded) window.storage.set("reminders",    JSON.stringify(reminders)); },    [reminders, loaded]);
  useEffect(() => { if (loaded) window.storage.set("darkMode",     JSON.stringify(darkMode)); },     [darkMode, loaded]);

  useEffect(() => { if (cars.length > 0 && !selectedCar) setSelectedCar(cars[0].id); }, [cars]);

  // Swipe
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const touchStartTime = useRef(null);
  const isHorizLocked = useRef(false);
  const anyModalOpen = showCarModal || !!editingCar || showMaintModal || showFuelModal || showReminderModal;

  const goToTab = useCallback((next) => {
    setDragX(0);
    if (next >= 0 && next < TABS.length) setTab(next);
  }, []);

  const onTouchStart = useCallback((e) => {
    if (anyModalOpen) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    isHorizLocked.current = false;
    setIsDragging(true);
  }, [anyModalOpen]);

  const onTouchMove = useCallback((e) => {
    if (touchStartX.current === null || anyModalOpen) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!isHorizLocked.current && Math.abs(dy) > Math.abs(dx) + 4) {
      touchStartX.current = null; setIsDragging(false); setDragX(0); return;
    }
    if (Math.abs(dx) > 8) isHorizLocked.current = true;
    if (isHorizLocked.current) setDragX(dx * 0.35);
  }, [anyModalOpen]);

  const onTouchEnd = useCallback((e) => {
    if (touchStartX.current === null) { setIsDragging(false); setDragX(0); return; }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dt = Date.now() - touchStartTime.current;
    setIsDragging(false); touchStartX.current = null;
    if (isHorizLocked.current && ((dt < 300 && Math.abs(dx) > 40) || Math.abs(dx) > 80)) {
      if (dx < 0 && tab < TABS.length - 1) { goToTab(tab + 1); return; }
      if (dx > 0 && tab > 0) { goToTab(tab - 1); return; }
    }
    setDragX(0);
  }, [anyModalOpen, tab, goToTab]);

  const activeCar = cars.find(c => c.id === selectedCar);
  const carMaints = maintenances.filter(m => m.carId === selectedCar);
  const carFuels = fuels.filter(f => f.carId === selectedCar);
  const carReminders = reminders.filter(r => r.carId === selectedCar);

  const card = { background:T.cardBg, border:`1px solid ${T.cardBorder}`, borderRadius:12 };
  const listItem = { background:T.listBg, border:`1px solid ${T.listBorder}`, borderRadius:10, padding:"14px 16px", marginBottom:8 };
  const secTitle = { fontSize:12, color:T.textMuted, textTransform:"uppercase", letterSpacing:2, fontWeight:600, marginBottom:14, paddingBottom:8, borderBottom:`1px solid ${T.border2}` };

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'Rajdhani','Noto Sans KR',sans-serif", color:T.text, transition:"background 0.3s,color 0.3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { overscroll-behavior-y: contain; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:${darkMode?"#111":"#eee"}; }
        ::-webkit-scrollbar-thumb { background:#ff6b00; border-radius:2px; }
        input,select,textarea { outline:none; }
        button { cursor:pointer; border:none; }
        .fade-in { animation:fadeIn 0.25s ease; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Header */}
      <div style={{ background:T.tabBar, borderBottom:`1px solid ${T.border}`, padding:"13px 18px", display:"flex", alignItems:"center", gap:12, position:"sticky", top:0, zIndex:50, transition:"background 0.3s" }}>
        <div style={{ width:32, height:32, background:"#ff6b00", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🚗</div>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"Rajdhani", fontSize:20, fontWeight:700, letterSpacing:1, color:T.headingColor }}>CARLOG</div>
          <div style={{ fontSize:10, color:T.textMuted, letterSpacing:2, textTransform:"uppercase" }}>차량 관리 시스템</div>
        </div>
        <button onClick={() => setDarkMode(p=>!p)}
          style={{ background:T.toggleBg, border:`1px solid ${T.border}`, borderRadius:20, padding:"6px 13px", display:"flex", alignItems:"center", gap:5, color:T.text, fontSize:12, fontFamily:"inherit", fontWeight:600, transition:"all 0.25s", flexShrink:0 }}>
          <span style={{ fontSize:14 }}>{darkMode?"☀️":"🌙"}</span>
          <span>{darkMode?"라이트":"다크"}</span>
        </button>
      </div>

      {/* Tab Bar */}
      <div style={{ background:T.tabBar, borderBottom:`1px solid ${T.border}`, padding:"6px 10px", display:"flex", gap:2, overflowX:"auto", transition:"background 0.3s" }}>
        {TABS.map((t,i) => (
          <button key={i} onClick={() => goToTab(i)}
            style={{ background:tab===i?"#ff6b00":"transparent", color:tab===i?"#fff":T.textSub, fontFamily:"inherit", fontSize:13, fontWeight:700, padding:"8px 14px", borderRadius:8, border:"none", cursor:"pointer", transition:"all 0.2s", letterSpacing:0.5, whiteSpace:"nowrap" }}>
            {t}
          </button>
        ))}
      </div>

      {/* Swipe Container */}
      <div style={{ overflow:"hidden", touchAction:"pan-y" }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div style={{ transform:`translateX(${dragX}px)`, transition:isDragging?"none":"transform 0.25s cubic-bezier(0.4,0,0.2,1)", willChange:"transform" }}>
          <div style={{ padding:"18px 16px", maxWidth:600, margin:"0 auto" }}>

            {tab === 0 && (
              <div className="fade-in">
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div style={secTitle}>등록된 차량 ({cars.length})</div>
                  <button style={btnPrimary} onClick={() => setShowCarModal(true)}>+ 차량 추가</button>
                </div>
                {cars.length === 0 ? <EmptyState icon="🚘" text="등록된 차량이 없습니다" sub="차량을 추가해 관리를 시작하세요" T={T} /> : (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
                    {cars.map(car => (
                      <div key={car.id} onClick={() => setSelectedCar(car.id)}
                        style={{ background:T.cardBg, borderRadius:14, padding:16, cursor:"pointer", border:`2px solid ${selectedCar===car.id?"#ff6b00":T.cardBorder}`, boxShadow:selectedCar===car.id?"0 0 20px rgba(255,107,0,0.16)":"none", position:"relative", overflow:"hidden", transition:"all 0.2s" }}>
                        {selectedCar===car.id && <div style={{ position:"absolute", top:10, right:10, width:8, height:8, background:"#ff6b00", borderRadius:"50%" }} />}
                        <div style={{ fontSize:32, marginBottom:8 }}>{car.emoji||"🚗"}</div>
                        <div style={{ fontWeight:700, fontSize:15, color:T.headingColor, marginBottom:2 }}>{car.name}</div>
                        <div style={{ fontSize:12, color:T.textSub }}>{car.plate}</div>
                        <div style={{ fontSize:11, color:T.textMuted, marginTop:4 }}>{car.year}년형</div>
                        <div style={{ marginTop:10, padding:"5px 10px", background:T.surface2, borderRadius:6, textAlign:"center" }}>
                          <span style={{ fontFamily:"Rajdhani", fontSize:15, fontWeight:700, color:"#ff6b00" }}>{formatNum(car.mileage)}</span>
                          <span style={{ fontSize:10, color:T.textMuted, marginLeft:3 }}>km</span>
                        </div>
                        <button onClick={e => { e.stopPropagation(); if(confirm("차량을 삭제하시겠습니까?")){ setCars(p=>p.filter(c=>c.id!==car.id)); if(selectedCar===car.id)setSelectedCar(null); } }}
                          style={{ position:"absolute", bottom:8, right:8, background:"transparent", color:T.deleteBtnColor, fontSize:13, border:"none", cursor:"pointer", padding:"2px 5px", borderRadius:4 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {activeCar && (<>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, paddingBottom:8, borderBottom:`1px solid ${T.border2}` }}>
                    <div style={{ fontSize:12, color:T.textMuted, textTransform:"uppercase", letterSpacing:2, fontWeight:600 }}>차량 정보 — {activeCar.name}</div>
                    <button onClick={() => setEditingCar(activeCar)}
                      style={{ background:"#ff6b0015", color:"#ff6b00", border:"1px solid #ff6b0040", fontFamily:"inherit", fontWeight:700, fontSize:12, borderRadius:8, padding:"6px 13px", cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                      ✏️ 수정
                    </button>
                  </div>
                  <div style={{ ...card, padding:20, marginBottom:14 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, textAlign:"center" }}>
                      {[["총 주행km",formatNum(activeCar.mileage)],["정비 횟수",carMaints.length],["주유 횟수",carFuels.length]].map(([label,val]) => (
                        <div key={label}>
                          <div style={{ fontFamily:"Rajdhani", fontSize:24, fontWeight:700, color:"#ff6b00", lineHeight:1 }}>{val}</div>
                          <div style={{ fontSize:10, color:T.textMuted, textTransform:"uppercase", letterSpacing:1, marginTop:4 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ ...card, padding:16 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                      {[["차량명",activeCar.name],["번호판",activeCar.plate],["연식",`${activeCar.year}년`],["연료",activeCar.fuel||"-"],["색상",activeCar.color||"-"],["보험만료",activeCar.insurance?formatDate(activeCar.insurance):"-"]].map(([label,val]) => (
                        <div key={label}>
                          <div style={{ fontSize:10, color:T.textMuted, letterSpacing:1, textTransform:"uppercase", marginBottom:3 }}>{label}</div>
                          <div style={{ fontSize:14, color:T.text }}>{val}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${T.border2}` }}>
                      <div style={{ fontSize:10, color:T.textMuted, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>현재 주행거리 업데이트</div>
                      <div style={{ display:"flex", gap:8 }}>
                        <input id="mileage-upd" type="number" defaultValue={activeCar.mileage}
                          style={{ flex:1, background:T.inputBg, border:`1px solid ${T.inputBorder}`, color:T.inputText, fontFamily:"inherit", fontSize:14, padding:"9px 13px", borderRadius:8, outline:"none" }} />
                        <button style={btnPrimary} onClick={() => { const v=document.getElementById("mileage-upd").value; setCars(p=>p.map(c=>c.id===activeCar.id?{...c,mileage:parseInt(v)||c.mileage}:c)); }}>저장</button>
                      </div>
                    </div>
                  </div>
                </>)}
              </div>
            )}

            {tab === 1 && (
              <div className="fade-in">
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div style={secTitle}>정비 기록</div>
                  <button style={btnPrimary} onClick={() => cars.length>0?setShowMaintModal(true):alert("먼저 차량을 등록해주세요.")}>+ 추가</button>
                </div>
                {cars.length>1 && <CarFilter cars={cars} selectedCar={selectedCar} setSelectedCar={setSelectedCar} />}
                {carMaints.length===0 ? <EmptyState icon="🔧" text="정비 기록이 없습니다" T={T} /> :
                  [...carMaints].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(m => (
                    <div key={m.id} style={listItem}>
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                            <span style={{ fontSize:15, fontWeight:700, color:T.text }}>{m.type}</span>
                            <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:4, background:"#ff6b0015", color:"#ff6b00", border:"1px solid #ff6b0030" }}>🔧</span>
                          </div>
                          <div style={{ fontSize:12, color:T.textMuted, marginBottom:5 }}>{formatDate(m.date)} · {formatNum(m.mileage)} km</div>
                          <div style={{ display:"flex", gap:14 }}>
                            <div><span style={{ fontSize:11, color:T.textMuted }}>비용 </span><span style={{ fontSize:14, fontWeight:600, color:"#ff6b00" }}>{formatNum(m.cost)}원</span></div>
                            {m.shop&&<div><span style={{ fontSize:11, color:T.textMuted }}>정비소 </span><span style={{ fontSize:13, color:T.textSub }}>{m.shop}</span></div>}
                          </div>
                          {m.note&&<div style={{ fontSize:12, color:T.textMuted, marginTop:5, fontStyle:"italic" }}>{m.note}</div>}
                        </div>
                        <button onClick={()=>setMaintenances(p=>p.filter(x=>x.id!==m.id))} style={{ background:"transparent", color:T.deleteBtnColor, fontSize:14, border:"none", cursor:"pointer", padding:"2px 5px", borderRadius:4 }}>✕</button>
                      </div>
                    </div>
                  ))
                }
                {carMaints.length>0 && (
                  <div style={{ ...card, padding:16, marginTop:14, textAlign:"center" }}>
                    <div style={{ fontSize:11, color:T.textMuted, marginBottom:4 }}>총 정비 비용</div>
                    <div style={{ fontFamily:"Rajdhani", fontSize:26, fontWeight:700, color:"#ff6b00" }}>{formatNum(carMaints.reduce((s,m)=>s+(parseInt(m.cost)||0),0))}원</div>
                  </div>
                )}
              </div>
            )}

            {tab === 2 && (
              <div className="fade-in">
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div style={secTitle}>주유 기록</div>
                  <button style={btnPrimary} onClick={() => cars.length>0?setShowFuelModal(true):alert("먼저 차량을 등록해주세요.")}>+ 추가</button>
                </div>
                {cars.length>1 && <CarFilter cars={cars} selectedCar={selectedCar} setSelectedCar={setSelectedCar} />}
                {carFuels.length>=2 && (() => {
                  const sorted=[...carFuels].sort((a,b)=>new Date(a.date)-new Date(b.date));
                  const totalL=carFuels.reduce((s,f)=>s+parseFloat(f.amount||0),0);
                  const totalCost=carFuels.reduce((s,f)=>s+(parseInt(f.cost)||0),0);
                  const km=(parseInt(sorted.at(-1)?.mileage)||0)-(parseInt(sorted[0]?.mileage)||0);
                  const usedL=sorted.slice(1).reduce((s,f)=>s+parseFloat(f.amount||0),0);
                  const eff=usedL>0?(km/usedL).toFixed(1):"-";
                  return (
                    <div style={{ ...card, padding:16, marginBottom:14 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, textAlign:"center" }}>
                        {[["총 주유(L)",totalL.toFixed(1)],["총 비용(원)",formatNum(totalCost)],["연비(km/L)",eff]].map(([label,val])=>(
                          <div key={label}>
                            <div style={{ fontFamily:"Rajdhani", fontSize:22, fontWeight:700, color:"#ff6b00", lineHeight:1 }}>{val}</div>
                            <div style={{ fontSize:10, color:T.textMuted, textTransform:"uppercase", letterSpacing:1, marginTop:4 }}>{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {carFuels.length===0 ? <EmptyState icon="⛽" text="주유 기록이 없습니다" T={T} /> :
                  [...carFuels].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(f => (
                    <div key={f.id} style={listItem}>
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        <div>
                          <div style={{ fontSize:12, color:T.textMuted, marginBottom:4 }}>{formatDate(f.date)} · {formatNum(f.mileage)} km</div>
                          <div style={{ display:"flex", gap:14, alignItems:"baseline" }}>
                            <div><span style={{ fontSize:11, color:T.textMuted }}>주유량 </span><span style={{ fontFamily:"Rajdhani", fontSize:18, fontWeight:700, color:"#ff6b00" }}>{f.amount}L</span></div>
                            <div><span style={{ fontSize:11, color:T.textMuted }}>금액 </span><span style={{ fontSize:14, fontWeight:600, color:T.text }}>{formatNum(f.cost)}원</span></div>
                            {f.amount&&f.cost&&<div><span style={{ fontSize:11, color:T.textMuted }}>단가 </span><span style={{ fontSize:12, color:T.textSub }}>{formatNum(Math.round(parseInt(f.cost)/parseFloat(f.amount)))}원/L</span></div>}
                          </div>
                          {f.station&&<div style={{ fontSize:12, color:T.textMuted, marginTop:4 }}>⛽ {f.station}</div>}
                        </div>
                        <button onClick={()=>setFuels(p=>p.filter(x=>x.id!==f.id))} style={{ background:"transparent", color:T.deleteBtnColor, fontSize:14, border:"none", cursor:"pointer", padding:"2px 5px", borderRadius:4 }}>✕</button>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}

            {tab === 3 && (
              <div className="fade-in">
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div style={secTitle}>정비 알림</div>
                  <button style={btnPrimary} onClick={() => cars.length>0?setShowReminderModal(true):alert("먼저 차량을 등록해주세요.")}>+ 추가</button>
                </div>
                {carReminders.length===0 ? <EmptyState icon="🔔" text="등록된 알림이 없습니다" sub="정기 점검 일정을 추가하세요" T={T} /> :
                  [...carReminders].sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).map(r => {
                    const isPast=new Date(r.dueDate)<new Date();
                    const isUrgent=!isPast&&new Date(r.dueDate)<=new Date(Date.now()+7*24*60*60*1000);
                    const bc=isPast?"#ff4444":isUrgent?"#ffaa00":"#44dd88";
                    return (
                      <div key={r.id} style={{ ...listItem, border:`1px solid ${isPast?"#ff444440":isUrgent?"#ffaa0030":T.listBorder}` }}>
                        <div style={{ display:"flex", justifyContent:"space-between" }}>
                          <div style={{ flex:1 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                              <span style={{ fontSize:15, fontWeight:700, color:T.text }}>{r.type}</span>
                              <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:4, color:bc, background:`${bc}12`, border:`1px solid ${bc}40` }}>
                                {isPast?"기한 초과":isUrgent?"임박":"정상"}
                              </span>
                            </div>
                            <div style={{ fontSize:12, color:T.textMuted }}>예정일: {formatDate(r.dueDate)}</div>
                            {r.dueMileage&&<div style={{ fontSize:12, color:T.textMuted }}>예정 거리: {formatNum(r.dueMileage)} km</div>}
                            {r.note&&<div style={{ fontSize:12, color:T.textMuted, marginTop:4, fontStyle:"italic" }}>{r.note}</div>}
                          </div>
                          <button onClick={()=>setReminders(p=>p.filter(x=>x.id!==r.id))} style={{ background:"transparent", color:T.deleteBtnColor, fontSize:14, border:"none", cursor:"pointer", padding:"2px 5px", borderRadius:4 }}>✕</button>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Dot indicators */}
      <div style={{ display:"flex", justifyContent:"center", gap:6, padding:"8px 0 24px" }}>
        {TABS.map((_,i) => (
          <div key={i} onClick={() => goToTab(i)} style={{ width:tab===i?22:6, height:6, borderRadius:3, cursor:"pointer", background:tab===i?"#ff6b00":T.dotInactive, transition:"all 0.25s cubic-bezier(0.4,0,0.2,1)" }} />
        ))}
      </div>

      {showCarModal && <CarModal T={T} onClose={() => setShowCarModal(false)} onSave={car => { setCars(p=>[...p,{...car,id:Date.now().toString()}]); setShowCarModal(false); }} />}
      {editingCar && <CarModal T={T} initialData={editingCar} onClose={() => setEditingCar(null)} onSave={updated => { setCars(p=>p.map(c=>c.id===editingCar.id?{...c,...updated}:c)); setEditingCar(null); }} />}
      {showMaintModal && <ModalShell T={T} title="정비 기록 추가" onClose={() => setShowMaintModal(false)}><MaintForm T={T} cars={cars} selectedCar={selectedCar} onSave={m => { setMaintenances(p=>[...p,{...m,id:Date.now().toString()}]); setShowMaintModal(false); }} /></ModalShell>}
      {showFuelModal && <ModalShell T={T} title="주유 기록 추가" onClose={() => setShowFuelModal(false)}><FuelForm T={T} cars={cars} selectedCar={selectedCar} onSave={f => { setFuels(p=>[...p,{...f,id:Date.now().toString()}]); setShowFuelModal(false); }} /></ModalShell>}
      {showReminderModal && <ModalShell T={T} title="정비 알림 추가" onClose={() => setShowReminderModal(false)}><ReminderForm T={T} cars={cars} selectedCar={selectedCar} onSave={r => { setReminders(p=>[...p,{...r,id:Date.now().toString()}]); setShowReminderModal(false); }} /></ModalShell>}
    </div>
  );
}
