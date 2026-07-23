// ╔══════════════════════════════════════════════════════════════╗
// ║  § 14  Firebase 온라인 동기화  ⚠️ 절대 수정 금지                          ║
// ║  온라인 동기화 코드는 원본과 100% 동일합니다                                  ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── 공유 납품 오프라인 큐 (v96 이식, v114 개선) ─────────────────────────────
const _SHARED_QUEUE_KEY      = '_sharedOrderQueue';
const _SHARED_DEAD_QUEUE_KEY = '_sharedOrderDeadQueue'; // ★ v114: 폐기 대신 별도 보관

function _getSharedOrderQueue() {
    try { return JSON.parse(localStorage.getItem(_SHARED_QUEUE_KEY) || '[]'); } catch { return []; }
}
function _saveSharedOrderQueue(queue) {
    try { localStorage.setItem(_SHARED_QUEUE_KEY, JSON.stringify(queue)); } catch(e) {}
}
function _getDeadQueue() {
    try { return JSON.parse(localStorage.getItem(_SHARED_DEAD_QUEUE_KEY) || '[]'); } catch { return []; }
}
function _saveDeadQueue(dead) {
    try { localStorage.setItem(_SHARED_DEAD_QUEUE_KEY, JSON.stringify(dead)); } catch(e) {}
}

/** 오프라인 시 공유 납품을 큐에 저장 (★ v114: order.id 기준 중복 방지) */
function _enqueueSharedOrder(wsId, ordersToQueue) {
    const queue = _getSharedOrderQueue();
    ordersToQueue.forEach(order => {
        // ★ v114: 이미 같은 order.id가 큐에 있으면 덮어쓰기 (중복 방지)
        const existIdx = queue.findIndex(item => item.order && item.order.id === order.id && item.wsId === wsId);
        const entry = {
            wsId,
            order,
            queuedAt:   new Date().toISOString(),
            failCount:  0,
            retryAfter: null,
        };
        if (existIdx >= 0) {
            queue[existIdx] = entry; // 덮어쓰기
        } else {
            queue.push(entry);
        }
    });
    _saveSharedOrderQueue(queue);
    _updateSharedQueueBadge();
}

// ★ v114: 재시도 횟수 제한 제거 — 실패 항목은 dead 큐로 이동 후 사용자가 직접 재시도
const _QUEUE_MAX_RETRIES = 5;          // 자동 재시도 최대 횟수 (초과 시 dead 큐로)
const _QUEUE_RETRY_DELAYS = [5000, 15000, 60000, 300000, 600000]; // 5회 백오프

/** Firebase 재연결 시 오프라인 큐 일괄 업로드 */
async function _flushSharedOrderQueue() {
    const queue = _getSharedOrderQueue();
    if (!queue.length) return;
    if (typeof firebase === 'undefined' || !firebase.apps.length) return;

    const now    = Date.now();
    const db     = firebase.database();
    const failed = [];
    let successCnt = 0;

    for (const item of queue) {
        // retryAfter 미도래 항목은 이번 플러시에서 건너뜀
        if (item.retryAfter && new Date(item.retryAfter).getTime() > now) {
            failed.push(item);
            continue;
        }
        try {
            if (item._delete) {
                await db.ref(`workspaces/${item.wsId}/orders/${item.orderId}`).remove();
                const ci = _sharedOrdersCache.findIndex(o => o.id === item.orderId);
                if (ci >= 0) _sharedOrdersCache.splice(ci, 1);
            } else {
                await db.ref(`workspaces/${item.wsId}/orders/${item.order.id}`).set(item.order);
                const already = _sharedOrdersCache.find(o => o.id === item.order.id);
                if (!already) {
                    const wsItem = _getSharedWs().find(w => w.wsId === item.wsId);
                    _sharedOrdersCache.push({
                        ...item.order,
                        _sharedWsId:    item.wsId,
                        _sharedWsLabel: wsItem?.label || item.wsId,
                        _readOnly:      false,
                        _mySharedEntry: true,
                    });
                } else {
                    Object.assign(already, item.order);
                }
            }
            successCnt++;
        } catch(e) {
            const fc = (item.failCount || 0) + 1;
            if (fc >= _QUEUE_MAX_RETRIES) {
                // ★ v114: 폐기 대신 dead 큐에 보관 → 사용자가 직접 재시도 가능
                const dead = _getDeadQueue();
                // ★ v114: _delete 항목은 item.order가 없으므로 item.orderId로도 비교
                const itemKey = item.order?.id || item.orderId || null;
                const deadIdx = itemKey
                    ? dead.findIndex(d => (d.order?.id || d.orderId) === itemKey && d.wsId === item.wsId)
                    : -1;
                const deadEntry = { ...item, failCount: fc, lastError: e.message || String(e), deadAt: new Date().toISOString() };
                if (deadIdx >= 0) dead[deadIdx] = deadEntry;
                else dead.push(deadEntry);
                _saveDeadQueue(dead);
                console.warn(`[공유큐] ${fc}회 실패 → dead 큐로 이동:`, itemKey);
            } else {
                const delayMs  = _QUEUE_RETRY_DELAYS[fc - 1] || 300000;
                failed.push({
                    ...item,
                    failCount:  fc,
                    retryAfter: new Date(now + delayMs).toISOString(),
                    lastError:  e.message || String(e),
                });
            }
        }
    }

    _saveSharedOrderQueue(failed);

    if (successCnt > 0) {
        _safeRefresh(renderOrders, updateInfoCounts, updateNavBadges, renderDashboard, () => toast(`📤 오프라인 중 작성한 공유 납품 ${successCnt}건이 업로드되었습니다`, 'var(--green)', 4000));
    }
    const deadAfter = _getDeadQueue();
    if (deadAfter.length > 0) {
        _updateDeadQueueBadge();
    }
    if (failed.length > 0) {
        const retrying = failed.filter(f => f.retryAfter);
        console.warn(`[공유큐] ${retrying.length}건 대기 중 — 다음 연결 시 재시도`);
    }
    _updateSharedQueueBadge();
}

/** 오프라인 큐 배지 UI 갱신 */
function _updateSharedQueueBadge() {
    const el = document.getElementById('sharedQueueBadge');
    if (!el) return;
    const q = _getSharedOrderQueue();
    if (q.length > 0) {
        el.textContent = `📤 공유 납품 ${q.length}건 대기 중 — 탭하여 재시도`;
        el.style.display = '';
    } else {
        el.style.display = 'none';
    }
}

