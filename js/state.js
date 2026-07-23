// ╔══════════════════════════════════════════════════════════════╗
// ║  § 0  전역 상태 & 설정                                             ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

// ─── Firebase 설정 (하드코딩 — 워크스페이스 ID만 입력하면 됨) ───
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD9AaPcjjI842XYEz6Man4tgzZmcoFdSHE",
    authDomain: "test-b1713.firebaseapp.com",
    databaseURL: "https://test-b1713-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "test-b1713",
    storageBucket: "test-b1713.firebasestorage.app",
    messagingSenderId: "96408145171",
    appId: "1:96408145171:web:30a300ff2f7b735d929ee6",
    measurementId: "G-LXQ1XZMV02"
};

// ─── 사용설명서 URL (GitHub raw 주소 — 직접 수정하세요) ───
// 예: 'https://raw.githubusercontent.com/YOUR_ID/YOUR_REPO/main/manual.md'
const MANUAL_URL = 'https://raw.githubusercontent.com/pws72580491-creator/Delivery/main/manual.md';

// ─── 탭 순서 ───
const TAB_ORDER = ['dashboard','clients','unpaid','delivery','history','stock','settlement','backup','settings'];

// ─── 상태 ───
let clients    = _loadJSON('p_clients')   || _loadJSON('clients')   || [];
let orders     = (_loadJSON('p_orders') || _loadJSON('orders') || [])
    .map(o => {
        if (o._noItems) { delete o._noItems; }
        if (!Array.isArray(o.items)) o.items = [];
        else o.items = o.items.map(it => ({
            ...it,
            name: (it.name||'').trim(),
            total: it.total ?? (Number(it.qty)||0) * (Number(it.price)||0)  // ① it.total 복원
        }));
        return o;
    });
let prices     = _loadJSON('prices')      || {};

// 거래처 데이터 정규화 (외부 백업 호환)
clients = clients.map(c => {
    if (typeof c === 'string') return { id: _uid(), name: c, phone:'', address:'', note:'', createdAt: new Date().toISOString() };
    if (!c.id) c.id = _uid();
    c.id = String(c.id);                          // int id → string 타입 통일
    if (!c.note && c.memo) c.note = c.memo;       // 구버전 백업 호환 (memo → note)
    if (!c.note) c.note = '';
    // isHidden: 저장된 값 보존 (false면 목록에 표시, true면 숨겨짐)
    if (c.isHidden === undefined) c.isHidden = false;
    return c;
});

// 납품 데이터 정규화 (외부 백업 호환)
orders = orders.map(o => {
    if (!o.id) o.id = _uid();
    o.id = String(o.id);                           // int id → string 타입 통일 (clients와 동일)
    if (!o.clientName && o.client) o.clientName = o.client;
    if (o.clientId !== undefined) o.clientId = String(o.clientId); // int→string 타입 통일
    if (!o.clientId) {
        const found = clients.find(c => c.name === o.clientName);
        o.clientId = found ? found.id : '';
    } else {
        // clientId가 있으면 현재 거래처 이름과 다를 경우 자동 보정 (거래처명 변경 후 미반영 복구)
        const linked = clients.find(c => c.id === o.clientId);
        if (linked && linked.name !== o.clientName) {
            o.clientName = linked.name;
        }
    }
    o.total = Number(o.total ?? o.totalAmount ?? 0);
    if (!o.note && o.memo) o.note = o.memo;       // 구버전 백업 호환 (memo → note)
    if (!o.note) o.note = '';
    if (!o.isVoid) o.isVoid = false;              // isVoid 복원 (없으면 false)
    return o;
});

let tempGroups = [];
let editingClientId = null;

// ─── 재고 ───
let stockItems     = (_loadJSON('p_stock') || []).map(si => si ? {
    id: si.id || _uid(), name: (si.name || '').trim(), qty: Number(si.qty ?? 0),
    unit: si.unit || '개', low: Number(si.low ?? 10), danger: Number(si.danger ?? 3),
    note: si.note || '', log: Array.isArray(si.log) ? si.log : [],
    updatedAt: si.updatedAt || new Date().toISOString()
} : null).filter(Boolean);
let stockSortMode  = 'name';
// 최초 실행(null) 또는 '1'이면 ON — 기본값 ON
let stockAutoDeduct = localStorage.getItem('stockAutoDeduct') !== '0';
let _adjType = 'in';

