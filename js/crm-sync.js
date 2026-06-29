// ╔══════════════════════════════════════════════════════════════╗
// ║  § CRM 연동  결제 양방향 동기 (거래장 → CRM 역방향 패치)             ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── CRM 연동 설정 (결제 양방향 동기) ───────────────────────────────────────
// CRM 앱의 Firebase 프로젝트 설정값을 입력하세요.
// 비워두면 CRM 역방향 패치가 비활성화됩니다.
const CRM_FIREBASE_CFG = {
    apiKey:            "AIzaSyBfSu4_0u_7nSEqo9-HQVKINgF_l59YkE8",
    authDomain:        "crm-accounting-d7bd0.firebaseapp.com",
    databaseURL:       "https://crm-accounting-d7bd0-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "crm-accounting-d7bd0",
    storageBucket:     "crm-accounting-d7bd0.firebasestorage.app",
    messagingSenderId: "329588634587",
    appId:             "1:329588634587:web:ebf56826605b7263486dfe",
};

// CRM 연동 활성화 여부 (databaseURL이 있으면 자동 활성화)
const CRM_SYNC_ENABLED = !!(CRM_FIREBASE_CFG.databaseURL);

// ─── CRM Firebase Named Instance 확보 ────────────────────────────────────────
function _getCrmApp() {
    if (!CRM_SYNC_ENABLED) return null;
    try { return firebase.app('crm_link'); }
    catch (e) { return firebase.initializeApp(CRM_FIREBASE_CFG, 'crm_link'); }
}

/**
 * 거래장에서 결제 처리 후 → CRM Firebase의 해당 transaction 결제 필드 동기화
 * CRM에서 이미 _napumId 로 연결된 거래(transaction)만 패치합니다.
 *
 * @param {string} orderId  - 거래장 order.id
 * @param {object} order    - 결제 처리된 order 객체 (isPaid, paidAmount, paidAt, paidMethod 포함)
 */
async function _patchCrmTransaction(orderId, order) {
    if (!CRM_SYNC_ENABLED) return false;
    if (typeof firebase === 'undefined') return false;

    // 거래장 workspaceId 확보
    // 공유 납품 전표(_sharedWsId가 있는 전표)는 원본 워크스페이스(A)의 wsId로 napumKey 구성
    let wsId;
    if (order && order._sharedWsId) {
        // 공유 전표: A의 워크스페이스 ID 사용 (CRM의 _napumId는 A_wsId:orderId 형식)
        wsId = order._sharedWsId;
    } else {
        wsId = localStorage.getItem('workspaceId');
    }
    if (!wsId) { console.warn('[CRM패치] workspaceId 없음'); return false; }

    // CRM에서 이 order를 가리키는 napumKey 형식: "wsId:orderId"
    const napumKey = `${wsId}:${orderId}`;

    try {
        const crmDb = _getCrmApp().database();

        // CRM transactions 에서 _napumId === napumKey 인 항목 검색
        const txSnap = await crmDb.ref('transactions').orderByChild('_napumId').equalTo(napumKey).once('value');
        if (!txSnap.exists()) {
            console.info('[CRM패치] 해당 napumKey의 CRM 거래 없음 (아직 미동기):', napumKey);
            return null; // ★ v114: null = 미연동(재시도 불필요), false = 오류(재시도 필요), true = 성공
        }

        // 결제 필드 구성
        const _isPaid = !!order.isPaid;
        const patch = {
            status:     _isPaid ? '수금완료' : (order.paidAmount > 0 ? '부분수금' : '미수금'),
            paidAmount: order.paidAmount || 0,
            // 완납취소 시 null로 명시 — || 연산자로 현재 시각/cash가 잘못 채워지는 것을 방지
            paidAt:     _isPaid ? (order.paidAt || new Date().toISOString()) : null,
            paidMethod: _isPaid ? (order.paidMethod || 'cash') : null,
            paidMethodDetail: _isPaid ? (order.paidMethodDetail || null) : null,
            discount:   order.discount || null,
            updatedAt:  new Date().toISOString(),
            // 거래장 우선권 플래그: CRM이 이 필드를 다시 덮어쓰지 않도록
            // (단, CRM에서 다시 처리하면 crmControlled=true로 재취득)
            dlControlled: true,
        };

        // 매칭된 CRM transaction(들) 모두 패치
        const updates = {};
        txSnap.forEach(child => {
            Object.keys(patch).forEach(k => {
                updates[`transactions/${child.key}/${k}`] = patch[k];
            });
        });
        await crmDb.ref('/').update(updates);

        console.info('[CRM패치] 성공:', napumKey, '→ status:', patch.status, 'paidAmount:', patch.paidAmount);
        return true;
    } catch (e) {
        console.warn('[CRM패치] 실패:', e.message, '| napumKey:', napumKey);
        return false;
    }
}

/**
 * 결제 처리 후 CRM 역방향 패치 공통 헬퍼.
 * toast는 호출부에서 이미 표시하므로 여기선 추가 toast만 띄움.
 */