/** ★ v114: 폐기 큐(dead) 배지 UI 갱신 */
function _updateDeadQueueBadge() {
    const el = document.getElementById('sharedDeadBadge');
    if (!el) return;
    const dead = _getDeadQueue();
    if (dead.length > 0) {
        el.textContent = `⚠️ 업로드 실패 ${dead.length}건 — 탭하여 확인`;
        el.style.display = '';
    } else {
        el.style.display = 'none';
    }
}

/** ★ v114: dead 큐 확인 모달 표시 */
function showDeadQueueModal() {
    const dead = _getDeadQueue();
    const listEl = document.getElementById('deadQueueList');
    if (!listEl) return;
    if (!dead.length) {
        toast('✅ 실패한 항목이 없습니다', 'var(--green)');
        return;
    }
    listEl.innerHTML = dead.map(item => {
        const o = item.order || {};
        const isDelete = !!item._delete;
        const dateStr  = (o.date || item.queuedAt || '').slice(0, 10);
        const clientNm = isDelete
            ? `(삭제 요청 · ID: ${escapeHtml(item.orderId || '?')})`
            : escapeHtml(o.clientName || '(거래처 미상)');
        const total    = o.total ? fmt(o.total) + '원' : '';
        const errTxt   = escapeHtml((item.lastError || '').slice(0, 60));
        const wsId     = escapeHtml(item.wsId || '');
        return `<div style="background:var(--surf2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:6px;">
            <div style="font-size:13px;font-weight:600;color:var(--text1);">${clientNm} ${total ? '· ' + total : ''}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px;">${dateStr} · 대상: ${wsId} · 실패 ${item.failCount}회</div>
            ${errTxt ? `<div style="font-size:11px;color:var(--red);margin-top:3px;">오류: ${errTxt}</div>` : ''}
        </div>`;
    }).join('');
    openModal('deadQueueModal');
}

/** ★ v114: dead 큐 전체 재시도 — dead → 일반 큐로 복원 후 flush */
async function retryDeadQueue() {
    const dead = _getDeadQueue();
    if (!dead.length) return;
    // failCount/retryAfter 초기화 후 일반 큐에 추가
    const queue = _getSharedOrderQueue();
    dead.forEach(item => {
        const reset = { ...item, failCount: 0, retryAfter: null, lastError: null };
        // ★ v114: _delete 항목은 orderId로, 일반 항목은 order.id로 비교
        const itemKey = item.order?.id || item.orderId || null;
        const existIdx = itemKey
            ? queue.findIndex(q => (q.order?.id || q.orderId) === itemKey && q.wsId === item.wsId)
            : -1;
        if (existIdx >= 0) queue[existIdx] = reset;
        else queue.push(reset);
    });
    _saveSharedOrderQueue(queue);
    _saveDeadQueue([]);
    closeModal('deadQueueModal');
    _updateDeadQueueBadge();
    _updateSharedQueueBadge();
    toast('🔄 재시도 큐에 추가됨 — 연결 시 자동 업로드', 'var(--accent)', 3000);
    if (isConnected) await _flushSharedOrderQueue().catch(() => {});
}

/** ★ v114: dead 큐 전체 삭제 */
async function clearDeadQueue() {
    const dead = _getDeadQueue();
    if (!dead.length) return;
    const ok = await customConfirm(
        `실패한 전표 ${dead.length}건을 모두 삭제합니다.
삭제하면 복구할 수 없습니다.

정말 삭제하시겠습니까?`,
        '삭제', 'btn-danger'
    );
    if (!ok) return;
    _saveDeadQueue([]);
    closeModal('deadQueueModal');
    _updateDeadQueueBadge();
    toast('🗑️ 실패 항목이 삭제됐습니다', 'var(--text3)');
}



// ─── 워크스페이스 ID 고정 ───

function applyWsLockUI() {
    const locked = localStorage.getItem('wsLocked') === '1';
    const input  = document.getElementById('workspaceId');
    const btn    = document.getElementById('wsLockBtn');
    const badge  = document.getElementById('wsLockBadge');
    const hint   = document.getElementById('wsLockHint');
    if (!input) return;
    if (locked) {
        // 잠금 상태: localStorage에서 ID를 항상 복원 (input이 비어있어도 보장)
        const storedId = localStorage.getItem('workspaceId') || '';
        if (storedId && input.value !== storedId) input.value = storedId;
        input.readOnly = true;
        input.style.opacity = '0.7';
        if (btn)   { btn.textContent = '🔒 해제'; btn.style.color = 'var(--green)'; }
        if (badge) badge.style.display = 'inline-block';
        if (hint)  hint.style.display  = 'block';
    } else {
        input.readOnly = false;
        input.style.opacity = '';
        if (btn)   { btn.textContent = '🔓 고정'; btn.style.color = ''; }
        if (badge) badge.style.display = 'none';
        if (hint)  hint.style.display  = 'none';
    }
}

function toggleWsLock() {
    const input  = document.getElementById('workspaceId');
    const locked = localStorage.getItem('wsLocked') === '1';
    if (!locked) {
        // 고정: 현재 입력값(또는 기존 저장값)을 저장하고 잠금
        const id = input.value.trim().toLowerCase() || localStorage.getItem('workspaceId') || '';
        if (!id) return toast('❗ 먼저 워크스페이스 ID를 입력하세요');
        localStorage.setItem('workspaceId', id);
        localStorage.setItem('wsLocked', '1');
        input.value = id; // 정규화된 값(소문자) 반영
        toast('🔒 워크스페이스 ID가 고정되었습니다', 'var(--green)');
    } else {
        // 잠금 해제: wsLocked만 제거, workspaceId는 유지
        localStorage.removeItem('wsLocked');
        toast('🔓 ID 고정이 해제되었습니다');
    }
    applyWsLockUI();
}

// ─── 공유 워크스페이스 관리 ───────────────────────────────────────────────────
// 같은 거래처명을 다른 담당자와 공유 — 거래명세표에서 합산 조회

// ─── 공유 워크스페이스 관리 ───────────────────────────────────────────────────
// 구조: [{ wsId: "abc", label: "담당자명(선택)" }, ...]  — 내가 조회할 상대방 목록
// 내 공개 허용 거래처: Firebase workspaces/{myId}/sharedClients = ["Q마트","P마트"]
// 공유된 거래처에 납품 시 order.delegatedBy = 납품자 wsId → 납품자 앱에서만 표시

function _getSharedWs() {
    try {
        const raw = JSON.parse(localStorage.getItem('sharedWorkspaces') || '[]');
        // 구버전(string[]) 호환
        return raw.map(item => typeof item === 'string' ? { wsId: item } : item);
    } catch { return []; }
}
function _saveSharedWs(arr) {
    localStorage.setItem('sharedWorkspaces', JSON.stringify(arr));
}

