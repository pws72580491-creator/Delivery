// ╔══════════════════════════════════════════════════════════════╗
// ║  § 5  UI 코어 — toast · 테마 · 탭 · 모달 · 바텀네비                     ║
// ╚══════════════════════════════════════════════════════════════╝

// ╔══════════════════════════════════════════════════════════════╗
// ║  § 4  부분 렌더링 엔진                                              ║
// ╚══════════════════════════════════════════════════════════════╝
// ════════════════════════════════════════════════════════════════
// 탭별 더티 플래그: true = 데이터 변경됨 → 탭 진입 시 렌더링 실행
// 불필요한 DOM 재계산·페인트 제거
// Firebase 동기화 콜백(_fullRender)은 전체 더티 → 현재 탭만 즉시 렌더
// ────────────────────────────────────────────────────────────────
const _dirty = {
    dashboard:  true,
    clients:    true,
    delivery:   true,
    history:    true,
    stock:      true,
    settlement: true,
    unpaid:     true,
    // backup·settings 는 _dirty 미포함 → 탭 진입 시 항상 렌더
};

// 하나 이상의 탭을 더티 마킹 (인수 없으면 전체 더티)
function _markDirty(...tabs) {
    const keys = tabs.length ? tabs : Object.keys(_dirty);
    keys.forEach(t => { if (t in _dirty) _dirty[t] = true; });
}

// 탭 이름으로 렌더링 실행
function _renderTab(name) {
    if      (name === 'dashboard') {
        renderDashboard();
    } else if (name === 'clients') {
        const cl = document.getElementById('clientList');
        const tb = document.getElementById('clientToggleBtn');
        if (cl) cl.style.display = clientListVisible ? 'block' : 'none';
        if (tb) tb.textContent   = clientListVisible ? '숨기기' : '보이기';
        renderClients();
    } else if (name === 'delivery') {
        updateItemDatalist();
        renderTempGroups();
    } else if (name === 'history') {
        renderOrders();
    } else if (name === 'stock') {
        applyAutoDeductUI();
        checkEggInitBanner();
        renderStock();
    } else if (name === 'settlement') {
        const st = document.getElementById('settlementTable');
        const sb = document.getElementById('settleToggleBtn');
        if (st) st.style.display = settleListVisible ? 'block' : 'none';
        if (sb) sb.textContent   = settleListVisible ? '숨기기' : '보이기';
        if (settleUnit === 'monthly')   renderSettlement();
        if (settleUnit === 'daily')     renderSettlementDaily();
        if (settleUnit === 'quarterly') renderSettlementQuarterly();
    } else if (name === 'unpaid') {
        renderUnpaid();
    } else if (name === 'backup') {
        renderBackupTab();
    } else if (name === 'settings') {
        updateInfoCounts();
        setTimeout(updateStorageBar, 100);
    }
}

// 현재 활성 탭이 더티면 즉시 렌더 (_dirty 미포함 탭은 항상 렌더)
function _renderActiveIfDirty() {
    const active = document.querySelector('.pane.active')
                   ?.id?.replace('pane-', '') || 'dashboard';
    const isDirty = !(active in _dirty) || _dirty[active];
    if (!isDirty) return;
    _renderTab(active);
    if (active in _dirty) _dirty[active] = false;
}

// ★ v114: toast 큐 시스템 — 동시에 여러 메시지가 와도 순서대로 표시
const _toastQueue = [];
let _toastBusy = false;

function toast(msg, color, duration) {
    _toastQueue.push({ msg, color, duration });
    if (!_toastBusy) _toastNext();
}

function _toastNext() {
    if (!_toastQueue.length) { _toastBusy = false; return; }
    _toastBusy = true;
    const { msg, color, duration } = _toastQueue.shift();
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.borderColor = color || 'var(--border)';
    el.classList.add('show');
    const showMs = duration || 2400;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
        el.classList.remove('show');
        // 사라지는 애니메이션(280ms) 후 다음 항목 표시
        setTimeout(_toastNext, 300);
    }, showMs);
}

// ─── 테마 ───