function _afterDlPayPatch(orderId, order) {
    if (!CRM_SYNC_ENABLED) return;
    _patchCrmWithRetry(orderId, order, 0);
}

const _CRM_RETRY_DELAYS = [2000, 5000, 15000, 60000]; // 1·2·3·4차 재시도 간격(ms)

// ★ v114: CRM 패치 실패 큐 — 앱 재시작 후에도 재시도 보장
const _CRM_FAIL_QUEUE_KEY = '_crmPatchFailQueue';

function _getCrmFailQueue() {
    try { return JSON.parse(localStorage.getItem(_CRM_FAIL_QUEUE_KEY) || '[]'); } catch { return []; }
}
function _saveCrmFailQueue(q) {
    try { localStorage.setItem(_CRM_FAIL_QUEUE_KEY, JSON.stringify(q)); } catch(e) {}
}

/** ★ v114: 앱 시작 시 또는 Firebase 재연결 시 CRM 실패 큐 일괄 재시도 */
async function _flushCrmFailQueue() {
    if (!CRM_SYNC_ENABLED) return;
    const queue = _getCrmFailQueue();
    if (!queue.length) return;
    const remaining = [];
    let successCnt = 0;
    for (const item of queue) {
        // ★ v114: _patchCrmTransaction은 예외를 내부에서 흡수하므로 try-catch 불필요
        // 반환값: true=성공, null=CRM에 거래없음(미연동), false=오류발생
        const result = await _patchCrmTransaction(item.orderId, item.order);
        if (result === true) {
            successCnt++;
            // 성공 — remaining에 추가 안 함 (제거)
        } else if (result === null) {
            // CRM에 거래 없음(미연동) — 재시도해도 같은 결과이므로 제거
            console.info('[CRM큐] 미연동 항목 제거:', item.orderId);
        } else {
            // result === false: 오류 발생 — 재시도 큐에 유지
            const fc = (item.failCount || 0) + 1;
            if (fc >= 6) {
                console.warn('[CRM큐] 최대 재시도(6회) 초과 — 항목 제거:', item.orderId);
            } else {
                remaining.push({ ...item, failCount: fc });
            }
        }
    }
    _saveCrmFailQueue(remaining);
    if (successCnt > 0) toast(`📊 CRM 미반영 결제 ${successCnt}건 복구됨`, 'var(--green)', 3000);
}