// ── 공유 워크스페이스에서 받은 거래처 캐시 ──────────────────────────────────
// { name, wsId, wsLabel } 형태로 보관
let _sharedClientsFromWs = [];
// 공유 워크스페이스에서 가져온 납품 내역 캐시 { wsId, wsLabel, orders[] }
let _sharedOrdersCache = [];
// 공유 워크스페이스별 실시간 orders 리스너 핸들 { wsId → { ref, cb, allowedNames } }
const _sharedOrdersListeners = {};

/**
 * 등록된 공유 워크스페이스들의 sharedClients 를 Firebase에서 읽어 캐시
 * 앱 시작, 워크스페이스 연결, 수동 새로고침 시 호출
 */
async function _loadSharedClientsFromWs() {
    const wsArr = _getSharedWs();
    if (!wsArr.length || typeof firebase === 'undefined' || !firebase.apps.length) {
        // ★ 오프라인/미연결 시: localStorage 캐시로 공유 거래처 목록 복원
        //   (오프라인 중에도 공유 거래처 직접납품 선택 가능하도록, v96 이식)
        try {
            const cached = JSON.parse(localStorage.getItem('_sharedClientsCache') || '[]');
            _sharedClientsFromWs = Array.isArray(cached) ? cached : [];
        } catch(e) { _sharedClientsFromWs = []; }
        return;
    }
    const result = [];
    await Promise.all(wsArr.map(async item => {
        const wsId    = item.wsId || item;
        const wsLabel = item.label || wsId;
        try {
            const snap = await firebase.database().ref(`workspaces/${wsId}/sharedClients`).get();
            if (!snap.exists()) return;
            // sharedClients: string[] (공개 허용 거래처 이름 목록)
            const rawList = snap.val() || [];
            const names = rawList.map(item => typeof item === 'string' ? item : item.name);
            names.forEach(name => {
                if (!result.find(r => r.name === name && r.wsId === wsId))
                    result.push({ name, wsId, wsLabel });
            });
        } catch(e) { /* 접근 불가 워크스페이스 무시 */ }
    }));
    _sharedClientsFromWs = result;
    // ★ 다음 오프라인 시작 시 사용할 캐시 저장
    try { localStorage.setItem('_sharedClientsCache', JSON.stringify(result)); } catch(e) {}

    // ── 공유 워크스페이스 납품 내역 실시간 리스너 등록 ──
    // 더 이상 없는 워크스페이스 리스너 제거
    const currentWsIds = new Set(wsArr.map(item => item.wsId || item));
    for (const wsId of Object.keys(_sharedOrdersListeners)) {
        if (!currentWsIds.has(wsId)) {
            const h = _sharedOrdersListeners[wsId];
            if (h.ref && h.cb) h.ref.off('value', h.cb);
            delete _sharedOrdersListeners[wsId];
            // 해당 ws 캐시 제거
            _sharedOrdersCache = _sharedOrdersCache.filter(o => o._sharedWsId !== wsId);
        }
    }

    // 새 워크스페이스 리스너 등록
    await Promise.all(wsArr.map(async item => {
        const wsId    = item.wsId || item;
        const wsLabel = item.label || wsId;
        if (_sharedOrdersListeners[wsId]) return; // 이미 등록됨

        try {
            // 공개된 거래처 이름 목록 확인
            const scSnap = await firebase.database().ref(`workspaces/${wsId}/sharedClients`).get();
            const myWsId2 = (localStorage.getItem('workspaceId') || '').toLowerCase();
            let allowedNames = [];
            if (scSnap.exists()) {
                const rawSc = scSnap.val() || [];
                allowedNames = rawSc.map(item => typeof item === 'string' ? item : item.name);
            }
            // ★ allowedNames가 비어있어도 orders 리스너를 등록해 둠
            const ordersRef = firebase.database().ref(`workspaces/${wsId}/orders`);

            // 실시간 리스너: A의 orders가 바뀔 때마다 B의 캐시 갱신
            const ordersCb = snap => {
                const wsOrders = Object.values(snap.val() || {})
                    .filter(o => {
                        // ★ 핵심 필터: 거래처가 공개 목록에 있고
                        if (!allowedNames.includes(o.clientName)) return false;
                        // ★ delegatedBy가 없으면 원래 거래처 담당자(A)가 납품한 것 → 보이면 안 됨
                        // delegatedBy가 내 wsId면 내가 납품한 것 → 보여야 함
                        if (!o.delegatedBy) return false;
                        return o.delegatedBy === myWsId2;
                    })
                    .map(o => ({
                        ...o,
                        _sharedWsId:    wsId,
                        _sharedWsLabel: wsLabel,
                        _readOnly:      false,
                        _mySharedEntry: true,
                    }));
                // 이 wsId의 기존 캐시만 교체
                _sharedOrdersCache = [
                    ..._sharedOrdersCache.filter(o => o._sharedWsId !== wsId),
                    ...wsOrders,
                ];
                renderOrders(); // 내역 탭 즉시 갱신
            };

            ordersRef.on('value', ordersCb, e => console.warn('[공유리스너]', wsId, e));
            _sharedOrdersListeners[wsId] = { ref: ordersRef, cb: ordersCb, allowedNames };
            console.info('[공유리스너] 등록:', wsId, '허용:', allowedNames);
        } catch(e) { console.warn('[공유리스너] 등록 실패:', wsId, e.message); }
    }));
    // 초기 렌더
    renderOrders();
}

/** 공유 워크스페이스 orders 리스너 전체 해제 (워크스페이스 제거/로그아웃 시) */
function _detachSharedOrdersListeners() {
    for (const wsId of Object.keys(_sharedOrdersListeners)) {
        const h = _sharedOrdersListeners[wsId];
        if (h.ref && h.cb) h.ref.off('value', h.cb);
        delete _sharedOrdersListeners[wsId];
    }
    _sharedOrdersCache = [];
}

// 내가 공개 허용한 거래처 목록 (Firebase에 저장)
function _getMySharedClients() {
    try { return JSON.parse(localStorage.getItem('mySharedClients') || '[]'); } catch { return []; }
}
/** mySharedClients: string[] 형태 */
function _normalizeMySharedClients(arr) {
    // 구버전 {name,allowedWsIds} 객체가 섞여있을 경우 string[]으로 정규화
    return arr.map(item => typeof item === 'string' ? item : item.name);
}
function _saveMySharedClients(arr) {
    // arr: string[] 형태로 저장
    const normalized = _normalizeMySharedClients(arr);
    localStorage.setItem('mySharedClients', JSON.stringify(normalized));
    const myId = localStorage.getItem('workspaceId');
    if (myId && typeof firebase !== 'undefined' && firebase.apps.length) {
        firebase.database().ref(`workspaces/${myId}/sharedClients`)
            .set(normalized.length ? normalized : [])
            .catch(() => {});
    }
}

