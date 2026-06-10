// ╔══════════════════════════════════════════════════════════════╗
// ║  § 3  로컬 저장 + Firebase 동기화 트리거                               ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── localStorage 변경 감지용 해시 캐시 ───
const _localHash = { clients: null, orders: null, prices: null, stock: null };

function saveToLocal() {
    // → isConnected가 아직 false여도 경량 저장으로 용량 절약
    const hasWorkspace = !!(localStorage.getItem('workspaceId'));
    const useLightMode = isConnected || hasWorkspace;
    try {
        const ordersToSave = useLightMode ? _getLightOrders() : orders.map(_minifyOrder);
        const stockToSave  = useLightMode ? _getLightStock()  : stockItems;
        _cleanPrices();
        localStorage.setItem('p_clients', JSON.stringify(clients.map(_minifyClient)));
        localStorage.setItem('p_orders',  JSON.stringify(ordersToSave));
        localStorage.setItem('prices',    JSON.stringify(prices));
        localStorage.setItem('p_stock',   JSON.stringify(stockToSave));
    } catch(e) {
        // ── 자동 긴급 정리: 기존 키 먼저 제거 → 공간 확보 → 경량 재저장 ──
        toast('⚠️ 저장공간 부족 → 자동 정리 중...', 'var(--orange)');
        try {
            // 1단계: 기존 대용량 키 제거로 공간 확보 (데이터는 메모리에 있음)
            localStorage.removeItem('p_orders');
            localStorage.removeItem('p_stock');
            // 2단계: 저장용 임시 배열만 필터링 — 메모리(orders/stockItems)는 절대 변경 안 함
            const cutoff = _kstMonthsAgo(6);
            const lightOrdersForSave = orders
                .filter(o => !(o.isPaid && o.date < cutoff))
                .map(o => {
                    const m = _minifyOrder(o);
                    const cutoff1m = _kstMonthsAgo(1);
                    if (o.isPaid && o.date < cutoff1m) { delete m.items; m._noItems = 1; }
                    return m;
                });
            const lightStockForSave = stockItems.map(si => ({
                ...si,
                log: _trimLogByDate(si.log)
            }));
            const removed = orders.length - lightOrdersForSave.length;
            // 3단계: 경량 데이터로 재저장
            localStorage.setItem('p_clients', JSON.stringify(clients.map(_minifyClient)));
            localStorage.setItem('p_orders',  JSON.stringify(lightOrdersForSave));
            localStorage.setItem('prices',    JSON.stringify(prices));
            localStorage.setItem('p_stock',   JSON.stringify(lightStockForSave));
            toast(`✅ 자동 정리 완료 — 저장용 전표 ${removed}건 축소, 재고 이력 축소 (메모리 유지)`, 'var(--green)');
            if (typeof updateStorageBar === 'function') updateStorageBar();
        } catch(e2) {
            // 최후 수단: 전체 앱 키 삭제 후 경량 재저장
            try {
                ['p_clients','p_orders','prices','p_stock'].forEach(k => localStorage.removeItem(k));
                localStorage.setItem('p_clients', JSON.stringify(clients.map(_minifyClient)));
                localStorage.setItem('p_orders',  JSON.stringify(_getLightOrders()));
                localStorage.setItem('prices',    JSON.stringify(prices));
                localStorage.setItem('p_stock',   JSON.stringify(_getLightStock()));
                toast('✅ 긴급 정리 완료. Firebase에서 전체 데이터를 복원합니다.', 'var(--green)');
            } catch(e3) {
                toast('⚠️ 저장 실패: 설정 탭 > 저장공간 관리에서 직접 정리해 주세요.', 'var(--red)');
            }
        }
    }
}

// ── 품목 목록 표시용 헬퍼 (오프라인 _noItems 전표 안내 포함) ──
function _fmtItems(o) {
    if (!(o.items||[]).length) return '<span style="color:var(--text3);font-size:10px;">📡 온라인 시 표시</span>';
    return (o.items||[]).map(i=>`${i.name}(${i.qty})`).join(', ');
}

// ② createdAt/updatedAt 단축: "YYYY-MM-DDTHH:MM:SS.mmmZ" → "YYYY-MM-DDTHH:MM" (16자, ~8자 절감)
// 값이 없으면 null 반환 → 호출부에서 if(ts) 로 생략 처리
function _compactTs(ts) {
    if (!ts) return null;
    const s = String(ts).slice(0, 16);
    return s.length >= 10 ? s : null;  // 최소 날짜 형식(10자) 미만이면 무효
}