// ─── 성능 캐시 ───
// orders가 바뀔 때마다 invalidateOrdersCache()로 무효화
let _itemNamesCache    = null;  // 전체 품목명 Set → 정렬 배열
let _clientItemsCache  = null;  // clientId → [{name,price,date}]
let _clientStatsCache  = null;  // clientId/name → {count,total,unpaid,lastDate}
let _recentPricesCache = null;  // 품목명 → 최근 단가 배열 (getRecentPrices 캐시)

// ╔══════════════════════════════════════════════════════════════╗
// ║  § 1  유틸리티                                                   ║
// ╚══════════════════════════════════════════════════════════════╝

function _loadJSON(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch(e) { return null; }
}

function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

function todayKST() {
    // 항상 UTC+9(KST) 기준 날짜 반환 — 기기 시간대와 무관하게 정확
    const d = new Date();
    return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 재고 이력을 어제·오늘(이틀)만 보관하고 그 이전 이력 삭제
// — 재고 이월 계산은 어제 기준이므로 이틀이면 충분
function _trimLogByDate(log) {
    if (!Array.isArray(log)) return [];
    const yesterday = kstAddDays(todayKST(), -1);  // 어제 ~ 오늘만 유지
    return log.filter(l => {
        const d = l.date || (l.at ? l.at.slice(0, 10) : null);
        return d && d >= yesterday;
    });
}

// KST 기준 현재 날짜+시각 반환
// dateStr: 'YYYY-MM-DD HH:MM' (화면 표시용)
// key:     'YYYY-MM-DDTHH-MM-SS' (Firebase 정렬키용, 특수문자 제거)

function nowKST() {
    const kstIso = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
    const dateStr = kstIso.slice(0, 16).replace('T', ' ');   // 'YYYY-MM-DD HH:MM'
    const key     = kstIso.slice(0, 19).replace(/[:.]/g, '-'); // 'YYYY-MM-DDTHH-MM-SS'
    return { dateStr, key };
}

// KST 날짜 문자열(YYYY-MM-DD)에 days를 더해 새 날짜 문자열 반환

function kstAddDays(dateStr, days) {
    // +09:00으로 파싱하면 UTC로 변환되므로, 다시 +9h 오프셋을 더해 KST 날짜 추출
    const utcMs = Date.parse(dateStr + 'T00:00:00+09:00') + days * 86400000;
    return new Date(utcMs + 9 * 3600000).toISOString().slice(0, 10);
}

// KST 기준으로 n개월 전 날짜 문자열 반환 (new Date() UTC 오프셋 버그 방지)
function _kstMonthsAgo(n) {
    let [y, m, d] = todayKST().split('-').map(Number);
    m -= n;
    while (m <= 0) { m += 12; y--; }
    const maxDay = new Date(y, m, 0).getDate();
    d = Math.min(d, maxDay);
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function fmt(n) {
    const v = Number(n);
    return isNaN(v) ? '0' : v.toLocaleString('ko-KR');
}

// 전표의 실제 수령액 반환 (할인 완납 시 paidAmount = 실수령액, total - discount)
// 완납이어도 할인이 있으면 paidAmount를 우선 사용
function _actualPaid(o) {
    if (!o.isPaid) return Math.min(o.total, o.paidAmount || 0);
    // 할인 완납: paidAmount = 실수령액 (total보다 작음)
    if (o.discount > 0 && o.paidAmount != null) return o.paidAmount;
    return o.total;
}

// 안정적 hash: 객체 키 삽입 순서에 무관하게 동일한 결과 보장
function dataHash(v) {
    return JSON.stringify(v, (_, val) =>
        (val && typeof val === 'object' && !Array.isArray(val))
            ? Object.keys(val).sort().reduce((acc, k) => { acc[k] = val[k]; return acc; }, {})
            : val
    );
}

function toArray(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return Object.values(v);
}

function debounce(fn, ms) {
    let t;
    const f = (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a), ms); };
    f.cancel = () => { clearTimeout(t); t = null; };
    return f;
}