function renderSharedWsList() {
    const el = document.getElementById('sharedWsList');
    if (!el) return;
    const list = _getSharedWs();

    // ── 내 공개 허용 거래처 섹션 ──
    const myShared   = _getMySharedClients();
    const allClients = (clients || []).map(c => c.name).filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a.localeCompare(b,'ko'));

    const mySharedNames = _normalizeMySharedClients(myShared);

    const mySection = `
        <div style="margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;color:var(--text1);margin-bottom:6px;">📤 내가 공개할 거래처</div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:8px;">체크한 거래처는 대신 납품한 담당자 앱에서만 보입니다.</div>
            ${allClients.length === 0
                ? '<div style="font-size:12px;color:var(--text3);">등록된 거래처가 없습니다.</div>'
                : `<div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;">
                    ${allClients.map(name => {
                        const checked = mySharedNames.includes(name);
                        return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0;">
                            <input type="checkbox" ${checked ? 'checked' : ''} data-share-name="${escapeAttr(name)}" onchange="toggleMySharedClient('${escapeAttr(name)}',this.checked)"
                                style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;">
                            <span style="font-size:13px;color:var(--text1);">${escapeHtml(name)}</span>
                        </label>`;
                    }).join('')}
                </div>`
            }
        </div>
        <div style="border-top:1px solid var(--border);margin-bottom:14px;"></div>
        <div style="font-size:12px;font-weight:700;color:var(--text1);margin-bottom:6px;">📥 상대방 워크스페이스 (조회)</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:8px;">상대방이 허용한 거래처만 명세표에서 합산됩니다.</div>`;

    if (!list.length) {
        el.innerHTML = mySection + '<div style="font-size:12px;color:var(--text3);padding:4px 0;">등록된 공유 워크스페이스가 없습니다.</div>';
        return;
    }

    el.innerHTML = mySection + list.map((item, i) => `
        <div style="background:var(--surf2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:13px;flex:1;color:var(--text1);font-weight:600;">📦 ${escapeHtml(item.wsId)}</span>
                <button onclick="removeSharedWs(${i})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:0 4px;" title="삭제">✕</button>
            </div>
            <div id="sharedClientBadges_${i}" style="margin-top:6px;font-size:11px;color:var(--text3);">
                <span style="font-size:11px;color:var(--text3);">⏳ 허용 거래처 로딩 중...</span>
            </div>
        </div>`).join('');

    // 각 워크스페이스의 허용 거래처 목록 비동기 로드
    list.forEach((item, i) => _loadSharedClientBadges(item.wsId, i));
}

async function _loadSharedClientBadges(wsId, idx) {
    const el = document.getElementById(`sharedClientBadges_${idx}`);
    if (!el) return;
    try {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            el.innerHTML = '<span style="color:var(--text3);font-size:11px;">Firebase 미연결 — 연결 후 확인 가능</span>';
            return;
        }
        const snap = await firebase.database().ref(`workspaces/${wsId}/sharedClients`).get();
        if (!snap.exists() || !snap.val()?.length) {
            el.innerHTML = '<span style="color:var(--orange);font-size:11px;">⚠️ 공개 거래처 없음 (상대방이 설정 필요)</span>';
        } else {
            const rawList = snap.val() || [];
            const names = rawList.map(item => typeof item === 'string' ? item : item.name);
            el.innerHTML = '공개 허용: ' + names.map(n =>
                `<span style="background:#e0e7ff;color:#4f46e5;border-radius:4px;padding:1px 6px;font-size:11px;margin:2px 2px 0 0;display:inline-block;">${escapeHtml(n)}</span>`
            ).join('');
        }
    } catch(e) {
        el.innerHTML = '<span style="color:var(--red);font-size:11px;">❌ 접근 불가 (ID 확인 필요)</span>';
    }
}

async function toggleMySharedClient(name, checked) {
    // ── 공개 해제 시 실수 방지 확인 ──
    if (!checked) {
        // 확인 전까지 체크박스를 다시 켜둠 (낙관적 UI 방지)
        const allCbs = document.querySelectorAll('#sharedWsList input[type="checkbox"]');
        allCbs.forEach(cb => {
            if (cb.getAttribute('data-share-name') === name) cb.checked = true;
        });

        const ok = await customConfirm(
            '"' + name + '" 거래처 공유를 해제하면\n상대방이 이 거래처 내역을 더 이상 볼 수 없습니다.\n\n정말 해제하시겠습니까?',
            '해제',
            'btn-danger'
        );
        if (!ok) return; // 취소 → 변경 없음
    }

    const list = _normalizeMySharedClients(_getMySharedClients());
    if (checked && !list.includes(name)) list.push(name);
    if (!checked) { const i = list.indexOf(name); if (i > -1) list.splice(i, 1); }
    _saveMySharedClients(list);
    toast(checked ? `✅ "${name}" 공개 허용` : `🔒 "${name}" 공개 해제`);

    // ── 확정 후 체크박스 최종 상태 반영 ──
    const allCbs = document.querySelectorAll('#sharedWsList input[type="checkbox"]');
    allCbs.forEach(cb => {
        if (cb.getAttribute('data-share-name') === name) cb.checked = checked;
    });
}

function addSharedWs() {
    const input = document.getElementById('sharedWsInput');
    const id = (input.value || '').trim().toLowerCase();
    if (!id) return toast('❗ 워크스페이스 ID를 입력하세요');
    const myId = (localStorage.getItem('workspaceId') || '').toLowerCase();
    if (id === myId) return toast('❗ 내 워크스페이스 ID는 추가할 수 없습니다');
    const list = _getSharedWs();
    if (list.find(item => item.wsId === id)) return toast('❗ 이미 등록된 ID입니다');
    if (list.length >= 10) return toast('❗ 최대 10개까지 등록 가능합니다');
    list.push({ wsId: id });
    _saveSharedWs(list);
    input.value = '';
    renderSharedWsList();
    _loadSharedClientsFromWs(); // 공유 거래처 캐시 + orders 실시간 리스너 등록
    // ★ 새로 추가된 ws의 sharedClients 변경도 실시간으로 감지
    if (typeof firebase !== 'undefined' && firebase.apps.length && isConnected) {
        firebase.database().ref(`workspaces/${id}/sharedClients`)
            .on('value', snap => {
                const rawNew = snap.exists() ? (snap.val() || []) : [];
                const newAllowed = rawNew.map(i => typeof i === 'string' ? i : i.name);
                const h = _sharedOrdersListeners[id];
                if (!h) { _loadSharedClientsFromWs().catch(() => {}); return; }
                const prev = JSON.stringify([...h.allowedNames].sort());
                const next = JSON.stringify([...newAllowed].sort());
                if (prev === next) return;
                h.allowedNames = newAllowed;
                h.ref.off('value', h.cb);
                delete _sharedOrdersListeners[id];
                _loadSharedClientsFromWs().catch(() => {});
                console.info('[공유리스너] sharedClients 변경 감지 → 재등록:', id);
            });
    }
    toast(`✅ "${id}" 공유 등록 완료`, 'var(--green)');
}