// ① it.total 중복 제거: qty×price 로 항상 복원 가능 → 저장 시 제외
function _minifyItem(it) {
    return { name: it.name, qty: it.qty, price: it.price };
}

function _minifyOrder(o) {
    // totalAmount = total 항상 동일 → 제거
    // memo → note 이관 완료 → 제거
    // client → clientName 이관 완료 → 제거
    // note/paidAt/paidAmount/paidNote: 값 있을 때만 포함
    // it.total: qty×price 복원 가능 → 제거 (① 최적화)
    // createdAt/updatedAt: 16자로 단축 (② 최적화)
    const r = {
        id: o.id,
        clientId: o.clientId,
        clientName: o.clientName,
        date: o.date,
        total: o.total,
        isPaid: o.isPaid,
        items: Array.isArray(o.items) ? o.items.map(_minifyItem) : [],
    };
    const ca = _compactTs(o.createdAt);
    if (ca)            r.createdAt  = ca;
    if (o.note)        r.note       = o.note;       // ③ 빈 값 저장 방지
    if (o.paidAmount != null && o.paidAmount !== 0) r.paidAmount = o.paidAmount;
    if (o.paidMethod)  r.paidMethod = o.paidMethod;
    if (o.paidMethodDetail) r.paidMethodDetail = o.paidMethodDetail;
    if (o.paidAt)      r.paidAt     = o.paidAt;
    if (o.paidNote)    r.paidNote   = o.paidNote;
    if (o.discount)    r.discount   = o.discount;  // 할인 완납 금액
    if (o.isVoid)      r.isVoid     = true;         // 타인거래
    if (o.crmControlled) r.crmControlled = true; // CRM 결제 우선권 플래그
    const ua = _compactTs(o.updatedAt);
    if (ua)            r.updatedAt  = ua;
    return r;
}

/**
 * ★ CRM 우선권: 서버(Firebase)의 결제 필드를 로컬 order 객체에 병합
 * CRM이 기록한 isPaid/paidAmount/paidAt/paidMethod/paidMethodDetail/crmControlled는
 * 납품 앱이 절대 덮어쓰지 않는다.
 * 단, 납품 앱 자체에서 결제 처리한 경우(crmControlled 없음)는 로컬 값 유지.
 */
function _mergeCrmPaymentFields(localMinified, serverOrder) {
    if (!serverOrder) return;
    // crmControlled 플래그가 있을 때만 CRM 결제 필드 보존
    // — 이전 조건(serverOrder.isPaid && !localMinified.isPaid)은 납품앱 기기간
    //   결제 충돌 시 잘못 적용될 수 있어 제거
    if (serverOrder.crmControlled !== true) return;
    if (serverOrder.isPaid        != null) localMinified.isPaid        = serverOrder.isPaid;
    if (serverOrder.paidAmount    != null) localMinified.paidAmount    = serverOrder.paidAmount;
    if (serverOrder.paidAt)                localMinified.paidAt        = serverOrder.paidAt;
    if (serverOrder.paidMethod)            localMinified.paidMethod    = serverOrder.paidMethod;
    if (serverOrder.paidMethodDetail)      localMinified.paidMethodDetail = serverOrder.paidMethodDetail;
    localMinified.crmControlled = true; // 플래그 전파
}

function _minifyClient(c) {
    // isHidden: false(기본)는 생략, true일 때만 저장 (용량 절약)
    // memo → note 이관 완료 → 제거
    const r = {
        id: c.id,
        name: c.name,
    };
    const ca = _compactTs(c.createdAt);
    if (ca)          r.createdAt = ca;
    if (c.phone)     r.phone     = c.phone;
    if (c.address)   r.address   = c.address;
    if (c.note)      r.note      = c.note;
    if (c.isHidden)  r.isHidden  = true;   // true일 때만 저장 (false는 기본값이므로 생략)
    const ua = _compactTs(c.updatedAt);
    if (ua)          r.updatedAt = ua;
    return r;
}

