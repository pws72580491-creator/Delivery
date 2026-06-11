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
            return false;
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
    _patchCrmTransaction(orderId, order)
        .then(ok => {
            if (ok) toast('📊 CRM에도 반영됨', 'var(--green)', 2500);
            else     console.info('[CRM패치] 미연동 주문 (CRM에 거래 없음)');
        })
        .catch(e => console.warn('[CRM패치] 오류:', e));
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
            await ref.update({ ...patch, updatedAt: new Date().toISOString() });
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

