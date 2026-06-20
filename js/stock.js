// ╔══════════════════════════════════════════════════════════════╗
// ║  § 11  재고 관리                                                  ║
// ╚══════════════════════════════════════════════════════════════╝

function normStock(s) {
    if (!s) return null;
    const log = Array.isArray(s.log) ? s.log : [];
    // qty 보정: log가 있으면 가장 최근 log의 after 값을 신뢰
    // (Firebase 동기화 충돌로 qty 필드가 오래된 값으로 덮어써질 때 방지)
    // 단, after 값이 명확히 정의된 로그 항목만 신뢰 (after가 null/undefined인 오래된 항목 제외)
    let qty = Number(s.qty ?? 0);
    if (log.length > 0) {
        // log는 최신순(unshift) 정렬 — at 타임스탬프 기준으로 가장 최근 것 선택
        const validLogs = log.filter(l => l.at && l.after !== undefined && l.after !== null && !isNaN(Number(l.after)));
        if (validLogs.length > 0) {
            const latest = validLogs.reduce((a, b) => {
                const ta = new Date(a.at).getTime();
                const tb = new Date(b.at).getTime();
                return tb > ta ? b : a;
            });
            qty = Number(latest.after);
        }
    }
    return {
        id:      s.id      || _uid(),
        name:    s.name    || '',
        qty,
        unit:    s.unit    || '개',
        low:     Number(s.low    ?? 10),
        danger:  Number(s.danger ?? 3),
        note:    s.note    || '',
        log,
        lastCarryDate: s.lastCarryDate || '',   // 이월 중복 방지: Firebase 동기화 후에도 유지
        updatedAt: s.updatedAt || new Date().toISOString()
    };
}

// 재고 상태 등급

function stockLevel(si) {
    if (si.qty <= si.danger) return 'danger';
    if (si.qty <= si.low)    return 'low';
    return 'ok';
}

// ─── 재고 날짜 조회 상태 ───
let stockViewDate = ''; // '' = 오늘, 'YYYY-MM-DD' = 과거 조회

// 특정 날짜 기준으로 재고량 역산

function getStockAtDate(si, targetDateStr) {
    if (!targetDateStr || targetDateStr >= todayKST()) return si.qty;
    const endOfTargetUTC = new Date(targetDateStr + 'T23:59:59+09:00').getTime();
    const logs = (si.log || [])
        .filter(l => l.at && l.after !== undefined && l.after !== null)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    // 대상 날짜 이전 or 당일의 가장 최근 로그 찾기
    const prevLog = logs.find(l => new Date(l.at).getTime() <= endOfTargetUTC);
    if (prevLog) {
        return Number(prevLog.after);
    }

    // 모든 로그가 대상 날짜 이후 → 전부 되돌려서 초기값 추산
    let stock = si.qty;
    for (const l of logs) {
        stock -= (Number(l.qty) || 0);
    }
    return Math.max(0, stock);
}

// 특정 날짜의 입고/출고 합산

function getInOutAtDate(si, targetDateStr) {
    if (!targetDateStr) return getTodayInOut(si);
    const startUTC = new Date(targetDateStr + 'T00:00:00+09:00').getTime();
    const endUTC   = new Date(targetDateStr + 'T23:59:59+09:00').getTime();
    const dayLogs  = (si.log || []).filter(l => {
        if (l.type === 'auto') return l.date === targetDateStr; // 납품차감은 납품날짜 기준
        const t = l.at ? new Date(l.at).getTime() : 0;
        return t >= startUTC && t <= endUTC;
    });
    const inQty  = dayLogs.filter(l => l.type === 'in').reduce((s, l) => s + Math.abs(l.qty), 0);
    const restoreQty = dayLogs.filter(l => (l.type === 'restore' && (l.originalDate || l.date) === targetDateStr)
                                        || (l.type === 'edit_adj' && (l.qty||0) > 0)).reduce((s, l) => s + Math.abs(l.qty), 0);
    const logOutQty = Math.max(0, dayLogs.filter(l => l.type === 'out' || l.type === 'auto' || (l.type === 'edit_adj' && l.qty < 0)).reduce((s, l) => s + Math.abs(l.qty), 0) - restoreQty);
    const outQty = logOutQty;
    return { inQty, outQty, logOutQty };
}

// "이전재고" (대상 날짜 기준 전날 마감)

function getPrevStockAtDate(si, targetDateStr) {
    if (!targetDateStr || targetDateStr >= todayKST()) {
        return getYesterdayClosingQty(si);
    }
    const prevDate = kstAddDays(targetDateStr, -1);
    const qty = getStockAtDate(si, prevDate);
    return { qty, date: prevDate };
}

function onStockDateChange(val) {
    const today = todayKST();
    const minDate = kstAddDays(today, -1); // 재고 로그 보관 한계(어제) — 그 이전은 정확한 조회 불가
    if (val && val < minDate) {
        toast('❗ 재고 이력은 어제까지만 정확히 조회됩니다', 'var(--orange)');
        val = minDate;
        document.getElementById('stockViewDate').value = minDate;
    }
    if (!val || val >= today) {
        // 오늘이거나 미래면 오늘 모드
        stockViewDate = '';
        document.getElementById('stockViewDate').value = today;
        document.getElementById('stockHistoryBanner').classList.remove('visible');
    } else {
        stockViewDate = val;
        const sub = document.getElementById('stockHistoryBannerSub');
        if (sub) sub.textContent = val + ' 기준 재고 (읽기 전용 · 실제 데이터 변경 없음)';
        document.getElementById('stockHistoryBanner').classList.add('visible');
    }
    renderStock();
}

function resetStockToToday() {
    stockViewDate = '';
    const input = document.getElementById('stockViewDate');
    input.value = todayKST();
    input.min   = kstAddDays(todayKST(), -1);
    document.getElementById('stockHistoryBanner').classList.remove('visible');
    renderStock();
}

function stockDateNav(delta) {
    const input = document.getElementById('stockViewDate');
    const cur = input.value || todayKST();
    const next = kstAddDays(cur, delta);
    if (next > todayKST()) return; // 미래 날짜 이동 방지
    if (next < kstAddDays(todayKST(), -1)) return; // 재고 로그는 어제·오늘만 보관 — 그 이전은 부정확하므로 이동 차단
    input.value = next;
    onStockDateChange(next);
}

// ─── 재고 목록 렌더 (사진 스타일 테이블 카드) ───
// 오늘 하루 동안의 입고/출고 합산
// - 재고 로그(in/out/auto/edit_adj) 기반
// - 자동차감 OFF일 때도 납품 전표의 출고 수량을 출고 칸에 표시 (재고 수치는 변경 없음)