// ★ v106 fix: Firebase Promise 타임아웃 래퍼
// 백그라운드 복귀 직후 소켓이 죽어있는 상태에서 .once()/.update() 호출 시
// 응답이 영원히 오지 않아 Promise가 멈추는 경우가 있음 → 일정 시간 후 강제로 reject
function _withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`[timeout] ${label || 'firebase op'} (${ms}ms)`));
        }, ms);
        promise.then(
            v => { clearTimeout(timer); resolve(v); },
            e => { clearTimeout(timer); reject(e); }
        );
    });
}

// ★ v108: 동기화 진단 로그
// 백그라운드 복귀 후 동기화 오류 등이 발생하는 원인을 사용자가 직접 들여다볼 수 있도록
// 핵심 동기화 이벤트(연결 상태 전환, 가드 설정/해제, 타임아웃 등)를 시각과 함께 남김.
// 개인정보(거래처명·금액 등)는 절대 기록하지 않고 상태 전환 이벤트만 기록.
const _DIAG_LOG_KEY = 'syncDiagLog';
const _DIAG_LOG_MAX = 300;
let _diagLog = [];
(function _loadDiagLog() {
    try {
        const raw = localStorage.getItem(_DIAG_LOG_KEY);
        if (raw) _diagLog = JSON.parse(raw) || [];
    } catch (e) { _diagLog = []; }
})();
let _diagLogSaveTimer = null;
function _diagLogPersist() {
    clearTimeout(_diagLogSaveTimer);
    _diagLogSaveTimer = setTimeout(() => {
        try { localStorage.setItem(_DIAG_LOG_KEY, JSON.stringify(_diagLog)); } catch (e) { /* 용량 초과 시 무시 */ }
    }, 500);
}
function diagLog(event, detail) {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2,'0');
    const mm = String(t.getMinutes()).padStart(2,'0');
    const ss = String(t.getSeconds()).padStart(2,'0');
    _diagLog.push({ t: `${t.getMonth()+1}/${t.getDate()} ${hh}:${mm}:${ss}`, event, detail: detail || '' });
    if (_diagLog.length > _DIAG_LOG_MAX) _diagLog.splice(0, _diagLog.length - _DIAG_LOG_MAX);
    _diagLogPersist();
}
function diagLogText() {
    if (!_diagLog.length) return '(기록된 로그가 없습니다)';
    return _diagLog.map(l => `[${l.t}] ${l.event}${l.detail ? ' — ' + l.detail : ''}`).join('\n');
}
function diagLogClear() {
    _diagLog = [];
    try { localStorage.removeItem(_DIAG_LOG_KEY); } catch(e) {}
}

// ─── HTML 이스케이프 (XSS 방지) ───

function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
}

// onclick 속성 내 작은따옴표+큰따옴표 이스케이프