async function removeSharedWs(idx) {
    const list = _getSharedWs();
    const target = list[idx];
    if (!target) return;
    const ok = await customConfirm(
        '"' + target.wsId + '" 워크스페이스 공유를 해제하시겠습니까?\n\n해제하면 해당 담당자의 거래처 내역이 더 이상 명세표에 합산되지 않습니다.',
        '해제',
        'btn-danger'
    );
    if (!ok) return;
    list.splice(idx, 1);
    _saveSharedWs(list);
    // 해당 워크스페이스에서 자동 추가된 거래처 중 납품 내역 없는 것 제거
    const removedWsId = target.wsId;
    const autoAdded = clients.filter(c => c._sharedFrom === removedWsId && c._autoAdded);
    autoAdded.forEach(c => {
        const hasOrders = orders.some(o => o.clientId === c.id);
        if (!hasOrders) {
            clients.splice(clients.indexOf(c), 1);
        } else {
            // 납품 내역 있으면 공유 표시만 제거 (거래처는 유지)
            delete c._sharedFrom;
            delete c._autoAdded;
            delete c._sharedLabel;
        }
    });
    // ★ 해당 wsId의 실시간 리스너 즉시 해제
    const h = _sharedOrdersListeners[removedWsId];
    if (h) {
        if (h.ref && h.cb) h.ref.off('value', h.cb);
        delete _sharedOrdersListeners[removedWsId];
    }
    _sharedOrdersCache = _sharedOrdersCache.filter(o => o._sharedWsId !== removedWsId);
    _saveAndFlush();
    invalidateClientsCache();
    renderSharedWsList();
    renderOrders();
    _loadSharedClientsFromWs(); // 남은 ws 캐시 갱신
    toast(`🗑️ "${target.wsId}" 공유 해제`);
}

// ─── Firebase ───

let _lastDiagSyncState = null;
function setSyncStatus(state) {
    if (state !== _lastDiagSyncState) {
        diagLog('🔘 상태 표시 변경', `${_lastDiagSyncState || '(초기)'} → ${state}`);
        _lastDiagSyncState = state;
    }
    const el = document.getElementById('syncStatus');
    const id = localStorage.getItem('workspaceId')||'';
    el.className = ''; // reset
    if (state==='online')  { el.innerHTML=`🟢 온라인 동기화: ${escapeHtml(id)}`; el.classList.add('status-online'); }
    else if (state==='syncing') { el.innerHTML='🟡 동기화 중...'; el.classList.add('status-syncing'); }
    else if (state==='error')   { el.innerHTML='🔴 동기화 오류 — 재연결 시도 중'; el.classList.add('status-error'); }
    else                        { el.innerHTML='⬡ 오프라인 모드'; el.classList.add('status-offline'); }
    // 연결 중일 때만 "현재 워크스페이스 삭제" 버튼 표시
    const delRow = document.getElementById('deleteCurrentWsRow');
    if (delRow) delRow.style.display = (state === 'online') ? 'block' : 'none';
    // 연결 중 + CRM 연동 활성화 시에만 "CRM 재동기화" 버튼 표시
    const crmRow = document.getElementById('crmResyncRow');
    if (crmRow) crmRow.style.display = (state === 'online' && typeof CRM_SYNC_ENABLED !== 'undefined' && CRM_SYNC_ENABLED) ? 'block' : 'none';
}

// Firebase SDK 로드 완료 대기 (defer 스크립트 타이밍 보정)

function waitFirebase(callback, retries=50, interval=200) {
    if (typeof firebase !== 'undefined' && firebase.database) {
        callback();
    } else if (retries > 0) {
        setTimeout(() => waitFirebase(callback, retries-1, interval), interval);
    } else {
        toast('❗ Firebase SDK 로드 실패. 페이지를 새로고침 해주세요.');
        setSyncStatus('error');
    }
}

// ★ v120: Firebase 핵심 리스너 안전 해제 헬퍼
// _doConnect() 재호출 시 중복 등록 방지
function _detachFirebaseListeners() {
    if (workspaceRef && _workspaceHandler) {
        workspaceRef.off('value', _workspaceHandler);
        _workspaceHandler = null;
    }
    if (_connectedRef && _connectedHandler) {
        _connectedRef.off('value', _connectedHandler);
        _connectedHandler = null;
        _connectedRef     = null;
    }
}

function connectWorkspace(auto=false) {
    // 잠금 상태면 localStorage의 고정 ID를 우선 사용
    const locked = localStorage.getItem('wsLocked') === '1';
    const storedId = localStorage.getItem('workspaceId') || '';
    const inputId  = document.getElementById('workspaceId').value.toLowerCase().trim();
    const id = (locked && storedId) ? storedId : inputId;
    if (!id) { toast('❗ 워크스페이스 ID를 입력하세요'); return; }

    // firebase SDK 로드 대기 후 실제 연결
    waitFirebase(() => _doConnect(id, auto));
}