// ④ prices 오래된 단가 정리: 최근 6개월 미사용 품목 제거
function _cleanPrices() {
    const cutoff = _kstMonthsAgo(6);
    const usedNames = new Set();
    for (const o of orders) {
        if (o.date >= cutoff) {
            for (const it of (o.items||[])) if (it.name) usedNames.add(it.name);
        }
    }
    const cleaned = {};
    for (const [k, v] of Object.entries(prices)) {
        if (usedNames.has(k)) cleaned[k] = v;
    }
    prices = cleaned;
}

// Firebase 연결 중 로컬 저장용 경량 전표 (완납+3개월 이상 제외 + 필드 최소화)

function _getLightOrders() {
    const cutoff = _kstMonthsAgo(3);
    // 완납+1개월 이상 전표는 items 배열 제거 (Firebase에서 복원 가능)
    const cutoff1m = _kstMonthsAgo(1);
    return orders
        .filter(o => !o.isPaid || o.date >= cutoff)
        .map(o => {
            const m = _minifyOrder(o);
            // 완납 + 1개월 초과: items 제거 (합계는 total로 유지)
            if (o.isPaid && o.date < cutoff1m) {
                delete m.items;
                m._noItems = 1; // 오프라인 시 UI에서 안내 표시용 플래그
            }
            return m;
        });
}

// Firebase 연결 중 로컬 저장용 경량 재고 (어제·오늘 이틀치 이력만 유지)

function _getLightStock() {
    return stockItems.map(si => ({
        ...si,
        log: _trimLogByDate(si.log)
    }));
}

// ── 백업 데이터 공통 정규화 함수 (importJSON & restoreBackup 공유) ──

function normalizeBackupData(data) {
    const imp_clients = toArray(data.clients);
    const imp_orders  = toArray(data.orders);

    const clients_out = imp_clients.map(c => {
        if (!c.id) c.id = _uid();
        c.id = String(c.id);                          // int id → string 타입 통일
        if (!c.note && c.memo) c.note = c.memo;       // 구버전 백업 호환 (memo → note)
        if (!c.note) c.note = '';
        if (c.isHidden === undefined) c.isHidden = false;
        return c;
    });

    const orders_out = imp_orders.map(o => {
        if (!o.id) o.id = _uid();
        o.id = String(o.id);                          // int id → string 타입 통일 (clients와 동일)
        if (o.clientId !== undefined) o.clientId = String(o.clientId); // int→string
        // totalAmount=0이지만 items 합계가 있으면 items 기준으로 복원
        const itemsSum = (o.items||[]).reduce((s,i) => s + Number(i.total ?? (i.qty*i.price) ?? 0), 0);
        o.total = Number(o.total ?? o.totalAmount ?? 0);
        if (o.total === 0 && itemsSum > 0) o.total = itemsSum;
        // totalAmount는 읽기 호환만 유지 — 신규 저장 시 생성 안 함
        if (!Array.isArray(o.items)) o.items = [];  // items 누락 방어
        // it.total 복원 (v41 이후 백업은 total 필드 없음 → qty×price로 복원)
        o.items = o.items.map(it => ({
            ...it,
            name: (it.name||'').trim(),
            total: it.total ?? (Number(it.qty)||0) * (Number(it.price)||0)
        }));
        if (!o.clientName && o.client) o.clientName = o.client;
        if (!o.note && o.memo) o.note = o.memo;       // 구버전 백업 호환 (memo → note)
        if (!o.note) o.note = '';
        if (!o.isVoid) o.isVoid = false;              // isVoid 복원 (없으면 false)
        return o;
    });

    // clientId가 없는 전표는 clientName으로 재매핑
    // clientId가 있는 전표는 현재 거래처명과 다를 경우 자동 보정 (거래처명 변경 후 미반영 복구)
    const clientIdSet = new Set(clients_out.map(c => c.id));
    const clientIdMap  = {};
    clients_out.forEach(c => { clientIdMap[c.id] = c; });
    orders_out.forEach(o => {
        if (!o.clientId || !clientIdSet.has(o.clientId)) {
            const found = clients_out.find(c => c.name === (o.clientName || '').trim());
            if (found) { o.clientId = found.id; o.clientName = found.name; }
        } else {
            // clientId 일치하는 거래처가 있으면 이름을 현재 거래처명으로 보정
            const linked = clientIdMap[o.clientId];
            if (linked && linked.name !== o.clientName) {
                o.clientName = linked.name;
            }
        }
    });

    const stock_out = toArray(data.stockItems || data.stock || []).map(si => si ? {
        id: si.id || _uid(), name: si.name || '', qty: Number(si.qty ?? 0),
        unit: si.unit || '개', low: Number(si.low ?? 10), danger: Number(si.danger ?? 3),
        note: si.note || '', log: Array.isArray(si.log) ? si.log : [],
        updatedAt: si.updatedAt || new Date().toISOString()
    } : null).filter(Boolean);
    return { clients: clients_out, orders: orders_out, stockItems: stock_out };
}