function getTodayInOut(si) {
    const today = todayKST();
    const todayStartUTC    = new Date(today + 'T00:00:00+09:00').getTime();
    const tomorrowStartUTC = todayStartUTC + 86400000;
    const todayLogs = (si.log || []).filter(l => {
        if (l.type === 'auto') return l.date === today; // 납품차감은 납품날짜 기준
        const t = l.at ? new Date(l.at).getTime() : 0;
        return t >= todayStartUTC && t < tomorrowStartUTC;
    });
    // 입고: type=in (carryover는 이전재고 이월이므로 입고로 보지 않음)
    const inQty = todayLogs
        .filter(l => l.type === 'in')
        .reduce((s, l) => s + Math.abs(l.qty), 0);
    // 출고 상쇄: 납품삭제복구(restore) + 납품수정보정 증가(edit_adj>0)
    // restore는 originalDate가 오늘인 것만 상쇄 (이전 날짜 전표 삭제는 오늘 출고에 영향 없음)
    const restoreQty = todayLogs
        .filter(l => (l.type === 'restore' && (l.originalDate || l.date) === today)
                  || (l.type === 'edit_adj' && (l.qty||0) > 0))
        .reduce((s, l) => s + Math.abs(l.qty), 0);
    // 출고: type=out(수동), auto(납품차감), edit_adj(수정보정 감소)
    const logOutQty = Math.max(0, todayLogs
        .filter(l => l.type === 'out' || l.type === 'auto' || (l.type === 'edit_adj' && l.qty < 0))
        .reduce((s, l) => s + Math.abs(l.qty), 0) - restoreQty);
    let outQty = logOutQty;

    // 자동차감 OFF일 때: 납품 전표 기반 출고 수량도 출고 칸에 표시 (표시 전용, 재고 변경 없음)
    // ※ 이력이 전혀 없는 품목은 재고 관리 미시작 상태이므로 표시하지 않음
    if (!stockAutoDeduct && (si.log || []).length > 0) {
        const deliveryOut = orders
            .filter(o => o.date === today && !o.isVoid)
            .flatMap(o => o.items || [])
            .filter(item => normItemName(item.name) === normItemName(si.name))
            .reduce((sum, item) => sum + Number(item.qty || 0), 0);
        outQty += deliveryOut;
    }

    return { inQty, outQty, logOutQty };
}

function _egCardHTML(si) {
    const isHistory = !!(stockViewDate && stockViewDate < todayKST());
    // ── 날짜별 재고 계산 ──
    const displayQty = isHistory ? getStockAtDate(si, stockViewDate) : si.qty;
    const prevData   = isHistory
        ? getPrevStockAtDate(si, stockViewDate)
        : getYesterdayClosingQty(si);
    // 임시 si 복사본으로 level 계산 (과거 조회 시 과거 수량 기준)
    const siSnap = isHistory ? { ...si, qty: displayQty } : si;
    const lv     = stockLevel(siSnap);

    const { inQty, outQty, logOutQty } = isHistory
        ? getInOutAtDate(si, stockViewDate)
        : getTodayInOut(si);
    // 이전재고: 로그 이력이 있으면 로그 기반, 없으면 현재재고에서 오늘 입출고 역산
    // ※ autoDeduct OFF 시 deliveryOut은 표시용이므로 logOutQty(로그 기반)만 역산에 사용
    const _outForPrev = isHistory ? outQty : (logOutQty ?? outQty);
    const prevQty = (prevData && !prevData.isCurrent)
        ? prevData.qty
        : (isHistory
            ? getStockAtDate(si, kstAddDays(stockViewDate, -1))
            : (inQty > 0 || _outForPrev > 0)
                ? si.qty - inQty + _outForPrev   // 오늘 입출고가 있을 때만 역산
                : si.qty);                  // 오늘 입출고가 전혀 없으면 현재값 = 이전값

    const id     = si.id;
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g,'_');
    const histClass = isHistory ? ' history-mode' : '';
    const histLabel = isHistory ? `<span class="eg-history-badge">과거</span>` : '';

    const currLabel = isHistory ? `${stockViewDate} 재고` : '현재재고';

    return `<div class="eg-card level-${lv}${histClass}" id="egcard-${safeId}" data-sid="${id}">
  <!-- 헤더: 품목명 -->
  <div class="eg-header">
    <div class="eg-name">
      <span class="eg-status-dot"></span>
      ${escapeHtml(si.name)}${histLabel}
    </div>
    <div class="eg-header-right">
      ${si.note ? `<span class="eg-note">${escapeHtml(si.note)}</span>` : ''}
      <button class="eg-menu-btn" onclick="openAdj('${id}')" title="재고 조정">⚖️</button>
    </div>
  </div>
  <!-- 4칸 테이블: 이전재고 | 입고 | 출고 | 현재/과거재고 -->
  <div class="eg-table">
    <div class="eg-col col-prev">
      <div class="eg-col-label">이전재고</div>
      <div class="eg-col-val">${prevQty !== undefined ? fmt(prevQty) : '—'}</div>
      <div class="eg-col-unit">${si.unit}</div>
    </div>
    <div class="eg-col col-in" id="egcol-in-${safeId}">
      <div class="eg-col-label">📥 입고</div>
      <div class="eg-col-val">${inQty > 0 ? '+'+fmt(inQty) : '—'}</div>
      <div class="eg-col-unit">${si.unit}</div>
    </div>
    <div class="eg-col col-out" id="egcol-out-${safeId}">
      <div class="eg-col-label">📤 출고</div>
      <div class="eg-col-val">${outQty > 0 ? '-'+fmt(outQty) : '—'}</div>
      <div class="eg-col-unit">${si.unit}</div>
    </div>
    <div class="eg-col col-curr lv-${lv}">
      <div class="eg-col-label">${currLabel}</div>
      <div class="eg-col-val">${fmt(displayQty)}</div>
      <div class="eg-col-unit">${si.unit}</div>
    </div>
  </div>
  <!-- 빠른 입고/출고 바 (과거 조회 모드에서는 비활성) -->
  ${isHistory || !stockAutoDeduct ? '' : `<div class="eg-quick-bar" id="eg-qbar-${safeId}">
    <span class="eg-quick-label" id="eg-qlabel-${safeId}">입고</span>
    <input type="number" class="eg-quick-input" id="eg-qinput-${safeId}" placeholder="수량" min="1"
      onkeydown="if(event.key==='Enter')egQuickConfirm('${id}')"
      style="flex:1;">
    <button class="eg-quick-confirm in-type" id="eg-qconfirm-${safeId}" onclick="egQuickConfirm('${id}')">확인</button>
    <button class="eg-quick-cancel" onclick="egQuickClose('${id}')">✕</button>
  </div>`}
  <!-- 액션 버튼 -->
  <div class="eg-actions">
    ${isHistory ? `<div style="flex:1;text-align:center;font-size:11px;color:var(--orange);padding:8px;font-weight:700;">
      🕐 ${stockViewDate} 기준 조회 (읽기 전용)</div>
      <button class="eg-act-btn btn-log" onclick="openStockLog('${id}')">📋 이력</button>` :
    !stockAutoDeduct ? `<div style="flex:1;text-align:center;font-size:11px;color:var(--text3);padding:8px;">
      🔒 자동 차감 OFF · 재고 조정 불가</div>` :
      `<button class="eg-act-btn btn-in"  onclick="egQuickOpen('${id}','in')">📥 입고</button>
    <button class="eg-act-btn btn-out" onclick="egQuickOpen('${id}','out')">📤 출고</button>
    <button class="eg-act-btn btn-log" onclick="openStockLog('${id}')">📋 이력</button>
    <button class="eg-act-btn btn-edit" onclick="openStockEdit('${id}')">✏️ 수정</button>
    <button class="eg-act-btn btn-del" onclick="deleteStockItem('${id}')">🗑️</button>`}
  </div>
</div>`;
}