function _doConnect(id, auto=false) {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
            // RTDB 오프라인 지속성: 디스크 캐시로 초기 로드 속도 향상
            try { firebase.database().setPersistenceEnabled(true); } catch(e) {}
        }
        // ★ v120: 재연결 시 .info/connected + workspaceRef 리스너 먼저 해제 (중복 방지)
        _detachFirebaseListeners();
        if (workspaceRef) workspaceRef.off();
        // ★ 재연결 시 기존 sharedClients 리스너 중복 방지 — 먼저 전부 해제
        _getSharedWs().forEach(item => {
            const wsId = item.wsId || item;
            try { firebase.database().ref(`workspaces/${wsId}/sharedClients`).off(); } catch(e) {}
        });
        workspaceRef = firebase.database().ref('workspaces/'+id);
        localStorage.setItem('workspaceId', id);

        // isConnected는 .get() 성공 후에 true로 설정 (조기 설정 방지)
        isConnected = false;
        _initialLoadDone = false;  // 재연결 시 초기화
        _connectGuard    = true;   // ★ Problem 1: .get() 완료 전까지 리스너 차단
        _syncGuard       = false;  // 재연결 시 가드 초기화
        setSyncStatus('syncing');
        document.getElementById('connectBtn').style.display    = 'none';
        document.getElementById('disconnectBtn').style.display = 'block';

        // ── 실시간 리스너를 .get() 이전에 먼저 등록 (이벤트 유실 방지) ──
        _workspaceHandler = _fbValueHandler; // ★ v120: 핸들러 참조 저장
        workspaceRef.on('value', _workspaceHandler);

        // ★ 공유 워크스페이스의 sharedClients 변경 감지 리스너
        // A가 공개 허용 거래처를 추가/제거하면 B의 orders 리스너 allowedNames도 즉시 갱신
        _getSharedWs().forEach(item => {
            const wsId = item.wsId || item;
            firebase.database().ref(`workspaces/${wsId}/sharedClients`)
                .on('value', snap => {
                    const rawNew2 = snap.exists() ? (snap.val() || []) : [];
                    const newAllowed = rawNew2.map(i => typeof i === 'string' ? i : i.name);
                    const h = _sharedOrdersListeners[wsId];
                    if (!h) {
                        // 리스너가 없으면 새로 등록 (처음 공개 허용이 생긴 경우)
                        _loadSharedClientsFromWs().catch(() => {});
                        return;
                    }
                    // allowedNames 변경이 없으면 무시
                    const prev = JSON.stringify([...h.allowedNames].sort());
                    const next = JSON.stringify([...newAllowed].sort());
                    if (prev === next) return;
                    h.allowedNames = newAllowed;
                    // orders 리스너 재등록 (allowedNames 필터가 클로저에 캡처되므로 재등록 필요)
                    h.ref.off('value', h.cb);
                    delete _sharedOrdersListeners[wsId];
                    _loadSharedClientsFromWs().catch(() => {});
                    console.info('[공유리스너] sharedClients 변경 감지 → 재등록:', wsId);
                });
        });

        // ── Firebase 소켓 실제 연결 상태 추적 (.info/connected) ──
        // window.online/offline 이벤트는 WiFi 수준만 감지 → 슬립·방화벽·모바일 백그라운드 후
        // Firebase 소켓이 끊겨도 isConnected=true로 남는 문제를 해소
        _connectedRef = firebase.database().ref('.info/connected'); // ★ v120: ref 저장
        _connectedHandler = snap => { // ★ v120: 핸들러 참조 저장
            const fbConnected = snap.val() === true;
            if (fbConnected) {
                if (!isConnected) {
                    diagLog('🟢 Firebase 소켓 연결됨', '.info/connected → true');
                    _intentionalDisconnect = false; // ★ v110: 재연결 성공했으니 자가진단 플래그도 즉시 해제
                    // ★ Problem 4 수정: 소켓 재연결 시 서버 최신 상태 먼저 확인 후 플러시
                    // (직접 debouncedSync 호출 시 서버에서 변경된 내용을 놓칠 수 있음)
                    isConnected = true;
                    setSyncStatus('online');
                    // 재연결 시 공유 거래처 목록 갱신
                    _loadSharedClientsFromWs().catch(() => {});
                    if (_initialLoadDone) {
                        // ★ v99 fix: 서버 상태 확인 완료 후 큐 flush — 순서 보장
                        _withTimeout(workspaceRef.get(), 10000, 'reconnect.get').then(async snap => {
                            const d = snap.val();
                            if (!d) {
                                await _flushSharedOrderQueue().catch(() => {});
                                if (typeof _flushCrmFailQueue === 'function') _flushCrmFailQueue().catch(() => {}); // ★ v114
                                debouncedSync();
                                return;
                            }
                            const serverTime = d.lastUpdated ? new Date(d.lastUpdated).getTime() : 0;
                            const lastLocalMs = (() => { const s = localStorage.getItem('lastLocalUpdated'); return s ? new Date(s).getTime() : 0; })();
                            const localWriteMs = Math.max(_localWriteTime, lastLocalMs);
                            await _flushSharedOrderQueue().catch(() => {});
                            if (typeof _flushCrmFailQueue === 'function') _flushCrmFailQueue().catch(() => {}); // ★ v114
                            if (localWriteMs > serverTime) {
                                debouncedSync();
                            } else {
                                _fbValueHandler(snap);
                            }
                        }).catch(async e => {
                            diagLog('⚠️ 재연결 직후 서버조회 타임아웃', String(e && e.message || e));
                            await _flushSharedOrderQueue().catch(() => {});
                            if (typeof _flushCrmFailQueue === 'function') _flushCrmFailQueue().catch(() => {}); // ★ v114
                            debouncedSync();
                        });
                    } else {
                        // 초기 로드 전이면 큐만 flush
                        _flushSharedOrderQueue().catch(() => {});
                        if (typeof _flushCrmFailQueue === 'function') _flushCrmFailQueue().catch(() => {}); // ★ v114
                    }
                }
            } else {
                if (isConnected) {
                    // ★ v110: 우리가 직접 goOffline()을 호출해서 생긴 끊김이면 "오류"가 아니라 정상 과정
                    if (_intentionalDisconnect) {
                        diagLog('🔄 소켓 자체 재연결 중', '의도된 새로고침으로 인한 일시 끊김 (정상)');
                    } else {
                        diagLog('🔴 Firebase 소켓 끊김', '.info/connected → false');
                    }
                    isConnected = false;
                    debouncedSync.cancel();
                    setSyncStatus(_intentionalDisconnect ? 'syncing' : 'error');
                }
            }
        };
        _connectedRef.on('value', _connectedHandler); // ★ v120: 저장된 ref/핸들러로 등록

        // ── 최초 1회 스냅샷: 서버↔로컬 병합 판단 ──
        _withTimeout(workspaceRef.get(), 15000, 'initialConnect.get').then(async snap => {
            const data = snap.val();
            // 연결 성공 확인 시점에 isConnected=true 설정
            isConnected = true;
            setTimeout(checkAutoBackup, 1500);
            // ── 첫 연결 시 오프라인 큐 플러시 ──
            _flushSharedOrderQueue().catch(() => {});
            if (typeof _flushCrmFailQueue === 'function') _flushCrmFailQueue().catch(() => {}); // ★ v114

            // 서버에 데이터가 있는지 (어느 키 하나라도)
            const serverHasData = data && (
                toArray(data.clients).length > 0 ||
                toArray(data.orders).length > 0  ||
                toArray(data.stockItems).length > 0
            );
            const localHasData = clients.length > 0 || orders.length > 0 || stockItems.length > 0;

            if (serverHasData) {
                // ── 서버·로컬 중 더 최신 데이터 판단 ──
                // 서버의 lastUpdated vs 로컬의 최근 전표 createdAt 비교
                const serverTime = data.lastUpdated ? new Date(data.lastUpdated).getTime() : 0;
                // 주문 createdAt 뿐 아니라 updatedAt(메모 수정/삭제 등)도 함께 비교
                // localStorage의 lastLocalUpdated도 포함 (오프라인 변경 대비)
                const lastLocalUpdated = localStorage.getItem('lastLocalUpdated');
                const localLatestOrder = orders.reduce((max, o) => {
                    const t1 = o.createdAt  ? new Date(o.createdAt).getTime()  : 0;
                    const t2 = o.updatedAt  ? new Date(o.updatedAt).getTime()  : 0;
                    return Math.max(t1, t2, max);
                }, lastLocalUpdated ? new Date(lastLocalUpdated).getTime() : 0);
                const localIsNewer = localHasData && localLatestOrder > serverTime;

                if (localIsNewer) {
                    // 공통 업로드 payload 빌더 (배열 대신 map + minify로 payload 최소화)
                    // ★ v122 fix: orders: {...} 로 통째 교체하던 방식은, 내가 오프라인이던 사이
                    // 다른 사람이 공유거래처 대납으로 내 워크스페이스에 직접 써넣은 전표를
                    // 재접속 시 통째로 지워버리는 버그가 있었음.
                    // → orders만 경로별(orders/{id}) 키로 풀어서, 서버에만 있는 항목은 건드리지 않는다.
                    const _buildUploadPayload = () => {
                        const ver = Date.now();
                        localStorage.setItem('ws_version', String(ver));
                        const payload = {
                            clients:    clients.map(_minifyClient),
                            prices,
                            stockItems: _getLightStock(),
                            lastUpdated: new Date().toISOString(),
                            writtenBy:  SESSION_ID,
                            version:    ver,  // ★ v99 fix: 충돌 감지용 version 포함
                        };
                        orders.forEach(o => { payload['orders/' + o.id] = _minifyOrder(o); });
                        _deletedOrders.forEach(id => { payload['orders/' + id] = null; });
                        return payload;
                    };
                    if (auto) {
                        // 자동 연결에서 로컬이 더 최신 → 조용히 로컬 데이터를 서버에 업로드
                        // (오프라인 중 작업한 데이터 유실 방지)
                        const ch=dataHash(clients),oh=dataHash(orders),ph=dataHash(prices),sh=dataHash(stockItems);
                        workspaceRef.update(_buildUploadPayload())
                            .then(()=>{ lastHash.clients=ch;lastHash.orders=oh;lastHash.prices=ph;lastHash.stock=sh; _clearOrderDelta(); setSyncStatus('online'); toast('🟢 자동 연결 완료 (로컬→서버 업로드)', 'var(--green)'); })
                            .catch(e=>{ console.error('업로드 실패:',e); setSyncStatus('error'); });
                        _connectGuard    = false; // ★ 업로드 트리거 후 리스너 해제
                        _initialLoadDone = true;
                        return;
                    } else {
                        // 수동 연결에서 로컬이 더 최신 → 사용자에게 선택 요청
                        const useLocal = await customConfirm(
                            '⚠️ 로컬 데이터가 서버보다 최신입니다.\n\n' +
                            '· 확인: 로컬 데이터를 서버에 업로드\n' +
                            '· 취소: 서버 데이터를 내려받기',
                            '로컬 업로드', 'btn-primary'
                        );
                        if (useLocal) {
                            const ch=dataHash(clients),oh=dataHash(orders),ph=dataHash(prices),sh=dataHash(stockItems);
                            workspaceRef.update(_buildUploadPayload())
                                .then(()=>{ lastHash.clients=ch;lastHash.orders=oh;lastHash.prices=ph;lastHash.stock=sh; _clearOrderDelta(); setSyncStatus('online'); toast('☁️ 로컬 데이터를 서버에 업로드했습니다','var(--green)'); })
                                .catch(e=>{ console.error('업로드 실패:',e); setSyncStatus('error'); });
                            _connectGuard    = false;
                            _initialLoadDone = true;
                            closeModal('firebaseModal');
                            return;
                        }
                    }
                }
                const newClients = toArray(data.clients).map(_normClientFromFb);
                const newOrders = toArray(data.orders).map(_normOrderFromFb);
                const newStock = toArray(data.stockItems || []).map(normStock);

                clients    = newClients;
                orders     = newOrders;
                if (data.prices)       prices     = data.prices;
                if (newStock.length)   stockItems = newStock;

                lastHash.clients = dataHash(clients);
                lastHash.orders  = dataHash(orders);
                lastHash.prices  = dataHash(prices);
                lastHash.stock   = dataHash(stockItems);
                if (data.lastUpdated) localStorage.setItem('lastLocalUpdated', data.lastUpdated);
                saveToLocal();
                _fullRender();
                setSyncStatus('online');
                if (!auto) toast('☁️ 서버 데이터를 불러왔습니다', 'var(--green)');
                else       toast('🟢 자동 연결 완료', 'var(--green)');

            } else if (localHasData) {
                // ── 서버 비어있음 → 로컬 데이터 업로드 ──
                const ch = dataHash(clients), oh = dataHash(orders), ph = dataHash(prices), sh = dataHash(stockItems);
                // ★ v99 fix: _minifyOrder 적용 + version 포함
                const ordersMap = {};
                orders.forEach(o => { ordersMap[o.id] = _minifyOrder(o); });
                const ver = Date.now();
                localStorage.setItem('ws_version', String(ver));
                workspaceRef.update({
                    clients:    clients.map(_minifyClient),
                    orders:     ordersMap,
                    prices,
                    stockItems: _getLightStock(),
                    lastUpdated: new Date().toISOString(),
                    writtenBy:  SESSION_ID,
                    version:    ver,
                }).then(() => {
                    lastHash.clients = ch; lastHash.orders = oh; lastHash.prices = ph; lastHash.stock = sh;
                    setSyncStatus('online');
                    toast('☁️ 로컬 데이터를 서버에 업로드했습니다', 'var(--green)');
                }).catch(e => { console.error('초기 업로드 실패:', e); setSyncStatus('error'); });

            } else {
                // 서버·로컬 모두 빔
                setSyncStatus('online');
                if (!auto) toast('✅ Firebase 연결 완료', 'var(--green)');
                else       toast('🟢 자동 연결 완료', 'var(--green)');
            }

            // 초기 로드 완료 → 이후부턴 실시간 리스너가 처리
            _connectGuard    = false; // ★ Problem 1: 초기 처리 완료, 리스너 차단 해제
            _initialLoadDone = true;

            // ★ 실시간 폴링 백업: 30초마다 서버 확인 (이벤트 유실 대비)
            // — 실시간 리스너(.on)와 중복 방지: hash 비교 후 실제 변경분만 처리
            if (_rtPollTimer) clearInterval(_rtPollTimer);
            _rtPollTimer = setInterval(() => {
                // ★ v99 fix: _connectGuard 중(초기 연결 처리 중)에는 폴링 생략
                if (!workspaceRef || !isConnected || _syncGuard || _connectGuard) return;
                _withTimeout(workspaceRef.get(), 8000, 'poll.get').then(snap => {
                    const d = snap.val();
                    if (!d) return;
                    // 서버 데이터가 로컬과 동일하면 핸들러 호출 생략 (불필요한 렌더링 방지)
                    const serverOrdersHash  = dataHash(toArray(d.orders).map(_normOrderFromFb));
                    const serverClientsHash = dataHash(toArray(d.clients).map(_normClientFromFb));
                    if (serverOrdersHash === lastHash.orders &&
                        serverClientsHash === lastHash.clients) return;
                    _fbValueHandler(snap);
                }).catch(() => {}); // 폴링 실패는 다음 30초 주기에 재시도되므로 별도 로그 생략
            }, 30000);

            if (!auto) closeModal('firebaseModal');

        }).catch(err => {
            diagLog('⚠️ 최초 연결 실패/타임아웃', String(err && err.message || err));
            _connectGuard    = false; // 실패해도 리스너 차단 해제
            _initialLoadDone = true; // 실패해도 리스너는 활성화
            console.error('Firebase 연결 실패:', err);
            isConnected = false;
            // ★ v120: 핸들러 참조 먼저 정리 → workspaceRef=null 이전에 호출해야 ref 조건 통과
            _detachFirebaseListeners();
            if (workspaceRef) workspaceRef.off();
            workspaceRef = null;
            setSyncStatus('error');
            document.getElementById('connectBtn').style.display    = 'block';
            document.getElementById('disconnectBtn').style.display = 'none';
            const isTimeout = String(err && err.message || '').startsWith('[timeout]');
            const msg = err.code === 'PERMISSION_DENIED'
                ? '❗ 권한 오류: Firebase 보안 규칙을 확인하세요'
                : isTimeout
                    ? '❗ 연결 시간 초과 — 네트워크 상태를 확인 후 다시 시도해주세요'
                    : '❗ 연결 실패: ' + (err.message || '네트워크 오류');
            toast(msg);
        });

    } catch(e) {
        console.error('Firebase 초기화 오류:', e);
        isConnected = false;
        setSyncStatus('error');
        toast('❗ Firebase 초기화 오류: ' + e.message);
    }
}