const debouncedSync = debounce(async () => {
    if (!workspaceRef || !isConnected) return;  // 오프라인이거나 미연결 시 즉시 중단
    const ch = dataHash(clients);
    const oh = dataHash(orders);
    const ph = dataHash(prices);
    const sh = dataHash(stockItems);
    let changed = false;
    const updates = {};
    if (ch !== lastHash.clients) { updates.clients    = clients.map(_minifyClient); changed = true; }
    if (oh !== lastHash.orders)  {
        const _nd = _dirtyOrders.size + _deletedOrders.size;
        if (_nd > 0 && _nd < 20) {
            // delta: 변경된 항목만 개별 경로 업로드
            // ★ CRM 우선권: 서버의 결제 필드를 읽어 merge 후 업로드
            const serverSnap = await workspaceRef.child('orders').once('value').catch(() => null);
            const serverOrders = serverSnap ? serverSnap.val() : {};
            for (const id of _dirtyOrders) {
                const o = orders.find(x => x.id === id);
                if (!o) continue;
                const m = _minifyOrder(o);
                const sv = serverOrders ? serverOrders[id] : null;
                if (sv) _mergeCrmPaymentFields(m, sv); // CRM 결제 필드 보존
                updates[`orders/${id}`] = m;
            }
            for (const id of _deletedOrders) { updates[`orders/${id}`] = null; }
        } else {
            // full: bulk 작업·첫 동기화 시 전체 map 업로드
            // ★ CRM 우선권: 서버 결제 필드를 먼저 읽어 merge
            const serverSnap2 = await workspaceRef.child('orders').once('value').catch(() => null);
            const serverOrders2 = serverSnap2 ? serverSnap2.val() : {};
            const ordersMap = {};
            orders.forEach(o => {
                const m = _minifyOrder(o);
                if (serverOrders2 && serverOrders2[o.id]) _mergeCrmPaymentFields(m, serverOrders2[o.id]);
                ordersMap[o.id] = m;
            });
            updates.orders = ordersMap;
        }
        changed = true;
    }
    if (ph !== lastHash.prices)  { updates.prices     = prices;     changed = true; }
    if (sh !== lastHash.stock)   { updates.stockItems = _getLightStock(); changed = true; }
    if (!changed) return;
    // writtenBy를 데이터와 함께 업로드 — 리스너가 자기 업데이트를 정확히 무시하도록
    updates.lastUpdated = new Date().toISOString();
    updates.writtenBy   = SESSION_ID;
    // ★ Problem 3 수정: 업로드 전에 dirty set을 스냅샷으로 복사해 두고
    //   실패 시 해당 id들을 다시 dirty로 복원 → 재시도 시 누락 방지
    const dirtySnap   = new Set(_dirtyOrders);
    const deletedSnap = new Set(_deletedOrders);
    // ★ Problem 2 수정: 업로드 진행 중에는 리스너가 echo를 덮어쓰지 못하도록 가드 설정
    _syncGuard = true;
    // ★ 업로드 직전 lastHash 선점 갱신 → 리스너 echo 수신 시 hash 일치로 무시
    if (updates.clients)    lastHash.clients = ch;
    if (updates.orders)     lastHash.orders  = oh;
    if (updates.prices)     lastHash.prices  = ph;
    if (updates.stockItems) lastHash.stock   = sh;
    setSyncStatus('syncing');
    workspaceRef.update(updates)
        .then(() => {
            _clearOrderDelta(); // 성공 시 delta 추적 초기화
            _syncGuard = false;
            setSyncStatus('online');
            // ★ 업로드 중 보류됐던 타기기 변경 처리
            if (_pendingFbSnap) { const s = _pendingFbSnap; _pendingFbSnap = null; _fbValueHandler(s); }
        })
        .catch(e => {
            // 실패 시 lastHash 롤백 → 다음 saveData() 때 재시도
            if (updates.clients)    lastHash.clients = '';
            if (updates.orders)     lastHash.orders  = '';
            if (updates.prices)     lastHash.prices  = '';
            if (updates.stockItems) lastHash.stock   = '';
            // ★ Problem 3 수정: 스냅샷된 dirty/deleted id 복원
            dirtySnap.forEach(id   => _dirtyOrders.add(id));
            deletedSnap.forEach(id => _deletedOrders.add(id));
            _syncGuard = false;
            console.error('동기화 실패:', e);
            setSyncStatus('error');
            // ★ 업로드 실패해도 보류됐던 타기기 변경 처리
            if (_pendingFbSnap) { const s = _pendingFbSnap; _pendingFbSnap = null; _fbValueHandler(s); }
        });
}, 800);