// 빠른 입고/출고 상태 관리
let _egQuickState = {}; // { [id]: 'in'|'out' }

function egQuickOpen(id, type) {
    // 다른 열린 바 닫기
    Object.keys(_egQuickState).forEach(oid => { if (oid !== id) egQuickClose(oid); });
    _egQuickState[id] = type;
    const si = stockItems.find(s => s.id === id);
    if (!si) return;
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g,'_');
    const bar     = document.getElementById('eg-qbar-' + safeId);
    const label   = document.getElementById('eg-qlabel-' + safeId);
    const input   = document.getElementById('eg-qinput-' + safeId);
    const confirm = document.getElementById('eg-qconfirm-' + safeId);
    if (!bar) return;
    label.textContent = type === 'in' ? '📥 입고 수량' : '📤 출고 수량';
    confirm.className = 'eg-quick-confirm ' + type + '-type';
    confirm.textContent = type === 'in' ? '입고' : '출고';
    input.value = '';
    bar.classList.add('visible');
    setTimeout(() => input.focus(), 80);
    if (navigator.vibrate) navigator.vibrate(6);
}

function egQuickClose(id) {
    delete _egQuickState[id];
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g,'_');
    const bar = document.getElementById('eg-qbar-' + safeId);
    if (bar) bar.classList.remove('visible');
}

async function egQuickConfirm(id) {
    if (!stockAutoDeduct) { toast('🔒 자동 차감 OFF 상태에서는 재고 조정이 불가합니다', 'var(--orange)'); return; }
    const type = _egQuickState[id];
    if (!type) return;
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g,'_');
    const input = document.getElementById('eg-qinput-' + safeId);
    if (!input) return;
    const val = parseInt(input.value);
    if (!val || val <= 0) { toast('❗ 수량을 입력하세요'); input.focus(); return; }
    const si = stockItems.find(s => s.id === id);
    if (!si) return;
    const before = si.qty;

    // ── 출고 시 재고 부족 경고 ──
    if (type === 'out' && before <= 0) {
        toast(`❗ ${si.name} 현재 재고가 0입니다. 출고할 수 없습니다.`, 'var(--red)');
        return;
    }
    if (type === 'out' && val > before) {
        if (!await customConfirm(`⚠️ ${si.name} 재고(${fmt(before)}${si.unit})보다 출고 수량(${fmt(val)}${si.unit})이 많습니다.\n재고는 0이 됩니다. 계속하시겠습니까?`)) return;
    }

    let after, logType;
    if (type === 'in')  { after = before + val; logType = 'in'; }
    else                { after = Math.max(0, before - val); logType = 'out'; }

    // 실제 변동이 없으면 처리 안 함
    if (after === before) { toast('❗ 변동 수량이 없습니다'); return; }

    si.qty = after;
    si.updatedAt = new Date().toISOString();
    (si.log = si.log || []).unshift({
        type: logType, qty: after - before, before, after,
        reason: type === 'in' ? '빠른입고' : '빠른출고',
        date: todayKST(), at: new Date().toISOString()
    });
    si.log = _trimLogByDate(si.log);
    saveData();
    egQuickClose(id);
    renderStock();
    if (navigator.vibrate) navigator.vibrate([10,20,10]);
    const diff = after - before;
    toast(`${type==='in'?'📥 입고':'📤 출고'}: ${fmt(before)} → ${fmt(after)} ${si.unit}`,
          diff < 0 ? 'var(--red)' : 'var(--green)');
}

function renderStock() {
    const q   = (document.getElementById('stockSearch')?.value || '').trim();
    let items = stockItems.filter(s => !q || matchSearch(s.name, q));
    const isHistory = !!(stockViewDate && stockViewDate < todayKST());
    // 과거 조회 시 재고량 기준으로 정렬을 위해 임시 qty 스냅샷 사용
    const snapItems = isHistory
        ? items.map(s => ({ ...s, qty: getStockAtDate(s, stockViewDate) }))
        : items;
    if (stockSortMode === 'qty-asc')  items = [...items].sort((a,b) => {
        const ai = snapItems.find(x=>x.id===a.id)||a; const bi = snapItems.find(x=>x.id===b.id)||b;
        return ai.qty - bi.qty;
    });
    else if (stockSortMode === 'qty-desc') items = [...items].sort((a,b) => {
        const ai = snapItems.find(x=>x.id===a.id)||a; const bi = snapItems.find(x=>x.id===b.id)||b;
        return bi.qty - ai.qty;
    });
    else if (stockSortMode === 'danger') items = [...items].sort((a,b) => {
        const ai = snapItems.find(x=>x.id===a.id)||a; const bi = snapItems.find(x=>x.id===b.id)||b;
        const la = stockLevel(ai), lb = stockLevel(bi);
        const rank = {danger:0,low:1,ok:2};
        return rank[la] - rank[lb] || ai.qty - bi.qty;
    });
    else items = [...items].sort((a,b) => a.name.localeCompare(b.name,'ko'));

    // 요약 카운트 (과거 조회 시 과거 기준)
    if (isHistory) {
        const el_all    = document.getElementById('sCountAll');
        const el_low    = document.getElementById('sCountLow');
        const el_danger = document.getElementById('sCountDanger');
        const allSnap   = stockItems.map(s => ({ ...s, qty: getStockAtDate(s, stockViewDate) }));
        if (el_all)    el_all.textContent    = allSnap.length;
        if (el_low)    el_low.textContent    = allSnap.filter(s=>s.qty>s.danger&&s.qty<=s.low).length;
        if (el_danger) el_danger.textContent = allSnap.filter(s=>s.qty<=s.danger).length;
    } else {
        updateInfoCounts();
    }
    const el = document.getElementById('stockList');
    // 과거 조회 시 추가 버튼 / 달걀 배너 / 새로고침 버튼 숨기기
    const addBtn = document.querySelector('#pane-stock .btn-primary.btn-sm');
    const refreshBtn = document.querySelector('#pane-stock .btn-ghost.btn-sm[title]');
    const eggBanner = document.getElementById('eggInitBanner');
    if (isHistory) {
        if (addBtn) addBtn.style.display = 'none';
        if (refreshBtn) refreshBtn.style.display = 'none';
        if (eggBanner) eggBanner.style.display = 'none';
    } else if (!stockAutoDeduct) {
        // 자동차감 OFF: 등록/새로고침 버튼 숨김 (조정 불가)
        if (addBtn) addBtn.style.display = 'none';
        if (refreshBtn) refreshBtn.style.display = 'none';
    } else {
        if (addBtn) addBtn.style.display = '';
        if (refreshBtn) refreshBtn.style.display = '';
        // eggBanner는 checkEggInitBanner()가 관리
    }
    if (!items.length) {
        el.innerHTML = '<div class="empty"><div class="empty-icon">📦</div><div class="empty-text">' +
            (stockItems.length ? (isHistory ? `${stockViewDate} 기준 재고 데이터가 없습니다` : '검색 결과가 없습니다') : '등록된 품목이 없습니다<br><small style="color:var(--text3)">+ 품목 등록 버튼으로 추가하세요</small>') +
            '</div></div>';
        _egQuickState = {};
        return;
    }
    const EGG_ORDER = ['왕란','특란','대란','중란'];
    const ETC_ORDER = [
        '이른아침 왕란 30입','이른아침 특란 30입','이른아침 대란 30입','이른아침 초란 30입',
        '이른아침 왕란 10입','이른아침 PURE특란 10입','이른아침 대란 10입',
        '이른아침 PURE왕란 15입','이른아침 영양왕란 15입','이른아침 영양특란 10입',
        '명품영양란 특란 30입',
        '유정란 1번 10입','유정란 1번 30입',
        '유정란 2번 10입','유정란 2번 15입','유정란 2번 30입',
        '구운란 10입','구운란 벌크 30입','구운란 망 30입',
        '메추리알 24알','깐메추리알 1kg'
    ];
    const eggItems  = [];
    const etcItems  = [];
    if (!q && stockSortMode === 'name') {
        items.forEach(si => {
            if (EGG_ORDER.includes(si.name)) eggItems.push(si);
            else etcItems.push(si);
        });
        eggItems.sort((a,b) => EGG_ORDER.indexOf(a.name) - EGG_ORDER.indexOf(b.name));
        etcItems.sort((a, b) => {
            const ai = ETC_ORDER.indexOf(a.name);
            const bi = ETC_ORDER.indexOf(b.name);
            if (ai === -1 && bi === -1) return a.name.localeCompare(b.name, 'ko');
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });
    }
    const parts = [];
    if (!q && stockSortMode === 'name' && eggItems.length > 0) {
        parts.push('<div class="eg-section-label">🥚 달걀 품목</div>');
        parts.push(...eggItems.map(_egCardHTML));
        if (etcItems.length > 0) {
            parts.push('<div class="eg-section-label" style="margin-top:8px;">📦 기타 품목</div>');
            parts.push(...etcItems.map(_egCardHTML));
        }
    } else {
        parts.push(...items.map(_egCardHTML));
    }
    el.innerHTML = parts.join('');
    _egQuickState = {};
}