function disconnectWorkspace() {
    // ★ v120: 핵심 리스너 안전 해제 — workspaceRef=null 이전에 호출해야 ref 조건 통과
    _detachFirebaseListeners();
    if (workspaceRef) workspaceRef.off();
    _workspaceHandler = null; // ★ v120: 전체 off 이후 명시적 초기화
    // ★ 공유 워크스페이스 실시간 리스너 전체 해제 (orders + sharedClients)
    _detachSharedOrdersListeners();
    _getSharedWs().forEach(item => {
        const wsId = item.wsId || item;
        try { firebase.database().ref(`workspaces/${wsId}/sharedClients`).off(); } catch(e) {}
    });
    // 실시간 폴링 백업 타이머 정리
    if (_rtPollTimer) { clearInterval(_rtPollTimer); _rtPollTimer = null; }
    debouncedSync.cancel();
    workspaceRef=null; isConnected=false;
    _syncGuard=false; _connectGuard=false; // 가드 초기화
    // 재연결 시 변경사항을 정확히 업로드하도록 lastHash 초기화
    lastHash = { clients:'', orders:'', prices:'', stock:'' };
    setSyncStatus('offline');
    document.getElementById('connectBtn').style.display   ='block';
    document.getElementById('disconnectBtn').style.display='none';
    applyWsLockUI();
    toast('🔌 연결 해제됨');
}