function escapeAttr(str) {
    return String(str||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
}

// 메모 중요도(1=낮음 2=보통 3=높음) — class 속성에 그대로 꽂아 넣는 값이라
// 손상되거나 조작된 백업 데이터가 들어와도 1/2/3 외의 값은 절대 통과시키지 않음
function memoPriorityLevel(o) {
    const p = Number(o && o.notePriority);
    return (p === 1 || p === 3) ? p : 2;
}

// ★ v130 fix: 결제/미수복귀 처리 후 renderOrders·renderDashboard·... ·showClientStatement를
// 한 줄에 순서대로 그냥 호출하던 곳이 13군데 있었는데, 그 중 아무거나 하나라도 예외를 던지면
// 그 뒤에 나오는 함수(특히 현재 열려있는 명세표 갱신)는 아예 실행조차 안 됨 — 데이터는
// 이미 바뀌었는데 화면만 안 바뀐 것처럼 보이는 원인이 됨. 하나씩 독립적으로 실행해서
// 하나가 실패해도 나머지는 계속 갱신되도록 보장.
function _safeRefresh(...fns) {
    fns.forEach(fn => {
        try { fn(); } catch (e) { console.error('[화면 갱신 실패]', fn && fn.name || '(익명)', e); }
    });
}

// 초성 검색
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function extractChosung(str) {
    return [...str].map(c => {
        const code = c.charCodeAt(0) - 44032;
        return code>=0 && code<11172 ? CHO[Math.floor(code/588)] : c;
    }).join('');
}

function matchSearch(target, q) {
    if (!q) return true;
    const t = target.toLowerCase(), query = q.toLowerCase();
    // 일반 문자열 포함 검색
    if (t.includes(query)) return true;
    // 초성 검색: 쿼리가 순수 자음(초성)으로만 이루어진 경우에만 적용
    // 예) 'ㅂㄹ' → 초성 검색 O / '벨렘' → 일반 검색만 O (초성 혼합 방지)
    const isChoOnly = /^[ㄱ-ㅎ]+$/.test(q);
    if (isChoOnly) {
        const tCho = extractChosung(target);
        if (tCho.includes(q)) return true;
    }
    return false;
}

// ─── 함수 래퍼 (monkey-patch 안전화) ───
// fn이 존재하는 함수일 때만 래핑 → 정의 순서 무관하게 안전
function _safeWrap(fn, extra) {
    if (typeof fn !== 'function') { console.warn('_safeWrap: 대상 함수를 찾을 수 없습니다'); return fn || (() => {}); }
    return function(...args) { const r = fn.apply(this, args); extra.apply(this, args); return r; };
}

// ─── 커스텀 confirm 다이얼로그 (Promise 기반) ───
// 사용법: if (!await customConfirm('삭제할까요?')) return;
// okLabel: 확인 버튼 텍스트 / okClass: 버튼 CSS 클래스 (btn-danger|btn-primary)
function customConfirm(msg, okLabel = '확인', okClass = 'btn-danger') {
    return new Promise(resolve => {
        const modal     = document.getElementById('customConfirmModal');
        const msgEl     = document.getElementById('customConfirmMsg');
        const okBtn     = document.getElementById('customConfirmOkBtn');
        const cancelBtn = document.getElementById('customConfirmCancelBtn');
        if (!modal) { resolve(window.confirm(msg)); return; } // fallback
        msgEl.textContent = msg;
        okBtn.textContent = okLabel;
        okBtn.className   = `btn ${okClass}`;
        okBtn.style.flex  = '2';
        const cleanup = (val) => { closeModal('customConfirmModal'); resolve(val); };
        okBtn.onclick     = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        openModal('customConfirmModal');
    });
}

// ─── 로컬 저장 (스마트 모드) ───
// Firebase 연결 중이거나 워크스페이스 ID가 설정된 경우: 경량 저장 (용량 최소화)
// 순수 오프라인(워크스페이스 ID 없음): 전체 저장
// Firebase 업로드(debouncedSync)는 항상 전체 데이터 사용 (별도 경로)

// ╔══════════════════════════════════════════════════════════════╗
// ║  § 2  성능 캐시 빌드                                               ║
// ╚══════════════════════════════════════════════════════════════╝

function invalidateOrdersCache() {
    _itemNamesCache    = null;
    _clientItemsCache  = null;
    _clientStatsCache  = null;
    _recentPricesCache = null;
}

// ★ fix: sync.js removeSharedWs에서 호출 — clients 캐시만 선택 무효화
function invalidateClientsCache() {
    _clientStatsCache = null;
    _clientItemsCache = null;
}

function _buildClientStatsCache() {
    if (_clientStatsCache) return _clientStatsCache;
    const m = {};
    for (const o of orders) {
        const key = o.clientId || o.clientName;
        if (!m[key]) m[key] = { count:0, total:0, unpaid:0, lastDate:'' };
        m[key].count++;
        // ★ v123 fix: 할인 완납 전표는 실청구액(total-discount)으로 집계 — 원래 raw total을 그대로 더해
        // 거래처 카드의 "총 매출" 표시가 할인분만큼 부풀려 보이던 문제 (settlement.js 미수 집계 버그와 동일 원인)
        m[key].total += (o.isPaid && o.discount > 0) ? (o.total - o.discount) : o.total;
        if (!o.isPaid) m[key].unpaid += Math.max(0, (o.total - (o.paidAmount||0)));
        if (o.date > m[key].lastDate) m[key].lastDate = o.date;
    }
    _clientStatsCache = m;
    return m;
}

function _buildItemNamesCache() {
    if (_itemNamesCache) return _itemNamesCache;
    const all = new Set();
    for (const o of orders) for (const it of (o.items||[])) if (it.name) all.add(it.name);
    _itemNamesCache = [...all].sort();
    return _itemNamesCache;
}

function _buildClientItemsCache() {
    if (_clientItemsCache) return _clientItemsCache;
    // clientId → 날짜 내림차순으로 품목명 첫 등장만 수집
    // clientId 없는 전표는 clientName을 fallback 키로 사용
    const tmp = {}; // key → [{name,price,date}]
    const sorted = [...orders].sort((a,b) => (b.date||"").localeCompare(a.date||""));
    for (const o of sorted) {
        const cid = o.clientId || ('name:' + (o.clientName || ''));
        if (!cid) continue;
        if (!tmp[cid]) tmp[cid] = { seen:{}, list:[] };
        for (const it of (o.items||[])) {
            if (!tmp[cid].seen[it.name]) {
                tmp[cid].seen[it.name] = true;
                tmp[cid].list.push({ name:it.name, price:it.price, date:o.date });
            }
        }
    }
    _clientItemsCache = {};
    // ★ v124 fix: 거래처당 10개로 캐시가 잘려있어, 품목 종류가 10개를 넘는 거래처는
    // 11번째 이후 품목이 "최근 품목" 칩과 "이 거래처 최근 단가" 자동완성 둘 다에서 영구히 안 보였음.
    // → 30개로 상향 (cis-chips는 flex-wrap이라 늘어나도 레이아웃 안전, 잘림 없음)
    for (const cid in tmp) _clientItemsCache[cid] = tmp[cid].list.slice(0, 30);
    return _clientItemsCache;
}

let histPayFilter = 'all';
let histSortMode  = 'date'; // 'date' | 'client' | 'recent'
let settleFilter  = 'all';
let settleListVisible = false;  // 기본값 숨기기
let settleUnit = 'monthly'; // 'monthly' | 'daily' | 'quarterly'
let clientListVisible = false;  // 기본값 숨기기 (복구/동기화 후 즉시 반영)
let showHiddenClients = false; // 숨긴 거래처 포함 표시 여부


// Firebase
let workspaceRef = null;
let isConnected  = false;
// ★ v120: 리스너 중복 등록 방지 — 핸들러 참조 보관
let _connectedRef     = null;  // .info/connected ref
let _connectedHandler = null;  // .info/connected 핸들러
let _workspaceHandler = null;  // workspaceRef value 핸들러
let _initialLoadDone = false;  // 전역 선언 — _fbValueHandler에서 접근 가능
const SESSION_ID = Math.random().toString(36).slice(2);
let lastHash = { clients:'', orders:'', prices:'', stock:'' };

// ─── Delta sync 트래킹 ───
// 변경된 order id만 추적 → debouncedSync에서 건별 업로드 (payload 최소화)
const _dirtyOrders   = new Set(); // 변경/추가된 order id
const _deletedOrders = new Set(); // 삭제된 order id
function _markDirtyOrder(id) {
    _dirtyOrders.add(String(id));
    _deletedOrders.delete(String(id));
    // ★ 수정 전표 updatedAt 자동 갱신 (Firebase 충돌 판단 기준)
    const o = orders.find(x => String(x.id) === String(id));
    if (o && !o._skipUpdatedAt) o.updatedAt = new Date().toISOString();
}
function _markDeletedOrder(id) { _deletedOrders.add(String(id)); _dirtyOrders.delete(String(id)); }
function _clearOrderDelta()    { _dirtyOrders.clear(); _deletedOrders.clear(); }

// ─── 동기화 가드 플래그 ───
// _syncGuard: debouncedSync 업로드가 진행 중일 때 true
//   → 리스너가 업로드 응답 echo를 받아 로컬 데이터를 덮어쓰는 것을 차단
let _syncGuard = false;
let _syncGuardSetAt = 0;     // ★ v106 fix: _syncGuard=true로 전환된 시각 (워치독이 박제 감지에 사용)
let _intentionalDisconnect = false; // ★ v110: _refreshSocket()의 의도된 goOffline 여부 (오류 표시 오인 방지)
let _pendingFbSnap = null;   // _syncGuard 중 도착한 타기기 변경 스냅샷 (처리 보류)
let _rtPollTimer   = null;   // 실시간 폴링 백업 타이머
// _connectGuard: _doConnect의 초기 .get() 처리가 완료되기 전 true
//   → .on() 리스너가 먼저 실행되는 레이스 컨디션 방지
let _connectGuard = false;

// ─── Firebase 데이터 정규화 헬퍼 ───
// Firebase에서 받은 raw 데이터를 앱 내부 포맷으로 변환 (4곳 공통 사용)
function _normClientFromFb(c) {
    if (!c.id) c.id = _uid();
    c.id = String(c.id);
    if (!c.note && c.memo) c.note = c.memo; // 구버전 백업 호환
    if (!c.note) c.note = '';
    if (c.isHidden === undefined) c.isHidden = false;
    return c;
}
function _normOrderFromFb(o) {
    if (!o.id) o.id = _uid();
    o.id = String(o.id);
    o.total = Number(o.total ?? o.totalAmount ?? 0);
    if (!o.clientName && o.client) o.clientName = o.client;
    if (!Array.isArray(o.items)) o.items = [];
    if (!o.note && o.memo) o.note = o.memo; // 구버전 백업 호환
    if (!o.note) o.note = '';
    // isVoid: Firebase에서 undefined로 오면 명시적으로 false 처리
    if (!o.isVoid) o.isVoid = false;
    // date: undefined이면 startsWith() 호출 시 TypeError 방지
    if (!o.date) o.date = '';
    // ★ CRM 우선권: crmControlled 플래그 유지
    if (o.crmControlled) o.crmControlled = true;
    return o;
}

// ─── Firebase 실시간 리스너 핸들러 (workspaceRef.on('value', ...) 공용) ───
function _fbValueHandler(snap) {
    try {
        const d = snap.val();
        if (!d) return;
        if (!_initialLoadDone) return;  // 초기 .get() 처리 전 차단
        if (_connectGuard)     return;  // 초기 연결 중 레이스 컨디션 차단
        if (d.writtenBy === SESSION_ID) return; // 자기 자신이 올린 echo 차단

        // ★ version 기반 충돌 감지: 서버 version이 로컬보다 낮으면 stale 수신 무시
        // 단, CRM/공유납품 경로의 writtenBy가 있는 경우 version 체크 완전 우회
        // → 이들은 자체 우선권 로직(CRM_EXTERNAL, __shared_by__)으로 처리됨
        const _isCrmOrShared = typeof d.writtenBy === 'string' &&
            (d.writtenBy === 'CRM_EXTERNAL' || d.writtenBy.startsWith('__shared_by__:'));
        if (d.version && !_isCrmOrShared) {
            const localVer = parseInt(localStorage.getItem('ws_version') || '0', 10);
            if (d.version < localVer) {
                console.info('[충돌감지] 서버 version이 로컬보다 낮음 — 수신 무시',
                    'server:', d.version, 'local:', localVer);
                return;
            }
            // 수신 성공 시 로컬 version 갱신
            localStorage.setItem('ws_version', String(d.version));
        }

        // ★ v96: B가 공유 납품 저장 시 writtenBy = "__shared_by__:{B의 SESSION_ID}"
        // → A 화면에서 즉시 orders만 갱신 (타임스탬프 비교 우회)
        // ★ v99 fix: 전체 교체 대신 개별 order merge — 다기기 동시 작업 시 내 데이터 보호
        if (typeof d.writtenBy === 'string' && d.writtenBy.startsWith('__shared_by__:')) {
            if (d.orders) {
                const incoming = toArray(d.orders).map(_normOrderFromFb);
                // 서버에서 온 orders map 기준으로 기존 orders를 개별 merge
                const serverMap = {};
                incoming.forEach(o => { serverMap[o.id] = o; });
                let changed = false;
                // 1) 서버에 있는 항목: 추가 or 갱신
                incoming.forEach(o => {
                    const idx = orders.findIndex(x => x.id === o.id);
                    if (idx < 0) {
                        orders.push(o);
                        changed = true;
                    } else if (dataHash(orders[idx]) !== dataHash(o)) {
                        orders[idx] = o;
                        changed = true;
                    }
                });
                // 2) 로컬에는 있지만 서버 스냅샷에 없는 항목은 건드리지 않음
                //    (공유 납품 writtenBy이므로 내 로컬 전표 삭제 위험 차단)
                if (changed) {
                    lastHash.orders = dataHash(orders);
                    saveToLocal();
                    _fullRender();
                    setSyncStatus('online');
                    toast('📦 공유 납품이 등록됐습니다', 'var(--accent)', 2500);
                }
            }
            return;
        }

        // ★ CRM 외부에서 결제 패치한 경우: 타임스탬프 비교 우회 + orders만 즉시 갱신
        // ★ v99 fix: 전체 교체 대신 개별 order merge — 내 로컬 전표 보호
        if (d.writtenBy === 'CRM_EXTERNAL') {
            if (d.orders) {
                const incoming = toArray(d.orders).map(_normOrderFromFb);
                let changed = false;
                incoming.forEach(o => {
                    const idx = orders.findIndex(x => x.id === o.id);
                    if (idx < 0) {
                        orders.push(o);
                        changed = true;
                    } else if (dataHash(orders[idx]) !== dataHash(o)) {
                        orders[idx] = o;
                        changed = true;
                    }
                });
                if (changed) {
                    lastHash.orders = dataHash(orders);
                    saveToLocal();
                    _fullRender();
                    setSyncStatus('online');
                    toast('💳 CRM에서 결제 처리됨 — 화면이 업데이트됐습니다', 'var(--green)', 3000);
                }
            }
            return;
        }

        // ★ _syncGuard 중 도착한 타기기 변경 → 버리지 않고 보류, 업로드 완료 후 처리
        if (_syncGuard) { _pendingFbSnap = snap; return; }

        // ★ writtenBy가 명시된 경우(현행 앱): 다른 세션이면 무조건 수락
        //   writtenBy 없는 구버전 데이터만 timestamp 비교로 stale 여부 판단
        //   (이 체크를 제거하지 않으면 기기 간 시계 오차로 결제 변경이 차단됨)
        if (!d.writtenBy) {
            const serverUpdatedAt = d.lastUpdated ? new Date(d.lastUpdated).getTime() : 0;
            const lastLocalMs = (() => {
                const s = localStorage.getItem('lastLocalUpdated');
                return s ? new Date(s).getTime() : 0;
            })();
            const localWriteMs = Math.max(_localWriteTime, lastLocalMs);
            const RECENT_WINDOW_MS = 8_000;
            if (localWriteMs > 0 && localWriteMs >= serverUpdatedAt &&
                (Date.now() - localWriteMs) < RECENT_WINDOW_MS) return;
        }

        let changed = false;
        if (d.clients) {
            const inc = toArray(d.clients).map(_normClientFromFb);
            const h = dataHash(inc);
            if (h !== lastHash.clients) { clients = inc; lastHash.clients = h; changed = true; }
        }
        if (d.orders) {
            const inc = toArray(d.orders).map(_normOrderFromFb);
            const h = dataHash(inc);
            if (h !== lastHash.orders) { orders = inc; lastHash.orders = h; changed = true; }
        }
        if (d.prices) {
            const h = dataHash(d.prices);
            if (h !== lastHash.prices) { prices = d.prices; lastHash.prices = h; }
        }
        if (d.stockItems) {
            const inc = toArray(d.stockItems).map(normStock);
            const h = dataHash(inc);
            if (h !== lastHash.stock) { stockItems = inc; lastHash.stock = h; changed = true; }
        }
        if (changed) {
            saveToLocal();
            _fullRender();
            setSyncStatus('online');
            toast('🔄 다른 기기에서 변경된 내용이 반영됐습니다', 'var(--accent)', 2500);
        }
    } catch(e) {
        console.error('[_fbValueHandler] 처리 중 오류:', e);
        // 오류가 발생해도 리스너는 유지됨 — 다음 이벤트에서 재시도
    }
}
let _localWriteTime = 0; // 로컬 변경 시각 — Firebase 리스너 경쟁 방지용
let backupDirHandle = null;  // File System Access API 디렉토리 핸들