function applyTheme() {
    // 레거시 darkMode 키 마이그레이션
    const legacyDark = localStorage.getItem('darkMode');
    if (legacyDark !== null && localStorage.getItem('theme') === null) {
        if (legacyDark === '0') localStorage.setItem('theme', 'light');
        // darkMode='1'은 기본(dark)이므로 별도 설정 불필요
    }
    const theme = localStorage.getItem('theme');
    const isLight = theme === 'light';
    const isDarkOverride = theme === 'dark';
    document.body.classList.toggle('light', isLight);
    // OS가 라이트모드일 때 사용자가 다크를 명시 선택한 경우 CSS 미디어쿼리 충돌 방지
    document.body.classList.toggle('theme-override-dark', isDarkOverride);
    document.getElementById('themeBtn').textContent = isLight ? '🌙' : '☀️';
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    // 다크 선택 시 OS 라이트모드 CSS 미디어쿼리 충돌 방지 클래스 토글
    document.body.classList.toggle('theme-override-dark', !isLight);
    document.getElementById('themeBtn').textContent = isLight ? '🌙' : '☀️';
}

// ─── 탭 ───

function showTab(name) {
    document.querySelectorAll('.tab, .pane').forEach(el => el.classList.remove('active'));
    const tab  = document.querySelector(`.tab[data-tab="${name}"]`);
    const pane = document.getElementById('pane-' + name);
    if (tab)  { tab.classList.add('active'); tab.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'}); }
    if (pane) pane.classList.add('active');
    const content = document.getElementById('mainContent');
    if (content) content.scrollTop = 0;

    // ── 탭별 UI 상태 동기화 (렌더링과 별개) ──────────────────────
    if (name === 'delivery') {
        const dInput = document.getElementById('deliveryDate');
        if (!dInput.value || dInput.value < todayKST()) dInput.value = todayKST();
        // ★ v115: 납품 탭 진입 시 거래처 검색창 자동 포커스 → 키보드 즉시 표시
        // delivery 탭이 여전히 활성 상태일 때만 포커스 (submitOrder 후 history 탭 전환 시 오작동 방지)
        setTimeout(() => {
            const cl = document.getElementById('deliveryClient');
            if (cl && document.getElementById('pane-delivery')?.classList.contains('active')) cl.focus();
        }, 150);
    }
    if (name === 'history') {
        initHistPeriod();
        document.querySelectorAll('#pane-history .sort-btn').forEach(b => {
            b.classList.toggle('active',
                b.id === 'histSort' + histSortMode.charAt(0).toUpperCase() + histSortMode.slice(1));
        });
    }
    if (name === 'clients') {
        const cl = document.getElementById('clientList');
        const tb = document.getElementById('clientToggleBtn');
        if (cl) cl.style.display = clientListVisible ? 'block' : 'none';
        if (tb) tb.textContent   = clientListVisible ? '숨기기' : '보이기';
    }
    if (name === 'settlement') {
        const st = document.getElementById('settlementTable');
        const sb = document.getElementById('settleToggleBtn');
        if (st) st.style.display = settleListVisible ? 'block' : 'none';
        if (sb) sb.textContent   = settleListVisible ? '숨기기' : '보이기';
    }
    if (name === 'stock') {
        const sdInput = document.getElementById('stockViewDate');
        if (sdInput) {
            sdInput.min = kstAddDays(todayKST(), -1); // 로그 보관 한계(어제) 이전 선택 차단
            if (!sdInput.value) sdInput.value = todayKST();
        }
        refreshStockCarryover(true);  // 재고 이월은 정합성상 항상 실행
        // refreshStockCarryover가 항상 renderStock()을 호출하므로 dirty 해제
        _dirty['stock'] = false;
    }

    // ── 더티 플래그 체크 → 변경 있을 때만 렌더링 ─────────────────
    // _dirty 미포함 탭(backup, settings)은 항상 렌더
    if (!(name in _dirty) || _dirty[name] !== false) {
        _renderTab(name);
        if (name in _dirty) _dirty[name] = false;
    }
}

function initTabs() {
    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
}

// ─── 모달 열기/닫기 (뒤로가기 버튼 지원 포함) ───
let _modalHistoryPushed = false;

const _MODAL_IDS = [
    'payEditModal','partialPayModal',
    'firebaseModal','detailModal','statementModal',
    'clientEditModal','orderEditModal',
    'stockEditModal','stockAdjModal','stockLogModal',
    'bulkPayPopup','deliveryConfirmPopup',
    'customConfirmModal','deadQueueModal' // ★ v114
];

function _anyModalOpen() {
    return _MODAL_IDS.some(id => document.getElementById(id)?.classList.contains('open'));
}

function openModal(id)  {
    const el = document.getElementById(id);
    el.classList.add('open');
    // 모달 시트 스크롤 항상 맨 위로 초기화
    const sheet = el.querySelector('.modal-sheet');
    if (sheet) sheet.scrollTop = 0;
    if (id === 'firebaseModal') { applyWsLockUI(); renderSharedWsList(); }
    if (!_modalHistoryPushed) {
        history.pushState({ modalOpen: true }, '');
        _modalHistoryPushed = true;
    }
    // 모달 내 금액 필드 콤마 포매터 초기화 (동적 생성 필드 대비)
    el.querySelectorAll('[data-money]').forEach(_initMoneyInput);
}

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    if (!_anyModalOpen()) _modalHistoryPushed = false;
}