// ─── 금액 입력 필드 콤마 자동 포매터 ───────────────────────────────────────
// 금액 필드: itemPrice / ppAmount / ppTransferAmt / ppCashAmt
//           peAmount / oeditNewPrice / qpDiscountAmt

/** 금액 input 엘리먼트에 콤마 포매팅 초기화 */
function _initMoneyInput(el) {
    if (!el || el.dataset.moneyInited) return;
    el.dataset.moneyInited = '1';

    // el을 클로저로 직접 참조 (this 바인딩 문제 방지)
    function applyFormat() {
        const raw = el.value.replace(/[^0-9]/g, '');
        if (!raw) { el.value = ''; return; }
        const formatted = Number(raw).toLocaleString('ko-KR');
        if (el.value !== formatted) {
            el.value = formatted;
            try { el.setSelectionRange(formatted.length, formatted.length); } catch(e) {}
        }
    }

    // input: 일반 입력 / keyup: 안드로이드 IME 누락 보완 / change: 포커스 아웃 시 최종 보정
    el.addEventListener('input',  applyFormat);
    el.addEventListener('keyup',  applyFormat);
    el.addEventListener('change', applyFormat);

    el.addEventListener('focus', function () {
        setTimeout(() => { try { el.select(); } catch(e) {} }, 0);
    });
}

/** data-money 속성 가진 모든 필드에 일괄 초기화 */
function _initAllMoneyInputs() {
    document.querySelectorAll('[data-money]').forEach(_initMoneyInput);
}

/** 금액 input에서 순수 숫자 추출 */
function _moneyVal(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    return parseInt(el.value.replace(/[^0-9]/g, ''), 10) || 0;
}

/** 금액 input에 숫자를 콤마 포맷으로 세팅 */
function _setMoneyVal(id, num) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (num > 0) ? Number(num).toLocaleString('ko-KR') : '';
}

// ─── settlement / stock / unpaid 탭 조건부 즉시 렌더 헬퍼 ───
// 각 함수에서 반복되던 동일 패턴을 하나로 통합
function _refreshSettlementIfActive() {
    _markDirty('settlement');
    if (document.getElementById('pane-settlement')?.classList.contains('active')) {
        _dirty['settlement'] = false;
        if (settleUnit === 'monthly')   renderSettlement();
        if (settleUnit === 'daily')     renderSettlementDaily();
        if (settleUnit === 'quarterly') renderSettlementQuarterly();
    }
}
function _refreshStockIfActive() {
    _markDirty('stock');
    if (document.getElementById('pane-stock')?.classList.contains('active')) {
        renderStock(); _dirty['stock'] = false;
    }
}
function _refreshUnpaidIfActive() {
    if (document.getElementById('pane-unpaid')?.classList.contains('active')) renderUnpaid();
}

// ─── 메모 즉시 동기화 헬퍼 (메모 저장/삭제 공통 패턴) ───
function _saveAndFlush() {
    saveData();
    debouncedSync.cancel();
    _flushSync();
    saveToLocal();
}

function saveData() {
    invalidateOrdersCache();
    _localWriteTime = Date.now();
    localStorage.setItem('lastLocalUpdated', new Date().toISOString()); // 로컬 변경 시각 기록
    saveToLocal();
    if (isConnected) debouncedSync();
    _markDirty('dashboard','clients','unpaid','delivery','history','settlement','settings');
    _renderActiveIfDirty();
}