function _patchCrmWithRetry(orderId, order, attempt) {
    _patchCrmTransaction(orderId, order)
        .then(ok => {
            // ★ v118: true/null/false 명시 분기 (null은 falsy라 if(ok)로는 구분 불가)
            if (ok === true) {
                toast('📊 CRM에도 반영됨', 'var(--green)', 2500);
                // 성공 시 fail 큐에서 제거
                const q = _getCrmFailQueue().filter(i => i.orderId !== orderId);
                _saveCrmFailQueue(q);
            } else if (ok === null) {
                // CRM에 거래 없음 — 재시도 불필요 (연동 전 주문)
                console.info('[CRM패치] 미연동 주문 (CRM에 거래 없음):', orderId);
            } else {
                // false: 오류 발생 — catch로 넘기지 않으므로 여기서 재시도
                console.warn(`[CRM패치] 실패 반환 (시도 ${attempt + 1})`);
                if (attempt < _CRM_RETRY_DELAYS.length) {
                    const delay = _CRM_RETRY_DELAYS[attempt];
                    setTimeout(() => _patchCrmWithRetry(orderId, order, attempt + 1), delay);
                } else {
                    const q = _getCrmFailQueue();
                    const existIdx = q.findIndex(i => i.orderId === orderId);
                    const entry = { orderId, order, failCount: attempt + 1, savedAt: new Date().toISOString(), lastError: 'false returned' };
                    if (existIdx >= 0) q[existIdx] = entry; else q.push(entry);
                    _saveCrmFailQueue(q);
                    toast('⚠️ CRM 반영 실패 — 다음 연결 시 자동 재시도됩니다', 'var(--orange)', 5000);
                }
            }
        })
        .catch(e => {
            console.warn(`[CRM패치] 실패 (시도 ${attempt + 1}):`, e.message);
            if (attempt < _CRM_RETRY_DELAYS.length) {
                // 지수 백오프 재시도
                const delay = _CRM_RETRY_DELAYS[attempt];
                console.info(`[CRM패치] ${delay / 1000}초 후 재시도 (${attempt + 2}차)`);
                setTimeout(() => _patchCrmWithRetry(orderId, order, attempt + 1), delay);
            } else {
                // ★ v114: 최대 재시도 초과 → localStorage에 저장 (앱 재시작 후 재시도)
                console.warn('[CRM패치] 최대 재시도 초과 → fail 큐 저장:', orderId);
                const q = _getCrmFailQueue();
                const existIdx = q.findIndex(i => i.orderId === orderId);
                const entry = { orderId, order, failCount: attempt + 1, savedAt: new Date().toISOString(), lastError: e.message };
                if (existIdx >= 0) q[existIdx] = entry;
                else q.push(entry);
                _saveCrmFailQueue(q);
                toast('⚠️ CRM 반영 실패 — 다음 연결 시 자동 재시도됩니다', 'var(--orange)', 5000);
            }
        });
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  § 공유 내역 편집 헬퍼 — B가 A의 Firebase에 직접 반영             ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * 공유 내역(o._sharedWsId가 있는 전표)의 변경을 A의 Firebase에 저장
 * @param {string} wsId       - A의 워크스페이스 ID
 * @param {string} orderId    - 전표 ID
 * @param {object|null} patch - null이면 삭제, 아니면 업데이트할 필드
 */
async function _patchSharedOrder(wsId, orderId, patch) {
    if (!wsId || !orderId) return false;
    if (typeof firebase === 'undefined' || !firebase.apps.length) {
        toast('❗ 공유 내역 수정은 Firebase 연결이 필요합니다', 'var(--red)', 3500);
        return false;
    }
    try {
        const ref = firebase.database().ref(`workspaces/${wsId}/orders/${orderId}`);
        if (patch === null) {
            await ref.remove();
        } else {
            // ★ v114: transaction으로 충돌 방지 + revision 증가 + ServerValue.TIMESTAMP
            await ref.transaction(current => {
                if (!current) return current; // 삭제된 전표면 중단
                return {
                    ...current,
                    ...patch,
                    revision:  (current.revision || 0) + 1,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP,
                };
            });
        }
        // _sharedOrdersCache 즉시 갱신
        if (patch === null) {
            const idx = _sharedOrdersCache.findIndex(o => o.id === orderId);
            if (idx >= 0) _sharedOrdersCache.splice(idx, 1);
        } else {
            const cached = _sharedOrdersCache.find(o => o.id === orderId);
            if (cached) Object.assign(cached, patch);
        }
        return true;
    } catch(e) {
        console.error('[공유편집] Firebase 오류:', e);
        toast('❗ 공유 내역 저장 실패: ' + e.message, 'var(--red)', 4000);
        return false;
    }
}

/**
 * orders 또는 _sharedOrdersCache에서 전표 ID로 전표를 찾아 반환
 * @returns {{ order, isShared, sharedWsId }}
 */
function _findOrderAnywhere(id) {
    const myOrder = orders.find(o => o.id === id);
    if (myOrder) return { order: myOrder, isShared: false, sharedWsId: null };
    const sharedOrder = _sharedOrdersCache.find(o => o.id === id);
    if (sharedOrder) return { order: sharedOrder, isShared: true, sharedWsId: sharedOrder._sharedWsId };
    return null;
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  § CRM 일괄 재동기화 — 놓친 거래/결제 따라잡기 (v99)              ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * 결제 정보가 있는 모든 전표(내 전표 + 공유 전표)를 CRM에 일괄 재패치합니다.
 * - 일시적 오류·오프라인 등으로 CRM에 반영되지 못한 결제 내역을 따라잡기 위한
 *   수동 "재동기화" 기능입니다.
 * - _patchCrmTransaction은 CRM에 해당 napumKey 거래가 없으면 조용히 스킵하므로
 *   안전하게 전체를 순회해도 무방합니다(미연동 주문은 통계에서 "미연동"으로 집계).
 * - Firebase RTDB 과다 호출 방지를 위해 순차 처리 + 약간의 딜레이를 둡니다.
 */
async function resyncAllPaymentsToCrm() {
    if (!CRM_SYNC_ENABLED) {
        toast('❗ CRM 연동이 설정되지 않았습니다 (CRM_FIREBASE_CFG 확인)', 'var(--red)');
        return;
    }
    if (typeof firebase === 'undefined' || !firebase.apps.length || !isConnected) {
        toast('❗ Firebase에 연결된 상태에서만 재동기화할 수 있습니다', 'var(--red)');
        return;
    }

    // 결제(완납/부분/미수 전환 등) 정보가 한 번이라도 기록된 전표만 대상
    const targets = [
        ...orders,
        ..._sharedOrdersCache,
    ].filter(o => !o.isVoid && (o.isPaid || (o.paidAmount || 0) > 0));

    if (!targets.length) {
        toast('✅ 재동기화할 결제 내역이 없습니다');
        return;
    }

    toast(`🔄 CRM 재동기화 시작 — ${targets.length}건 확인 중...`, 'var(--accent)', 3000);

    let synced = 0, skipped = 0, failed = 0;
    for (const o of targets) {
        try {
            const ok = await _patchCrmTransaction(o.id, o);
            if (ok) synced++; else skipped++;
        } catch (e) {
            failed++;
            console.warn('[CRM재동기화] 오류:', o.id, e.message);
        }
        // RTDB 과다 호출 방지 — 건당 약간의 간격
        await new Promise(r => setTimeout(r, 150));
    }

    const summary = `🔄 CRM 재동기화 완료 — 반영 ${synced}건 / 미연동 ${skipped}건` +
        (failed > 0 ? ` / 실패 ${failed}건` : '');
    toast(summary, failed > 0 ? 'var(--orange)' : 'var(--green)', 5000);
    console.info('[CRM재동기화]', { total: targets.length, synced, skipped, failed });
}