// 브라우저/안드로이드 이전(뒤로가기) 버튼 → 최상위 모달 닫기
window.addEventListener('popstate', () => {
    _modalHistoryPushed = false;
    // 메모 상세 팝업 (더 안쪽 레이어이므로 먼저 처리)
    if (document.getElementById('memoDetailPopup')?.classList.contains('open')) { closeMemoDetail(); return; }
    // 메모 모아보기 팝업
    if (document.getElementById('memoViewPopup')?.classList.contains('open'))   { closeMemoView();   return; }
    // 더보기 시트
    if (document.getElementById('moreSheetOverlay')?.classList.contains('open')) { closeMoreSheet(); return; }
    // 퀵페이 팝업류 전용 처리
    if (document.getElementById('bulkPayPopup')?.classList.contains('open'))      { closeBulkPayPopup(); return; }
    if (document.getElementById('deliveryConfirmPopup')?.classList.contains('open')) { closeDeliveryConfirm(); return; }
    if (document.getElementById('quickPayPopup')?.classList.contains('open'))     { closeQuickPay(); return; }
    for (const id of _MODAL_IDS) {
        const el = document.getElementById(id);
        if (el?.classList.contains('open')) {
            el.classList.remove('open');
            if (_anyModalOpen()) {
                history.pushState({ modalOpen: true }, '');
                _modalHistoryPushed = true;
            }
            return;
        }
    }
    history.back();
});

// 모달 외부 클릭 닫기 + 드롭다운 외부 클릭 닫기 (통합 핸들러)
document.addEventListener('click', e => {
    // 모달 오버레이 직접 클릭 시 닫기
    ['firebaseModal','detailModal','statementModal','partialPayModal','payEditModal','clientEditModal','orderEditModal','stockEditModal','stockAdjModal','stockLogModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el && e.target === el) closeModal(id);
    });
    // 납품 거래처 드롭다운 외부 클릭 시 닫기
    if (!e.target.closest('#deliveryClient') && !e.target.closest('#clientDropdown'))
        document.getElementById('clientDropdown')?.classList.remove('open');
    // 거래처 카드 툴팁 외부 클릭 시 닫기
    if (!e.target.closest('.client-card'))
        document.querySelectorAll('.client-card.show-tooltip').forEach(el => el.classList.remove('show-tooltip'));
});

// ─── 바텀 네비 ───

function bnavGo(tab, btnEl) {
    showTab(tab);
    // 바텀 네비 active 상태 업데이트
    updateBnavActive(tab);
    // 햅틱 피드백
    if (navigator.vibrate) navigator.vibrate(8);
}