function setStockSort(mode, btn) {
    stockSortMode = mode;
    document.querySelectorAll('#pane-stock .sort-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderStock();
}

// ─── 자동 차감 토글 ───

function toggleAutoDeduct() {
    if (stockAutoDeduct) {
        // ON → OFF: 현재 재고 수치를 스냅샷으로 저장 (초기화 없음)
        const snapshot = {};
        stockItems.forEach(si => { snapshot[si.id] = si.qty; });
        localStorage.setItem('stockOffSnapshot', JSON.stringify(snapshot));
        stockAutoDeduct = false;
        localStorage.setItem('stockAutoDeduct', '0');
        applyAutoDeductUI();
        renderStock();
        toast('🔕 자동 재고 차감 비활성화 · 재고 수치 유지', 'var(--orange)');
    } else {
        // OFF → ON: 스냅샷으로 재고 복원 (OFF 기간 납품 영향 완전 차단)
        const snapshot = JSON.parse(localStorage.getItem('stockOffSnapshot') || '{}');
        if (Object.keys(snapshot).length > 0) {
            stockItems.forEach(si => {
                if (snapshot[si.id] !== undefined) {
                    const before = si.qty;
                    si.qty = snapshot[si.id];
                    // OFF 기간 로그 제거 (OFF 이후 생긴 carryover/auto 로그 삭제)
                    const offAt = localStorage.getItem('stockAutoDeductOffAt') || '';
                    if (offAt) {
                        si.log = (si.log || []).filter(l => !l.at || l.at <= offAt);
                    }
                    // lastCarryDate 오늘로 고정 → ON 복귀 후 이월이 OFF기간 주문 반영 못하게 차단
                    si.lastCarryDate = todayKST();
                }
            });
            localStorage.removeItem('stockOffSnapshot');
            localStorage.removeItem('stockAutoDeductOffAt');
        }
        _carryoverDoneThisSession = false;
        stockAutoDeduct = true;
        localStorage.setItem('stockAutoDeduct', '1');
        saveData();
        applyAutoDeductUI();
        renderStock();
        toast('✅ 자동 재고 차감 활성화 · OFF 기간 납품 영향 차단 완료', 'var(--green)');
    }
    // OFF 전환 시각 기록 (ON 복귀 시 로그 필터 기준점)
    if (!stockAutoDeduct) {
        localStorage.setItem('stockAutoDeductOffAt', new Date().toISOString());
    }
}

function applyAutoDeductUI() {
    const btn = document.getElementById('autoDeductBtn');
    if (!btn) return;
    btn.textContent    = stockAutoDeduct ? 'ON' : 'OFF';
    btn.style.color    = stockAutoDeduct ? 'var(--green)' : '';
    btn.style.borderColor = stockAutoDeduct ? 'var(--green)' : '';
}

// ─── 이전재고(어제 마감) 계산 ───

function getYesterdayClosingQty(si) {
    const today = todayKST();
    // 오늘 자정(KST) = UTC로 어제 15:00
    const todayStartUTC = new Date(today + 'T00:00:00+09:00').getTime();
    const log = (si.log || []);

    // 오늘 이전(어제 이하) 이력 중 가장 최근 것
    // ※ auto(납품차감) 타입은 at=저장시각(오늘 동기화될 수도 있음)이지만 date=납품날짜이므로
    //    "어느 날짜에 속하는지" 판단은 date 기준으로 해야 함
    const prevLog = log
        .filter(l => {
            if (l.type === 'auto') {
                // 납품차감은 납품날짜(date)가 오늘 이전인 것만 포함
                return (l.date || '') < today;
            }
            const t = l.at ? new Date(l.at).getTime() : 0;
            return t > 0 && t < todayStartUTC;
        })
        .sort((a, b) => {
            // ★ v107 fix: 정렬은 2단계로 — ① 소속 날짜(버킷) ② 같은 날짜 안에서는 실제 저장시각(at)
            // (이전 버전은 auto 타입을 무조건 "해당일 23:59:59"로 취급해, 같은 날 더 늦게 발생한
            //  수정보정(edit_adj) 등 실제시각 기반 항목보다 항상 "더 최근"으로 잘못 판정되는 버그가 있었음
            //  → 합계상 마감재고가 0인데도 더 이른 납품차감 시점의 값이 마감으로 잘못 채택되는 문제 발생)
            const dateOf = l => l.type === 'auto'
                ? (l.date || '1970-01-01')
                : ((l.at || '').slice(0, 10) || l.date || '1970-01-01');
            const da = dateOf(a), db = dateOf(b);
            if (da !== db) return da < db ? 1 : -1; // 날짜가 다르면 최신 날짜 먼저
            // 같은 날짜면 실제 저장시각(at) 기준 — auto 타입도 실제 at으로 비교
            const ta = a.at ? new Date(a.at).getTime() : 0;
            const tb = b.at ? new Date(b.at).getTime() : 0;
            return tb - ta;
        });

    if (prevLog.length > 0) {
        // 어제까지 마지막 이력의 after가 어제 마감 재고
        const entry = prevLog[0];
        const qty   = entry.after !== undefined && entry.after !== null
                        ? Number(entry.after) : si.qty;
        const date  = (entry.at || entry.date || '').slice(0, 10) || today;
        return { qty: isNaN(qty) ? si.qty : qty, date };
    }

    // 이력이 전혀 없거나 오늘 이후 이력만 있는 경우
    return { qty: si.qty, date: today, isCurrent: true };
}

// ─── 이전재고 이월 토글 ───
// carryMode: true=이월적용, false=현재값유지
let _carryMode = false; // 모달 열릴 때마다 초기화

function setPrevCarryMode(apply) {
    _carryMode = apply;
    const bar      = document.getElementById('sePrevQtyBar');
    const btnApply = document.getElementById('btnApplyCarry');
    const btnSkip  = document.getElementById('btnSkipCarry');
    const prevQty  = bar?.dataset.prevQty;

    if (apply) {
        // 이력 없으면 이월 불가
        if (bar?.dataset.hasHistory !== '1') {
            toast('❗ 이전 납품 이력이 없어 이월할 수 없습니다');
            return;
        }
        // 이월 적용: 이전 재고값을 seQty에 채움
        if (prevQty !== undefined && prevQty !== '') {
            document.getElementById('seQty').value = prevQty;
        }
        // 버튼 스타일 — 이월 적용 활성
        btnApply.style.background   = 'var(--accent)';
        btnApply.style.color        = '#fff';
        btnApply.style.borderColor  = 'var(--accent)';
        btnSkip.style.background    = 'var(--surf2)';
        btnSkip.style.color         = 'var(--text2)';
        btnSkip.style.borderColor   = 'var(--border)';
        toast('↩ 이전 재고를 적용합니다');
    } else {
        // 현재값 유지: seQty를 원래 현재 재고값으로 복원
        const origQty = bar?.dataset.origQty;
        if (origQty !== undefined && origQty !== '') {
            document.getElementById('seQty').value = origQty;
        }
        // 버튼 스타일 — 현재값 유지 활성
        btnSkip.style.background    = 'var(--accent)';
        btnSkip.style.color         = '#fff';
        btnSkip.style.borderColor   = 'var(--accent)';
        btnApply.style.background   = 'var(--surf2)';
        btnApply.style.color        = 'var(--text2)';
        btnApply.style.borderColor  = 'var(--border)';
        toast('✓ 현재 재고값을 유지합니다');
    }
}

// ─── 세션 내 자동 이월 실행 여부 (탭 전환마다 중복 실행 방지) ───
let _carryoverDoneThisSession = false;

// ─── 재고 새로고침 (전일 마감 이월 + 변동 반영) ───

function refreshStockCarryover(silent = false) {
    // 자동차감 OFF 상태에서는 이월 계산 완전 차단 (OFF 기간 재고 수치 고정)
    if (!stockAutoDeduct) {
        if (!silent) toast('🔒 자동 차감 OFF 상태에서는 이월 계산이 실행되지 않습니다', 'var(--orange)');
        else renderStock();
        return;
    }
    if (!stockItems.length) {
        if (!silent) toast('❗ 등록된 품목이 없습니다');
        else renderStock();
        return;
    }

    const today = todayKST();

    // ── silent(자동) 모드: 세션 내 최초 1회만 실행 ──
    // 탭 전환마다 호출되던 문제를 차단. 수동 버튼(silent=false)은 항상 허용.
    if (silent && _carryoverDoneThisSession) {
        renderStock();
        return;
    }

    let updated = 0;

    stockItems.forEach(si => {
        // ① lastCarryDate 필드 기반 강력한 중복 방지
        //    Firebase 동기화 후 log가 초기화되어도 날짜 필드로 이중 이월 차단
        if (si.lastCarryDate === today) return;

        // ② 로그 기반 추가 확인 (하위 호환)
        const alreadyCarried = (si.log || []).some(l =>
            l.type === 'carryover' && (l.date || '').slice(0, 10) === today
        );
        if (alreadyCarried) {
            si.lastCarryDate = today; // 필드 동기화
            return;
        }

        // ③ 어제 마감 재고 확인
        const prev = getYesterdayClosingQty(si);
        if (!prev || prev.isCurrent) return; // 이력 없는 신규 품목 스킵

        // ④ 오늘 입출고 로그 합산
        const todayStartUTC    = new Date(today + 'T00:00:00+09:00').getTime();
        const tomorrowStartUTC = todayStartUTC + 86400000;
        const todayLogs = (si.log || []).filter(l => {
            if (l.type === 'auto') return l.date === today; // 납품차감은 납품날짜 기준
            const t = l.at ? new Date(l.at).getTime() : 0;
            return t >= todayStartUTC && t < tomorrowStartUTC;
        });
        const todayDeduct = Math.max(0, todayLogs
            .filter(l => l.type === 'auto' || l.type === 'out' || (l.type === 'edit_adj' && l.qty < 0))
            .reduce((s, l) => s + Math.abs(l.qty), 0)
            - todayLogs.filter(l => l.type === 'restore' && (l.originalDate || l.date) === today).reduce((s, l) => s + Math.abs(l.qty), 0));
        const todayIn = todayLogs
            .filter(l => l.type === 'in' || (l.type === 'edit_adj' && l.qty > 0))
            .reduce((s, l) => s + Math.abs(l.qty), 0);

        // ⑤ 자동차감 OFF이면 납품 전표 기반 차감 제외 (차감 자체를 안 하는 것이므로)
        // ※ 이전 버전에서 OFF일 때도 포함했으나, 이중차감/이전재고 왜곡 원인이 됨
        let deliveryDeduct = 0;

        // ⑥ 이전재고 기반 오늘 재고 = 이전재고 + 오늘입고 - 오늘차감
        const newQty = Math.max(0, prev.qty + todayIn - todayDeduct - deliveryDeduct);
        if (newQty === si.qty) {
            // 수치는 맞지만 lastCarryDate는 반드시 기록 (이중 이월 방지)
            si.lastCarryDate = today;
            return;
        }

        const before = si.qty;
        si.qty = newQty;
        si.lastCarryDate = today; // ← 핵심: 필드에 날짜 저장
        si.updatedAt = new Date().toISOString();
        (si.log = si.log || []).unshift({
            type: 'carryover', qty: newQty - before, before, after: newQty,
            reason: `전일(${prev.date}) 마감 이월`,
            date: today, at: new Date().toISOString()
        });
        si.log = _trimLogByDate(si.log);
        updated++;
    });

    if (silent) _carryoverDoneThisSession = true; // 세션 플래그 설정

    saveData();
    renderStock();
    if (updated > 0) {
        toast(`🔄 ${updated}개 품목 재고가 이월 반영되었습니다`, 'var(--green)');
    } else if (!silent) {
        toast('✅ 모든 품목이 최신 상태입니다');
    }
}

// ─── 품목 등록·수정 ───

function openStockEdit(id) {
    // 자동차감 OFF 시에도 품목 등록·수정은 허용 (재고 수량 변경만 제한)
    const si = id ? stockItems.find(s => s.id === id) : null;
    document.getElementById('stockEditTitle').textContent = si ? '✏️ 품목 수정' : '📦 품목 등록';
    document.getElementById('seId').value    = si ? si.id : '';
    document.getElementById('seName').value  = si ? si.name  : '';
    document.getElementById('seQty').value   = si ? si.qty   : '';
    document.getElementById('seUnit').value  = si ? si.unit  : '개';
    document.getElementById('seLow').value   = si ? si.low   : 10;
    document.getElementById('seDanger').value= si ? si.danger: 3;
    document.getElementById('seNote').value  = si ? si.note  : '';

    // ── 이전재고 이월 표시 ──
    const bar = document.getElementById('sePrevQtyBar');
    _carryMode = false; // 모달 열 때마다 "현재값 유지" 기본값
    if (si) {
        try {
            const prev = getYesterdayClosingQty(si);
            const hasHistory = !prev.isCurrent; // 오늘 이전 이력 존재 여부

            // 이력 유무와 관계없이 섹션은 항상 표시
            bar.style.display    = 'block';
            bar.dataset.prevQty  = String(prev.qty);
            bar.dataset.origQty  = String(si.qty);
            bar.dataset.hasHistory = hasHistory ? '1' : '0';

            if (hasHistory) {
                document.getElementById('sePrevQtyVal').textContent =
                    `이전: ${fmt(prev.qty)} ${si.unit}　→　현재: ${fmt(si.qty)} ${si.unit}`;
                document.getElementById('sePrevQtyDate').textContent =
                    `기준일: ${prev.date} (어제 마감)`;
            } else {
                document.getElementById('sePrevQtyVal').textContent =
                    `현재: ${fmt(si.qty)} ${si.unit}`;
                document.getElementById('sePrevQtyDate').textContent =
                    '이전 납품 이력 없음';
            }

            // 기본 상태: "현재값 유지" 활성 / 이력 없으면 이월 버튼 비활성
            const btnApply = document.getElementById('btnApplyCarry');
            const btnSkip  = document.getElementById('btnSkipCarry');
            btnSkip.style.background   = 'var(--accent)';
            btnSkip.style.color        = '#fff';
            btnSkip.style.borderColor  = 'var(--accent)';
            btnApply.style.background  = 'var(--surf2)';
            btnApply.style.color       = hasHistory ? 'var(--text2)' : 'var(--text3)';
            btnApply.style.borderColor = 'var(--border)';
            btnApply.disabled          = !hasHistory;
            btnApply.title             = hasHistory ? '' : '이전 납품 이력이 없어 이월할 수 없습니다';
            btnSkip.disabled           = false;
        } catch(e) {
            // 계산 오류 시 섹션 숨김으로 안전 처리
            console.warn('이전재고 계산 오류:', e);
            bar.style.display   = 'none';
            bar.dataset.prevQty = '';
            bar.dataset.origQty = String(si.qty);
        }
    } else {
        bar.style.display    = 'none';
        bar.dataset.prevQty  = '';
        bar.dataset.origQty  = '';
    }

    openModal('stockEditModal');
    setTimeout(() => document.getElementById('seName').focus(), 80);
}

function saveStockItem() {
    const id     = document.getElementById('seId').value;
    const name   = document.getElementById('seName').value.trim();
    const qtyRaw = document.getElementById('seQty').value;
    const qty    = qtyRaw === '' ? 0 : Number(qtyRaw);
    const unit   = document.getElementById('seUnit').value.trim() || '개';
    const low    = Number(document.getElementById('seLow').value)    || 10;
    const danger = Number(document.getElementById('seDanger').value) || 3;
    const note   = document.getElementById('seNote').value.trim();

    if (!name) return toast('❗ 품목명을 입력하세요');
    if (isNaN(qty) || qty < 0) return toast('❗ 재고는 0 이상이어야 합니다');
    if (low < danger) return toast('❗ 부족 경고 기준은 위험 기준보다 커야 합니다');

    // 정규화된 이름으로 중복 체크
    const dup = stockItems.some(s => normItemName(s.name) === normItemName(name) && s.id !== id);
    if (dup) return toast('❗ 이미 등록된 품목명입니다');

    if (id) {
        const si = stockItems.find(s => s.id === id);
        if (!si) return toast('❗ 품목을 찾을 수 없습니다');
        const before = si.qty;
        Object.assign(si, { name, qty, unit, low, danger, note, updatedAt: new Date().toISOString() });
        if (before !== qty) {
            // 이월 적용 선택 시 carryover 로그, 아니면 수동 set 로그
            const logType   = _carryMode ? 'carryover' : 'set';
            const logReason = _carryMode ? '이전 재고 이월 적용' : '수동 재고 설정';
            const diff = qty - before;
            (si.log = si.log||[]).unshift({
                type: logType, qty: diff, before, after: qty,
                reason: logReason, date: todayKST(), at: new Date().toISOString()
            });
            si.log = _trimLogByDate(si.log);

            // ── 오늘 입고 로그가 있는데 수정으로 수량이 감소한 경우 →
            //    입고 수량 표시도 보정 (in_adj 로그로 inQty 차감)
            if (!_carryMode && diff < 0) {
                const today = todayKST();
                const todayStartUTC = new Date(today + 'T00:00:00+09:00').getTime();
                const tomorrowStartUTC = todayStartUTC + 86400000;
                const todayInTotal = (si.log || []).filter(l => {
                    if (l.type !== 'in') return false;
                    const t = l.at ? new Date(l.at).getTime() : 0;
                    return t >= todayStartUTC && t < tomorrowStartUTC;
                }).reduce((s, l) => s + Math.abs(l.qty), 0);
                if (todayInTotal > 0) {
                    // 이미 쌓인 in_adj 합산
                    const todayInAdj = (si.log || []).filter(l => {
                        if (l.type !== 'in_adj') return false;
                        const t = l.at ? new Date(l.at).getTime() : 0;
                        return t >= todayStartUTC && t < tomorrowStartUTC;
                    }).reduce((s, l) => s + l.qty, 0);
                    const canAdj = Math.min(Math.abs(diff), todayInTotal + todayInAdj);
                    if (canAdj > 0) {
                        si.log.unshift({
                            type: 'in_adj', qty: -canAdj, before, after: qty,
                            reason: '입고 수량 수정 보정', date: today, at: new Date().toISOString()
                        });
                    }
                }
            }
        }
        toast('✅ 품목이 수정되었습니다', 'var(--green)');
    } else {
        // ── 신규 등록 시: 오늘 납품 전표에 동일 품목 출고가 있으면 자동 반영 ──
        const today = todayKST();
        const todayAutoOut = orders
            .filter(o => o.date === today)
            .flatMap(o => o.items || [])
            .filter(item => normItemName(item.name) === normItemName(name))
            .reduce((sum, item) => sum + Number(item.qty || 0), 0);

        const initLog = [];
        // 최초 입고 로그 (입력한 qty 기준)
        if (qty > 0) {
            initLog.push({ type:'set', qty, before:0, after:qty, reason:'최초 등록', date:today, at:new Date().toISOString() });
        }
        let finalQty = qty;
        // 오늘 이미 납품된 수량이 있으면 차감 + auto 로그 추가
        if (stockAutoDeduct && todayAutoOut > 0) {
            finalQty = Math.max(0, qty - todayAutoOut);
            initLog.unshift({ type:'auto', qty: finalQty - qty, before: qty, after: finalQty,
                reason:'등록 시 오늘 납품 자동 반영', date: today, at: new Date().toISOString() });
        }

        stockItems.push(normStock({ id:_uid(), name, qty:finalQty, unit, low, danger, note, log: initLog }));

        if (stockAutoDeduct && todayAutoOut > 0) {
            toast(`✅ 품목 등록 완료 (오늘 출고 ${fmt(todayAutoOut)}${unit} 자동 반영 → 잔고 ${fmt(finalQty)}${unit})`, 'var(--green)');
        } else {
            toast('✅ 품목이 등록되었습니다', 'var(--green)');
        }
    }
    saveData(); _markDirty('stock'); renderStock();
    closeModal('stockEditModal');
}

async function deleteStockItem(id) {
    const si = stockItems.find(s => s.id === id);
    if (!si) return;
    if (!await customConfirm(`'${si.name}' 품목을 삭제할까요?\n재고 이력도 함께 삭제됩니다.`)) return;
    stockItems = stockItems.filter(s => s.id !== id);
    saveData(); _markDirty('stock'); renderStock();
    toast('🗑️ 품목 삭제 완료');
}

// ─── 재고 조정 ───

function openAdj(id) {
    if (!stockAutoDeduct) { toast('🔒 자동 차감 OFF 상태에서는 재고 조정이 불가합니다', 'var(--orange)'); return; }
    // 열린 빠른 입고/출고 바 모두 닫기
    Object.keys(_egQuickState).forEach(oid => egQuickClose(oid));
    const si = stockItems.find(s => s.id === id);
    if (!si) return;
    document.getElementById('saId').value      = id;
    document.getElementById('saName').textContent = si.name;
    document.getElementById('saCurrent').textContent = fmt(si.qty) + ' ' + si.unit;
    document.getElementById('saQty').value     = '';
    document.getElementById('saReason').value  = '';
    document.getElementById('saPreview').textContent = '';
    _adjType = 'in';
    setAdjType('in');
    openModal('stockAdjModal');
    setTimeout(() => document.getElementById('saQty').focus(), 80);
}

function setAdjType(type) {
    _adjType = type;
    ['in','out','set'].forEach(t => {
        const btn = document.getElementById('adj' + t.charAt(0).toUpperCase() + t.slice(1));
        if (btn) btn.className = 'adj-btn' + (t === type ? ' ' + t : '');
    });
    const label = document.getElementById('saQtyLabel');
    if (label) label.textContent = type === 'in' ? '입고 수량' : type === 'out' ? '출고 수량' : '설정할 재고량';
    previewAdj();
}

function previewAdj() {
    const id  = document.getElementById('saId').value;
    const val = Number(document.getElementById('saQty').value) || 0;
    const si  = stockItems.find(s => s.id === id);
    if (!si) return;
    const prev = document.getElementById('saPreview');
    let after;
    if (_adjType === 'in')  after = si.qty + val;
    else if (_adjType === 'out') after = Math.max(0, si.qty - val);
    else after = val;
    const diff = after - si.qty;
    const sign = diff >= 0 ? '+' : '';
    prev.innerHTML = val
        ? `${fmt(si.qty)} → <strong style="color:${diff<0?'var(--red)':'var(--green)'};">${fmt(after)}</strong> ${si.unit} (${sign}${fmt(diff)})`
        : '';
}

async function applyAdj() {
    const id     = document.getElementById('saId').value;
    const valRaw = document.getElementById('saQty').value;
    const reason = document.getElementById('saReason').value.trim();
    const si     = stockItems.find(s => s.id === id);
    if (!si) return toast('❗ 품목을 찾을 수 없습니다');
    if (valRaw === '' || valRaw === null) return toast('❗ 수량을 입력하세요');
    const val = Number(valRaw);
    if (isNaN(val) || val < 0) return toast('❗ 올바른 수량을 입력하세요 (0 이상)');

    const before = si.qty;
    let after, logType;
    if (_adjType === 'in')       { after = before + val;             logType = 'in'; }
    else if (_adjType === 'out') { after = Math.max(0, before - val); logType = 'out'; }
    else                         { after = val;                       logType = 'set'; }

    si.qty = after;
    si.updatedAt = new Date().toISOString();
    // 변동이 없으면 로그 생성 안 함
    if (after === before) { closeModal('stockAdjModal'); toast('❗ 변동 수량이 없습니다'); return; }
    (si.log = si.log||[]).unshift({ type:logType, qty:after-before, before, after,
        reason: reason || (logType==='in'?'입고':logType==='out'?'출고':'직접설정'),
        date: todayKST(), at: new Date().toISOString() });
    si.log = _trimLogByDate(si.log);

    saveData(); _markDirty('stock'); renderStock();
    closeModal('stockAdjModal');
    const diff = after - before;
    toast(`✅ 재고 조정: ${fmt(before)} → ${fmt(after)} ${si.unit}`, diff < 0 ? 'var(--red)' : 'var(--green)');
}

// ─── 재고 이력 ───

function openStockLog(id) {
    const si = stockItems.find(s => s.id === id);
    if (!si) return;
    document.getElementById('slName').textContent = si.name + '  현재: ' + fmt(si.qty) + ' ' + si.unit;
    const log = (si.log || []);
    const typeLabel = { in:'📥 입고', out:'📤 출고', set:'✏️ 설정', auto:'🚚 납품차감', carryover:'🔄 이월', edit_adj:'✏️ 수정보정', restore:'↩ 납품삭제복구' };
    const typeCls   = { in:'in', out:'out', set:'set', auto:'auto', carryover:'in', edit_adj:'set', restore:'in' };

    if (!log.length) {
        document.getElementById('slList').innerHTML =
            '<div style="text-align:center;color:var(--text3);padding:20px;">이력이 없습니다</div>';
        openModal('stockLogModal');
        return;
    }

    // 날짜별 그룹핑
    const dayMap = {};
    log.forEach(l => {
        // auto(납품차감)는 납품 날짜 기준, 나머지는 등록 시각 기준
        const d = l.type === 'auto'
            ? (l.date || (l.at||'').slice(0,10) || '날짜미상')
            : ((l.at || l.date || '').slice(0, 10) || '날짜미상');
        if (!dayMap[d]) dayMap[d] = [];
        dayMap[d].push(l);
    });
    const days = Object.keys(dayMap).sort((a, b) => b.localeCompare(a));

    document.getElementById('slList').innerHTML = days.map(day => {
        const dayLogs = dayMap[day];
        // 해당 날짜 마감 재고 = 그날 마지막 이력의 after
        const lastLog = [...dayLogs].sort((a, b) =>
            (b.at || b.date || '').localeCompare(a.at || a.date || '')).find(l => l.after !== undefined);
        const dayClosing = lastLog ? lastLog.after : '?';
        const inSum  = dayLogs.filter(l => l.type === 'in').reduce((s, l) => s + Math.abs(l.qty||0), 0);
        const outSum = Math.max(0, dayLogs.filter(l => l.type === 'out' || l.type === 'auto' || (l.type === 'edit_adj' && (l.qty||0) < 0)).reduce((s, l) => s + Math.abs(l.qty||0), 0)
                     - dayLogs.filter(l => (l.type === 'restore' && (l.originalDate || l.date) === day) || (l.type === 'edit_adj' && (l.qty||0) > 0)).reduce((s, l) => s + Math.abs(l.qty||0), 0));
        return `
<div style="margin-bottom:10px;">
  <div style="display:flex;justify-content:space-between;align-items:center;
              padding:6px 8px;background:var(--surf3);border-radius:6px 6px 0 0;
              border:1px solid var(--border);border-bottom:none;">
    <span style="font-size:11px;font-weight:700;color:var(--text2);">${day}</span>
    <span style="font-size:10px;color:var(--text3);">
      ${inSum > 0 ? `<span style="color:var(--green);">+${fmt(inSum)}</span> ` : ''}
      ${outSum > 0 ? `<span style="color:var(--red);">-${fmt(outSum)}</span>` : ''}
      &nbsp;마감: <strong style="color:var(--accent);">${fmt(dayClosing)}</strong>
    </span>
  </div>
  <div style="border:1px solid var(--border);border-top:none;border-radius:0 0 6px 6px;">
    ${dayLogs.map(l => {
        const sign  = (l.qty || 0) >= 0 ? '+' : '';
        const cls   = typeCls[l.type] || 'set';
        const label = typeLabel[l.type] || l.type;
        const time  = l.at ? new Date(new Date(l.at).getTime() + 9*3600000).toISOString().slice(11, 16) : '';
        return `<div class="slog-row" style="padding:7px 10px;">
  <div>
    <div style="font-size:12px;">${escapeHtml(label)}${l.reason ? ' · ' + escapeHtml(l.reason) : ''}</div>
    <div class="slog-meta">${time ? time + ' · ' : ''}${fmt(l.before)}→${fmt(l.after)} ${escapeHtml(si.unit)}</div>
  </div>
  <div class="slog-chg ${cls}">${sign}${fmt(l.qty)}</div>
</div>`;
    }).join('')}
  </div>
</div>`;
    }).join('');
    openModal('stockLogModal');
}

// ─── 저장공간 사용량 바 업데이트 ───

function _calcTodayOut(name) {
    const today = todayKST();
    return orders
        .filter(o => o.date === today)
        .flatMap(o => o.items || [])
        .filter(item => normItemName(item.name) === normItemName(name))
        .reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

function initEggItems() {
    let added = 0;
    const today = todayKST();
    EGG_ITEMS_DEFAULT.forEach(egg => {
        const exists = stockItems.some(s => normItemName(s.name) === normItemName(egg.name));
        if (!exists) {
            const todayOut = stockAutoDeduct ? _calcTodayOut(egg.name) : 0;
            const initLog = [];
            if (stockAutoDeduct && todayOut > 0) {
                initLog.push({ type:'auto', qty: -todayOut, before: 0, after: -todayOut,
                    reason:'등록 시 오늘 납품 자동 반영', date: today, at: new Date().toISOString() });
            }
            stockItems.push(normStock({
                id: _uid(), name: egg.name, qty: Math.max(0, -todayOut),
                unit: egg.unit, low: egg.low, danger: egg.danger, note: egg.note,
                log: initLog
            }));
            added++;
        }
    });
    if (added > 0) {
        saveData(); _markDirty('stock'); renderStock();
        toast(`🥚 달걀 ${added}종 등록 완료 (오늘 납품 자동 반영)`, 'var(--green)');
    } else {
        toast('이미 모든 달걀 품목이 등록되어 있습니다');
    }
    document.getElementById('eggInitBanner').style.display = 'none';
}

function checkEggInitBanner() {
    const banner = document.getElementById('eggInitBanner');
    if (!banner) return;
    const hasAnyEgg = EGG_ITEMS_DEFAULT.some(egg =>
        stockItems.some(s => normItemName(s.name) === normItemName(egg.name))
    );
    // 달걀 품목이 하나도 없을 때만 배너 표시
    banner.style.display = hasAnyEgg ? 'none' : 'block';
    checkEtcInitBanner();
}

function checkEtcInitBanner() {
    const banner = document.getElementById('etcInitBanner');
    if (!banner) return;
    const hasAnyEtc = ETC_ITEMS_DEFAULT.some(etc =>
        stockItems.some(s => normItemName(s.name) === normItemName(etc.name))
    );
    banner.style.display = hasAnyEtc ? 'none' : 'block';
}

function initEtcItems() {
    let added = 0;
    const today = todayKST();
    ETC_ITEMS_DEFAULT.forEach(etc => {
        const exists = stockItems.some(s => normItemName(s.name) === normItemName(etc.name));
        if (!exists) {
            const todayOut = stockAutoDeduct ? _calcTodayOut(etc.name) : 0;
            const initLog = [];
            if (stockAutoDeduct && todayOut > 0) {
                initLog.push({ type:'auto', qty: -todayOut, before: 0, after: -todayOut,
                    reason:'등록 시 오늘 납품 자동 반영', date: today, at: new Date().toISOString() });
            }
            stockItems.push(normStock({
                id: _uid(), name: etc.name, qty: Math.max(0, -todayOut),
                unit: etc.unit, low: etc.low, danger: etc.danger, note: etc.note || '',
                log: initLog
            }));
            added++;
        }
    });
    if (added > 0) {
        saveData(); _markDirty('stock'); renderStock();
        toast(`📦 기타 품목 ${added}종 등록 완료 (오늘 납품 자동 반영)`, 'var(--accent)');
    } else {
        toast('이미 모든 기타 품목이 등록되어 있습니다');
    }
    document.getElementById('etcInitBanner').style.display = 'none';
}