// ─── 워크스페이스 Firebase 데이터 삭제 ───

async function deleteWorkspaceData(targetId) {
    const id = (targetId || '').trim().toLowerCase();
    if (!id) return toast('❗ 삭제할 워크스페이스 ID를 입력하세요');

    const isCurrentWs = (id === (localStorage.getItem('workspaceId') || '').toLowerCase());

    const confirmed = await customConfirm(
        `⚠️ 워크스페이스 "${id}"의 모든 Firebase 데이터를 삭제합니다.\n\n` +
        `거래처·전표·재고·백업 등 서버에 저장된 모든 데이터가 영구 삭제됩니다.\n` +
        `이 작업은 되돌릴 수 없습니다!`,
        '삭제', 'btn-danger'
    );
    if (!confirmed) return;

    const confirmed2 = await customConfirm(
        `마지막 확인입니다.\n워크스페이스 "${id}" Firebase 데이터를 완전히 삭제합니다.`,
        '최종 삭제', 'btn-danger'
    );
    if (!confirmed2) return;

    try {
        waitFirebase(async () => {
            try {
                if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
                const ref = firebase.database().ref('workspaces/' + id);
                await ref.remove();

                toast(`🗑️ 워크스페이스 "${id}" Firebase 데이터 삭제 완료`, 'var(--green)');

                // 현재 연결된 워크스페이스였다면 자동 연결 해제
                if (isCurrentWs && isConnected) {
                    disconnectWorkspace();
                    toast(`🔌 연결 해제 및 데이터 삭제 완료`);
                }

                // 삭제 후 입력 필드 초기화
                const inp = document.getElementById('deleteWsInput');
                if (inp) inp.value = '';
            } catch(e) {
                console.error('워크스페이스 삭제 오류:', e);
                const msg = e.code === 'PERMISSION_DENIED'
                    ? '❗ 권한 오류: Firebase 보안 규칙에서 삭제가 허용되지 않습니다'
                    : '❗ 삭제 실패: ' + (e.message || '알 수 없는 오류');
                toast(msg);
            }
        });
    } catch(e) {
        toast('❗ Firebase 초기화 오류: ' + e.message);
    }
}

// ─── 현재 연결된 워크스페이스 삭제 (연결 상태 필요) ───
async function deleteCurrentWorkspaceData() {
    const id = localStorage.getItem('workspaceId') || '';
    if (!id) return toast('❗ 연결된 워크스페이스가 없습니다');
    if (!isConnected || !workspaceRef) return toast('❗ Firebase에 연결 후 삭제할 수 있습니다');
    await deleteWorkspaceData(id);
}