function updateBnavActive(tab) {
    document.querySelectorAll('.bnav-item[data-tab]').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    // 더보기에 속한 탭이면 더보기 버튼 하이라이트
    const moreTabs = ['stock','settlement','backup','settings'];
    const moreBtn = document.querySelector('.bnav-item[data-tab="_more"]');
    if (moreBtn) moreBtn.classList.toggle('active', moreTabs.includes(tab));
}

function openMoreSheet() {
    const overlay = document.getElementById('moreSheetOverlay');
    overlay.classList.add('open');
    // 현재 탭 표시
    const activePane = document.querySelector('.pane.active');
    const currentTab = activePane?.id?.replace('pane-', '') || '';
    overlay.querySelectorAll('.more-item').forEach(item => {
        const tabName = item.getAttribute('onclick')?.match(/bnavGo\('(\w+)'/)?.[1];
        item.style.borderColor = tabName === currentTab ? 'var(--accent)' : 'var(--border)';
        item.style.color = tabName === currentTab ? 'var(--accent)' : '';
    });
    if (navigator.vibrate) navigator.vibrate(6);
    if (!_modalHistoryPushed) {
        history.pushState({ modalOpen: true }, '');
        _modalHistoryPushed = true;
    }
}

function closeMoreSheet() {
    document.getElementById('moreSheetOverlay').classList.remove('open');
}

// showTab 호출 시 바텀 네비 자동 동기화
showTab = _safeWrap(showTab, function(name) { updateBnavActive(name); });

// ─── 미수금 배지 업데이트 ───

function updateNavBadges() {
    // _clientStatsCache 활용 — orders 단일 순회로 모두 계산
    let unpaidCount = 0, totalUnpaid = 0, unpaidOrderCount = 0;
    const seen = new Set();
    for (const o of orders) {
        if (!o.isPaid) {
            unpaidOrderCount++;
            totalUnpaid += Math.max(0, o.total - (o.paidAmount || 0));
            seen.add(o.clientId || o.clientName);
        }
    }
    unpaidCount = seen.size;

    // 거래처 배지
    const bc = document.getElementById('bnavBadgeClients');
    if (bc) {
        if (unpaidCount > 0) {
            bc.textContent = unpaidCount > 99 ? '99+' : unpaidCount;
            bc.classList.add('visible');
        } else {
            bc.classList.remove('visible');
        }
    }
    // 내역 배지 (미수금 전표 수)
    const bh = document.getElementById('bnavBadgeHistory');
    if (bh) {
        if (unpaidOrderCount > 0) {
            bh.textContent = unpaidOrderCount > 99 ? '99+' : unpaidOrderCount;
            bh.classList.add('visible');
        } else {
            bh.classList.remove('visible');
        }
    }

    // 거래처 탭 미수금 알림 바
    const alertBar = document.getElementById('unpaidAlertBar');
    const alertSub = document.getElementById('unpaidAlertSub');
    if (alertBar && alertSub) {
        if (unpaidCount > 0) {
            alertBar.classList.add('visible');
            alertSub.textContent = `미수 거래처 ${unpaidCount}곳 · 총 ${fmt(totalUnpaid)}원`;
        } else {
            alertBar.classList.remove('visible');
        }
    }
    // 미수 탭 배지
    const bu = document.querySelector('.tab[data-tab="unpaid"]');
    if (bu) {
        bu.style.position = 'relative';
        let badgeEl = bu.querySelector('.tab-badge');
        if (!badgeEl) {
            badgeEl = document.createElement('span');
            badgeEl.className = 'tab-badge';
            badgeEl.style.cssText = 'position:absolute;top:2px;right:2px;min-width:14px;height:14px;line-height:14px;padding:0 3px;border-radius:7px;background:#ef4444;color:#fff;font-size:9px;font-weight:900;text-align:center;';
            bu.appendChild(badgeEl);
        }
        if (unpaidCount > 0) {
            badgeEl.textContent = unpaidCount > 99 ? '99+' : unpaidCount;
            badgeEl.style.display = 'block';
        } else {
            badgeEl.style.display = 'none';
        }
    }
}

