// ╔══════════════════════════════════════════════════════════════╗
// ║  § 8  내역 조회                                                  ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── 내역 조회 ───

function initHistPeriod() {
    const today = todayKST();
    // 이미 사용자가 설정한 날짜가 있으면 덮어쓰지 않음
    if (!document.getElementById('histStart').value)
        document.getElementById('histStart').value = today;
    if (!document.getElementById('histEnd').value)
        document.getElementById('histEnd').value = today;
    // 네비 날짜 초기화
    const navEl = document.getElementById('histNavDate');
    if (navEl && !navEl.value) navEl.value = today;
}

function clearHistPeriodActive() {
    document.querySelectorAll('.hist-period').forEach(b => b.classList.remove('active'));
}

// ─── 내역 탭 날짜 네비 ───
function histDateNav(delta) {
    const el = document.getElementById('histNavDate');
    const cur = el.value || todayKST();
    el.value = kstAddDays(cur, delta);
    histDateNavSet(el.value);
}
function histDateNavToday() {
    const today = todayKST();
    document.getElementById('histNavDate').value = today;
    histDateNavSet(today);
}
function histDateNavSet(dateStr) {
    document.getElementById('histStart').value = dateStr;
    document.getElementById('histEnd').value   = dateStr;
    clearHistPeriodActive();
    renderOrders();
}

function setHistPeriod(p, btn) {
    const todayStr = todayKST();
    let start, end = todayStr;
    if (p==='today') {
        start = todayStr;
    } else if (p==='week') {
        // KST 기준 이번 주 일요일 계산
        const dow = new Date(todayStr + 'T12:00:00+09:00').getDay();
        start = kstAddDays(todayStr, -dow);
    } else if (p==='lastweek') {
        // 지난주 일요일 ~ 토요일
        const dow = new Date(todayStr + 'T12:00:00+09:00').getDay();
        const thisSun = kstAddDays(todayStr, -dow);
        start = kstAddDays(thisSun, -7);
        end   = kstAddDays(thisSun, -1);
    } else if (p==='month') {
        start = todayStr.slice(0,7) + '-01';
    } else if (p==='lastmonth') {
        // 지난달 1일 ~ 말일
        const d = new Date(todayStr + 'T12:00:00+09:00');
        const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
        const m = d.getMonth() === 0 ? 12 : d.getMonth();
        const mm = String(m).padStart(2,'0');
        const lastDay = new Date(y, m, 0).getDate();
        start = `${y}-${mm}-01`;
        end   = `${y}-${mm}-${String(lastDay).padStart(2,'0')}`;
    } else {
        start = '2000-01-01'; end = '2099-12-31';
    }
    document.getElementById('histStart').value = start;
    document.getElementById('histEnd').value   = end;
    // 네비 날짜도 시작일로 동기화
    const navEl = document.getElementById('histNavDate');
    if (navEl) navEl.value = start;
    clearHistPeriodActive();
    if (btn) btn.classList.add('active');
    renderOrders();
}

// ─── 검색어 하이라이트 ───

function highlight(text, q) {
    const safeText = escapeHtml(text);
    if (!q || !text) return safeText;
    const safeQ = escapeHtml(q);
    // 일반 문자열 매칭 시도
    const idx = safeText.toLowerCase().indexOf(safeQ.toLowerCase());
    if (idx !== -1) {
        return safeText.slice(0, idx)
            + `<mark style="background:var(--accent)33;color:var(--accent);border-radius:3px;padding:0 2px;">${safeText.slice(idx, idx + safeQ.length)}</mark>`
            + safeText.slice(idx + safeQ.length);
    }
    // 초성 매칭 — 글자 단위로 일치하는 구간 하이라이트
    const qCho = extractChosung(q);
    const tCho = extractChosung(text);
    if (qCho === q) return safeText; // 초성 없는 일반 문자열인데 위에서 못 찾은 경우 → 매칭 없음
    const choStart = tCho.indexOf(qCho);
    if (choStart !== -1) {
        return safeText.slice(0, choStart)
            + `<mark style="background:var(--accent)33;color:var(--accent);border-radius:3px;padding:0 2px;">${safeText.slice(choStart, choStart + qCho.length)}</mark>`
            + safeText.slice(choStart + qCho.length);
    }
    return safeText;
}

function setHistSort(mode, btn) {
    histSortMode = mode;
    document.querySelectorAll('#pane-history .sort-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderOrders();
}

function setHistPayFilter(f, btn) {
    histPayFilter = f;
    document.querySelectorAll('#histPayChips .chip').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderOrders();
}

// ── 거래 건수 위젯 업데이트 (선택된 기간 기준) ──
function _updateTodayCountWidget(filteredOrders, start, end) {
    const todayStr = todayKST();
    // 기간 라벨 결정
    let periodLabel = '오늘 거래';
    if (start && end) {
        if (start === end) {
            periodLabel = start === todayStr ? '오늘 거래' : `${start.slice(5).replace('-','/')} 거래`;
        } else {
            periodLabel = `${start.slice(5).replace('-','/')}~${end.slice(5).replace('-','/')} 거래`;
        }
    }
    // ★ delegatedBy 판단: A 입장(내 orders)에서는 delegatedBy 있으면 대납 거래(매출 제외)
    //   B 입장(_mySharedEntry로 들어온 항목)에서는 이미 "내가 대납한 것"만 필터링되어 들어오므로 매출에 포함
    const base = (filteredOrders || []).filter(o => !o.isVoid && (o._mySharedEntry || !o.delegatedBy));
    const count = base.length;
    const amt   = base.reduce((s, o) => s + o.total, 0);

    const numEl   = document.getElementById('todayCountNum');
    const amtEl   = document.getElementById('todayCountAmt');
    const tbox    = document.getElementById('todayCountBox');
    const labelEl = document.getElementById('todayCountLabel');
    if (numEl)   numEl.textContent   = count;
    if (amtEl)   amtEl.textContent   = fmt(amt) + '원';
    if (labelEl) labelEl.textContent = periodLabel;
    if (tbox) {
        tbox.style.borderColor = count > 0 ? 'var(--accent)' : 'var(--border)';
        tbox.style.background  = count > 0 ? 'rgba(108,99,255,0.07)' : 'var(--surf3)';
    }
}

function renderOrders() {
    const q     = document.getElementById('histSearch')?.value || '';
    const start = document.getElementById('histStart')?.value || '';
    const end   = document.getElementById('histEnd')?.value || '';

    // 내 납품 내역 + 공유 워크스페이스 납품 내역 합산
    const allOrders = [
        ...orders,
        ..._sharedOrdersCache,
    ];
    const filtered = allOrders.filter(o => {
        const mSearch = matchSearch(o.clientName||'',q) || (o.items||[]).some(i=>matchSearch(i.name,q));
        const mDate   = (!start||o.date>=start) && (!end||o.date<=end);
        const mPay    = histPayFilter==='all'?true:histPayFilter==='unpaid'?!o.isPaid:o.isPaid;
        return mSearch && mDate && mPay ;
    });

    const _et       = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
    // ★ delegatedBy: A 입장에선 남이 대납한 거래는 매출 제외, B 입장(_mySharedEntry)에선 본인이 대납한 매출이므로 포함
    const _isMine   = o => o._mySharedEntry || !o.delegatedBy;
    const totalAmt  = filtered.filter(o=>!o.isVoid && _isMine(o)).reduce((s,o)=>s+_et(o),0);
    const paidAmt     = filtered.filter(o=>!o.isVoid && _isMine(o)).reduce((s,o)=>s+_actualPaid(o),0);
    const unpaidAmt   = Math.max(0, totalAmt - paidAmt);
    // 수금방법별 집계 (paidMethodDetail 우선, 없으면 paidMethod 기준)
    let cashAmt = 0, transferAmt = 0, mixedAmt = 0, otherPaidAmt = 0;
    filtered.filter(o=>!o.isVoid).forEach(o => {
        const got = _actualPaid(o);
        if (got <= 0) return;
        if (o.paidMethod === 'mixed') {
            if (o.paidMethodDetail) {
                transferAmt += (o.paidMethodDetail.transfer || 0);
                cashAmt     += (o.paidMethodDetail.cash     || 0);
            } else {
                mixedAmt += got; // 구버전 mixed: 별도 항목
            }
        } else if (o.paidMethod === 'transfer') transferAmt += got;
        else if (o.paidMethod === 'other') otherPaidAmt += got;
        else cashAmt += got;
    });
    document.getElementById('hstatTotal').textContent  = fmt(totalAmt)+'원';
    document.getElementById('hstatPaid').textContent   = fmt(paidAmt)+'원';
    document.getElementById('hstatUnpaid').textContent = fmt(unpaidAmt)+'원';
    // 수금방법 분리 표시
    const bdEl = document.getElementById('hstatBreakdown');
    if (bdEl) {
        if (paidAmt > 0) {
            document.getElementById('hstatCash').textContent     = '💵 ' + fmt(cashAmt) + '원';
            document.getElementById('hstatTransfer').textContent = '🏦 ' + fmt(transferAmt) + '원';
            // 구버전 mixed 항목이 있으면 추가 표시
            const mixedEl = document.getElementById('hstatMixed');
            if (mixedEl) mixedEl.textContent = mixedAmt > 0 ? '💳 ' + fmt(mixedAmt) + '원' : '';
            if (mixedEl) mixedEl.style.display = mixedAmt > 0 ? '' : 'none';
            bdEl.style.display = 'flex';
        } else {
            bdEl.style.display = 'none';
        }
    }

    // ── 거래 건수 위젯 업데이트 (선택된 기간 기준) ──
    _updateTodayCountWidget(filtered, start, end);

    const el = document.getElementById('orderList');
    if (!filtered.length) {
        el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">납품 내역이 없습니다</div></div>';
        return;
    }

    // ── 전표 카드 HTML ──
    const orderCardHTML = o => {
        const cName = escapeAttr(o.clientName || '');
        const cId   = escapeAttr(o.clientId   || '');
        const oId   = escapeAttr(o.id         || '');
        const voided   = !!o.isVoid;
        const isReturn = !!o.isReturn;
        const readOnly  = false; // 공유 내역도 수정/결제/삭제 가능
        // 타인거래도 미수/완납 상태 반영한 카드 색상 / 반품·회수는 별도 색상
        const cardClass = `order-card ${isReturn ? 'return ' : ''}${voided ? ('voided ' + (o.isPaid ? 'paid' : 'unpaid')) : (o.isPaid ? 'paid' : 'unpaid')}`;
        // 타인거래: 👤배지 + 수금 상태 배지 같이 표시 (수금 처리 가능)
        const payBadge = `<span class="pay-badge ${o.isPaid?'paid':((o.paidAmount||0)>0?'':'unpaid')}" style="${(o.paidAmount||0)>0&&!o.isPaid?'background:#3b82f625;color:#60a5fa;':''}" onclick="${o.isPaid ? `togglePaid('${oId}')` : `openQuickPay('${oId}')` }">${o.isPaid?(o.discount>0?`✂️ 할인완납`:'✅ 완납'):(o.paidAmount||0)>0?'💳 부분':'⚠ 미수'}</span>`;
        // ★ 대납 뱃지: A 화면(내 orders, delegatedBy 있음)에선 "매출제외", B 화면(_mySharedEntry)에선 "내 매출"로 구분 표시
        const delegatedBadge = o.delegatedBy
            ? (o._mySharedEntry
                ? `<span style=\"font-size:10px;background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 5px;display:inline-block;margin-bottom:2px;\">🔄 대납(내 매출)</span>`
                : `<span style=\"font-size:10px;background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 5px;display:inline-block;margin-bottom:2px;\">🔄 대납(매출제외)</span>`)
            : '';
        // 반품/회수 전표: 수금 배지 대신 전용 배지(클릭 동작 없음 — 정산에는 음수로 자동 반영됨)
        const badgeHtml = isReturn
            ? `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">${delegatedBadge}<span class="return-badge">↩ 반품/회수</span></div>`
            : voided
                ? `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">${delegatedBadge}<span class="void-badge">👤 타인거래</span>${payBadge}</div>`
                : delegatedBadge
                    ? `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">${delegatedBadge}${payBadge}</div>`
                    : payBadge;
        const memoLabel = o.note ? '📝 메모수정' : '📝 메모';
        const memoPriority = memoPriorityLevel(o); // 1=낮음 2=보통(기본) 3=높음
        const memoClass = o.note ? `memo-btn has-memo priority-${memoPriority}` : 'memo-btn';

        let memoBodyHtml = '';
        if (o.note) {
            // 현재 메모 표시 (중요도별 색상)
            memoBodyHtml = `<div class="order-memo-body priority-${memoPriority}" onclick="openMemoPopup('${oId}')">${escapeHtml(o.note)}</div>`;
        } else {
            // 메모 없으면 같은 거래처의 가장 최근 이전 메모 표시
            const prevMemo = orders
                .filter(x => x.clientName === o.clientName && x.id !== o.id && x.note && x.note.trim())
                .sort((a, b) => (b.date||'').localeCompare(a.date||'') || (b.id||'').localeCompare(a.id||''))
                [0];
            if (prevMemo) {
                memoBodyHtml = `<div class="order-memo-body order-memo-prev" style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
                    <div onclick="openMemoPopup('${oId}')" style="flex:1;min-width:0;">
                        <span class="order-memo-prev-label">이전 메모 · ${prevMemo.date}</span>${escapeHtml(prevMemo.note)}
                    </div>
                    <button onclick="deletePrevMemo('${escapeAttr(prevMemo.id)}')" style="flex-shrink:0;background:none;border:none;font-size:14px;color:var(--text3);padding:2px 4px;cursor:pointer;line-height:1;" title="이전 메모 삭제">🗑️</button>
                </div>`;
            }
        }
        return `<div class="${cardClass}">
            <div class="order-top">
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <div class="order-client-name" onclick="showClientStatement('${cName}','${o.date.slice(0,7)}')">${highlight(o.clientName||'(거래처없음)', q)}</div>
                    <div class="order-date">${escapeHtml(o.date)}</div>
                    <button class="${memoClass}" onclick="openMemoPopup('${oId}')">📝 ${o.note ? '메모수정' : '메모'}</button>
                </div>
                ${badgeHtml}
            </div>
            <div class="order-items">${(o.items||[]).map(i=>`${highlight(i.name,q)} ${escapeHtml(Math.abs(i.qty))}개 × ${fmt(i.price)}원`).join('<br>')}</div>
            ${memoBodyHtml}
            <div class="order-bottom"><div class="order-total">${fmt(o.total)}원</div></div>
            <div class="order-actions">
                <button class="btn btn-ghost btn-sm" onclick="showOrderDetail('${oId}')">🔍<span class="btn-label">상세</span></button>
                ${o._sharedWsId
                    ? `<span class="shared-order-badge">📦 ${escapeHtml(o._sharedWsLabel||o._sharedWsId||'공유')}</span>`
                    : voided
                        ? `<button class="btn btn-primary btn-sm" onclick="openOrderEdit('${oId}')">✏️<span class="btn-label">수정</span></button><button class="btn btn-ghost btn-sm" onclick="toggleVoidOrder('${oId}')" style="color:var(--green);border-color:rgba(32,192,92,.4);">↩<span class="btn-label">내거래로</span></button>`
                        : `<button class="btn btn-primary btn-sm" onclick="openOrderEdit('${oId}')">✏️<span class="btn-label">수정</span></button>`
                }
                ${o._sharedWsId ? '' : `<button class="btn btn-ghost btn-sm" onclick="openClientEditFromHistory('${cId}','${cName}')">🏪<span class="btn-label">거래처</span></button>`}
                <button class="btn btn-danger btn-sm" onclick="deleteOrder('${oId}')">🗑️<span class="btn-label">삭제</span></button>
            </div>
        </div>`;
    };

    // ── 날짜순 ──
    if (histSortMode === 'date') {
        const sorted = [...filtered].sort((a,b) => {
            if (b.date > a.date) return 1;
            if (b.date < a.date) return -1;
            return (b.createdAt||'') > (a.createdAt||'') ? 1 : -1;
        });
        el.innerHTML = sorted.map(orderCardHTML).join('');
        return;
    }

    // ── 거래처순 / 최근거래순: 거래처별 그룹 ──
    const groupMap = {};
    filtered.forEach(o => {
        const key = o.clientName || '(거래처없음)';
        if (!groupMap[key]) groupMap[key] = { name:key, orders:[] };
        groupMap[key].orders.push(o);
    });
    Object.values(groupMap).forEach(g => {
        // 각 그룹 내부: 날짜 내림차순, 같은 날엔 등록시각 내림차순
        g.orders.sort((a,b) => {
            if (b.date > a.date) return 1;
            if (b.date < a.date) return -1;
            return (b.createdAt||'') > (a.createdAt||'') ? 1 : -1;
        });
        // lastDate: 그룹 내 가장 최신 날짜 (정렬 후 첫 번째)
        g.lastDate = g.orders[0]?.date || '';
        g.lastAt   = g.orders[0]?.createdAt || '';
        g.unpaid   = g.orders.filter(o=>!o.isPaid).reduce((s,o)=>s+o.total,0);
        const _et  = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
        g.total    = g.orders.reduce((s,o)=>s+_et(o),0);
    });
    const groups = Object.values(groupMap);
    if (histSortMode === 'recent') {
        // 최근 납품일 내림차순 → 같은 날이면 등록시각 내림차순
        groups.sort((a,b) => {
            if (b.lastDate > a.lastDate) return 1;
            if (b.lastDate < a.lastDate) return -1;
            return (b.lastAt||'') > (a.lastAt||'') ? 1 : -1;
        });
    } else {
        groups.sort((a,b) => a.name.localeCompare(b.name,'ko'));
    }
    el.innerHTML = groups.map(g => `
        <div style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:8px 13px;background:var(--surf2);
                        border:1px solid var(--border);border-bottom:2px solid var(--accent)44;
                        border-radius:10px 10px 0 0;">
                <div style="display:flex;align-items:center;gap:7px;">
                    <span style="font-size:13px;font-weight:800;color:var(--text1);">${highlight(g.name,q)}</span>
                    <span style="font-size:11px;color:var(--text3);background:var(--surf3);padding:1px 6px;border-radius:20px;">${g.orders.length}건</span>
                </div>
                <div style="text-align:right;line-height:1.5;">
                    <div style="font-size:12px;font-weight:700;color:var(--accent);">${fmt(g.total)}원</div>
                    ${g.unpaid>0?`<div style="font-size:11px;color:var(--red);font-weight:700;">미수 ${fmt(g.unpaid)}원</div>`:''}
                    <div style="font-size:10px;color:var(--text3);">최근납품 ${escapeHtml(g.lastDate)}</div>
                </div>
            </div>
            <div style="border:1px solid var(--border);border-top:none;border-radius:0 0 10px 10px;overflow:hidden;">
                ${g.orders.map(orderCardHTML).join('')}
            </div>
        </div>`).join('');
}

async function togglePaid(id) {
    // 완납 → 미수 복귀 전용 (미수→완납은 openQuickPay로)
    const foundToggle = _findOrderAnywhere(id);
    if (!foundToggle) return;
    const o = foundToggle.order;
    if (o.isPaid) {
        if (!await customConfirm('완납을 취소하고 미수로 되돌릴까요?')) return;
        const patch = { isPaid: false, paidAmount: 0, paidAt: null, paidNote: null,
                        paidMethod: null, discount: null, paidMethodDetail: null,
                        crmControlled: null, dlControlled: null };
        // ★ v113 fix: 완납→미수 복귀 후 statementModal이 열려있으면 즉시 갱신
        // ★ v130 fix: 지금 사용자가 보고 있는 화면(명세표)부터 맨 먼저, 그리고 각각 독립적으로
        // 안전하게 갱신 — 이 중 하나가 예외를 던져도 나머지(특히 명세표)는 계속 갱신됨
        const _refreshStatement = () => {
            if (document.getElementById('statementModal')?.classList.contains('open')) {
                const month = (o.date || '').slice(0, 7);
                showClientStatement(o.clientName, month);
            }
        };
        if (foundToggle.isShared) {
            const ok = await _patchSharedOrder(foundToggle.sharedWsId, id, patch);
            if (ok) {
                _safeRefresh(_refreshStatement, renderOrders, renderDashboard, updateInfoCounts, updateNavBadges, _refreshUnpaidIfActive, _refreshSettlementIfActive);
                toast('🔴 미수로 변경');
                // 공유 전표도 CRM 역방향 패치 (미수금 상태로 반영)
                _afterDlPayPatch(id, { ...o, ...patch });
            }
        } else {
            Object.assign(o, patch);
            _markDirtyOrder(id);
            _saveAndFlush();
            _safeRefresh(_refreshStatement, renderOrders, renderDashboard, updateInfoCounts, updateNavBadges, _refreshUnpaidIfActive, _refreshSettlementIfActive);
            toast('🔴 미수로 변경');
            _afterDlPayPatch(id, o);
        }
    } else {
        openQuickPay(id);
    }
}

// ─── 수금방법 퀵 선택 팝업 ───
function openQuickPay(orderId) {
    const foundQp = _findOrderAnywhere(orderId);
    if (!foundQp) return;
    const o = foundQp.order;
    document.getElementById('qpOrderId').value = orderId;
    document.getElementById('qpTitle').textContent = o.clientName || '수금 처리';
    document.getElementById('qpSub').textContent   = o.date + ' · ' + fmt(o.total) + '원';
    const remain = o.total - (o.paidAmount || 0);
    document.getElementById('qpCashAmt').textContent     = fmt(remain) + '원';
    document.getElementById('qpTransferAmt').textContent = fmt(remain) + '원';
    // 할인 영역 초기화
    document.getElementById('qpDiscountBody').style.display = 'none';
    document.getElementById('qpDiscountToggle').classList.remove('open');
    document.getElementById('qpDiscountAmt').value = '';
    document.getElementById('qpDiscountPreview').textContent = '';
    document.getElementById('quickPayOverlay').classList.add('open');
    document.getElementById('quickPayPopup').classList.add('open');
}

function toggleQpDiscount() {
    const body   = document.getElementById('qpDiscountBody');
    const toggle = document.getElementById('qpDiscountToggle');
    const open   = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    toggle.classList.toggle('open', !open);
    if (!open) setTimeout(() => document.getElementById('qpDiscountAmt')?.focus(), 80);
}

function updateQpDiscountPreview() {
    const orderId = document.getElementById('qpOrderId').value;
    const o = orders.find(x => x.id === orderId);
    if (!o) return;
    const remain  = o.total - (o.paidAmount || 0);
    const input   = _moneyVal('qpDiscountAmt');
    const preview = document.getElementById('qpDiscountPreview');
    if (input <= 0) { preview.textContent = ''; return; }
    if (input > remain) {
        preview.innerHTML = `<span style="color:var(--red);">⚠ 청구금액(${fmt(remain)}원)을 초과합니다</span>`;
        return;
    }
    const discount = remain - input;
    if (discount === 0) {
        preview.innerHTML = `<span style="color:var(--green);">할인 없음 → 전액 완납</span>`;
    } else {
        preview.innerHTML = `실수령 <strong>${fmt(input)}원</strong> · <span style="color:var(--orange);">할인 ${fmt(discount)}원</span> → ✅ 완납`;
    }
}

async function confirmQuickPayDiscount(method) {
    const orderId = document.getElementById('qpOrderId').value;
    const foundDisc = _findOrderAnywhere(orderId);
    if (!foundDisc) return;
    const o = foundDisc.order;
    const remain = o.total - (o.paidAmount || 0);
    const input  = _moneyVal('qpDiscountAmt');
    if (input <= 0) return toast('❗ 실수령액을 입력하세요');
    if (input > remain) return toast('❗ 실수령액이 청구금액보다 많습니다');
    const discount = remain - input;
    const patch = {
        isPaid:     true,
        paidAmount: (o.paidAmount || 0) + input,
        paidAt:     new Date().toISOString(),
        paidMethod: method,
        crmControlled: null,
    };
    if (discount > 0) patch.discount = (o.discount || 0) + discount;
    const icon = method === 'transfer' ? '🏦' : '💵';
    const msg  = discount > 0 ? `${icon} 할인 완납 (할인 ${fmt(discount)}원)` : `${icon} 완납 처리`;
    // ★ v113 fix: patch 적용 후 closeQuickPay 호출 — 순서가 바뀌면 showClientStatement 시점에 o.isPaid가 false라 미수로 보임
    if (foundDisc.isShared) {
        const ok = await _patchSharedOrder(foundDisc.sharedWsId, orderId, patch);
        if (ok) {
            closeQuickPay(true);
            _safeRefresh(renderOrders, renderDashboard, updateInfoCounts, updateNavBadges, _refreshUnpaidIfActive, _refreshSettlementIfActive);
            toast(msg, 'var(--green)');
            _afterDlPayPatch(orderId, o);
        }
    } else {
        Object.assign(o, patch);
        _markDirtyOrder(orderId);
        closeQuickPay(true);
        _saveAndFlush();
        _safeRefresh(renderOrders, renderDashboard, updateInfoCounts, updateNavBadges, _refreshUnpaidIfActive, _refreshSettlementIfActive);
        toast(msg, 'var(--green)');
        _afterDlPayPatch(orderId, o);
    }
}

// ─── 명세표에서 퀵페이 열기 (결제 후 명세표 자동 갱신) ───
let _qpStatementCtx = null; // { clientName, month }

function openQuickPayFromStatement(orderId, clientName, month) {
    const foundQps = _findOrderAnywhere(orderId);
    if (!foundQps) return;
    const o = foundQps.order;
    if (o.isPaid) { showOrderDetail(orderId); return; } // 완납이면 상세만
    _qpStatementCtx = { clientName, month };
    openQuickPay(orderId);
}

function closeQuickPay(paid = false) {
    document.getElementById('quickPayOverlay').classList.remove('open');
    document.getElementById('quickPayPopup').classList.remove('open');
    // 결제 완료 후 명세표가 열려있으면 갱신, 취소면 컨텍스트만 초기화
    if (_qpStatementCtx) {
        const { clientName, month } = _qpStatementCtx;
        _qpStatementCtx = null;
        if (paid && document.getElementById('statementModal')?.classList.contains('open')) {
            showClientStatement(clientName, month);
        }
    }
}

async function confirmQuickPay(method) {
    const orderId = document.getElementById('qpOrderId').value;
    const foundCqp = _findOrderAnywhere(orderId);
    if (!foundCqp) return;
    const o = foundCqp.order;
    const patch = {
        isPaid: true, paidAmount: o.total,
        paidAt: new Date().toISOString(),
        paidMethod: method, crmControlled: null
    };
    const icon = method === 'transfer' ? '🏦' : '💵';
    const label = icon + ' ' + (method === 'transfer' ? '계좌이체' : '현금') + ' 완납 처리';
    if (foundCqp.isShared) {
        // ★ v113 fix: _patchSharedOrder 성공 확인 후 팝업 닫기 (구버전 데이터로 statement 갱신 방지)
        const ok = await _patchSharedOrder(foundCqp.sharedWsId, orderId, patch);
        if (ok) {
            closeQuickPay(true);
            _safeRefresh(renderOrders, renderDashboard, updateInfoCounts, updateNavBadges, _refreshUnpaidIfActive, _refreshSettlementIfActive);
            toast(label, 'var(--green)');
            // 공유 전표도 CRM 역방향 패치 (wsId는 crm-sync가 _sharedWsId로 판단)
            _afterDlPayPatch(orderId, o);
        }
    } else {
        // ★ v113 fix: Object.assign 먼저 실행해 o.isPaid=true 반영 후 closeQuickPay 호출
        // (closeQuickPay 내부에서 showClientStatement를 바로 호출하므로 patch가 적용된 상태여야 함)
        Object.assign(o, patch);
        _markDirtyOrder(orderId);
        closeQuickPay(true);
        _saveAndFlush();
        _safeRefresh(renderOrders, renderDashboard, updateInfoCounts, updateNavBadges, _refreshUnpaidIfActive, _refreshSettlementIfActive);
        toast(label, 'var(--green)');
        _afterDlPayPatch(orderId, o);
    }
}

function toggleVoidOrder(id) {
    const o = orders.find(o => o.id === id);
    if (!o) return;
    o.isVoid = !o.isVoid;
    _markDirtyOrder(id); // delta sync 마킹
    saveData();
    _safeRefresh(renderOrders, renderDashboard, updateInfoCounts, updateNavBadges, _refreshUnpaidIfActive, _refreshSettlementIfActive);
    toast(o.isVoid ? '👤 타인거래로 변경 — 재고 차감 미반영' : '↩ 내 거래로 변경 — 재고는 수동 확인 필요', o.isVoid ? 'var(--orange)' : 'var(--green)');
}

async function deleteOrder(id) {
    if (!await customConfirm('전표를 삭제할까요?')) return;

    // 공유 내역이면 A의 Firebase에서 삭제
    const foundAnywhere = _findOrderAnywhere(id);
    if (!foundAnywhere) return;
    if (foundAnywhere.isShared) {
        const o = foundAnywhere.order;
        // ── 자동 재고 보정 (공유 대납 전표 — 내가 대납한 거래이므로 삭제 시 내 재고도 복구) ──
        let doRestoreShared = false;
        let matchedItemsShared = [];
        if (stockAutoDeduct && !o.isVoid) {
            matchedItemsShared = (o.items||[]).filter(it => findStockByName(it.name));
            if (matchedItemsShared.length > 0) {
                const isReturnShared = !!o.isReturn;
                doRestoreShared = await customConfirm(
                    `자동 재고 차감이 켜져 있습니다.\n\n` +
                    `이 공유 대납 ${isReturnShared ? '반품/회수' : '납품'} 전표(${o.clientName} · ${o.date})의\n` +
                    `재고를 ${isReturnShared ? '다시 차감' : '복구'}할까요?\n\n` +
                    matchedItemsShared.map(it => {
                        const q = Number(it.qty)||0;
                        return `· ${it.name} ${q>0?'+':''}${q}${findStockByName(it.name)?.unit||''}`;
                    }).join('\n'),
                    isReturnShared ? '재고 차감' : '재고 복구', 'btn-primary'
                );
            }
        }
        const ok = await _patchSharedOrder(foundAnywhere.sharedWsId, id, null);
        if (ok) {
            if (doRestoreShared) {
                matchedItemsShared.forEach(it => {
                    const si = findStockByName(it.name);
                    if (!si) return;
                    const before = si.qty;
                    si.qty = Math.max(0, before + (Number(it.qty)||0));
                    (si.log = si.log||[]).unshift({
                        type:'restore', qty: si.qty-before, before, after:si.qty,
                        reason:(o.isReturn ? '공유대납반품삭제차감(' : '공유대납삭제복구(')+o.clientName+'·'+o.date+')',
                        date: todayKST(), originalDate: o.date, at: new Date().toISOString()
                    });
                    si.log = _trimLogByDate(si.log);
                });
                saveData(true); // ★ 재고 변경분을 내 로컬/Firebase에 저장
                _refreshStockIfActive();
                toast(o.isReturn ? '↩ 재고가 다시 차감되었습니다' : '↩ 재고가 복구되었습니다', 'var(--green)');
            }
            renderOrders();
            updateInfoCounts();
            renderDashboard();
            updateNavBadges();
            _refreshUnpaidIfActive();
            _refreshSettlementIfActive();
            // 명세표가 열려 있으면 갱신
            const statModal = document.getElementById('statementModal');
            if (statModal?.classList.contains('open')) {
                const clientNameEl = statModal.querySelector('[data-client-name]');
                const monthEl = statModal.querySelector('[data-month]');
                if (clientNameEl && monthEl) showClientStatement(clientNameEl.dataset.clientName, monthEl.dataset.month);
            }
            toast('🗑️ 공유 전표 삭제 완료');
        }
        return;
    }

    const o = orders.find(o=>o.id===id);
    if (!o) return;

    // ── 자동 재고 보정 (stockAutoDeduct ON이고 타인거래가 아니고 재고에 등록된 품목이 있을 때) ──
    // 일반 납품 삭제 → 차감했던 재고를 복구(+) / 반품·회수 삭제 → 입고했던 재고를 다시 차감(-)
    if (stockAutoDeduct && !o.isVoid) {
        const matchedItems = (o.items||[]).filter(it => findStockByName(it.name));
        if (matchedItems.length > 0) {
            const isReturn = !!o.isReturn;
            const doRestore = await customConfirm(
                `자동 재고 차감이 켜져 있습니다.\n\n` +
                `이 ${isReturn ? '반품/회수' : '납품'} 전표(${o.clientName} · ${o.date})의\n` +
                `재고를 ${isReturn ? '다시 차감' : '복구'}할까요?\n\n` +
                matchedItems.map(it => {
                    const q = Number(it.qty)||0;
                    return `· ${it.name} ${q>0?'+':''}${q}${findStockByName(it.name)?.unit||''}`;
                }).join('\n'),
                isReturn ? '재고 차감' : '재고 복구', 'btn-primary'
            );
            if (doRestore) {
                matchedItems.forEach(it => {
                    const si = findStockByName(it.name);
                    if (!si) return;
                    const before = si.qty;
                    si.qty = Math.max(0, before + (Number(it.qty)||0));
                    (si.log = si.log||[]).unshift({
                        type:'restore', qty: si.qty-before, before, after:si.qty,
                        reason:(isReturn ? '반품전표삭제차감(' : '납품삭제복구(')+o.clientName+'·'+o.date+')',
                        date: todayKST(), originalDate: o.date, at: new Date().toISOString()
                    });
                    si.log = _trimLogByDate(si.log);
                });
                // 재고 갱신은 아래 공통 처리에서
                toast(isReturn ? '↩ 재고가 다시 차감되었습니다' : '↩ 재고가 복구되었습니다', 'var(--green)');
            }
        }
    }

    orders = orders.filter(o=>o.id!==id);
    _markDeletedOrder(id); // delta sync 마킹
    saveData();
    _safeRefresh(renderOrders, updateInfoCounts, renderDashboard, updateNavBadges, _refreshUnpaidIfActive, _refreshStockIfActive, _refreshSettlementIfActive);
    toast('🗑️ 전표 삭제 완료');
}

// ─── 내역탭 거래처 정보 수정 ───

function openClientEditFromHistory(clientId, clientName) {
    // clientId로 먼저 찾고, 없으면 이름으로 탐색
    const c = clients.find(c => c.id === clientId)
           || clients.find(c => c.name === clientName);
    if (!c) {
        return toast('❗ 거래처 정보를 찾을 수 없습니다\n(거래처 탭에서 먼저 등록해주세요)');
    }
    document.getElementById('ceditClientId').value  = c.id;
    document.getElementById('ceditName').value      = c.name;
    document.getElementById('ceditPhone').value     = c.phone   || '';
    document.getElementById('ceditAddress').value   = c.address || '';
    document.getElementById('ceditNote').value      = c.note    || '';
    document.getElementById('ceditNewName').value   = '';
    // 이름 변경 섹션 접기 초기화
    document.getElementById('ceditRenameBody').style.display = 'none';
    document.getElementById('ceditRenameArrow').textContent  = '▼';
    openModal('clientEditModal');
}

function toggleCeditRename() {
    const body  = document.getElementById('ceditRenameBody');
    const arrow = document.getElementById('ceditRenameArrow');
    const open  = body.style.display !== 'none';
    body.style.display  = open ? 'none' : 'block';
    arrow.textContent   = open ? '▼' : '▲';
    if (!open) setTimeout(() => document.getElementById('ceditNewName').focus(), 50);
}

function saveClientEditFromHistory() {
    const id      = document.getElementById('ceditClientId').value;
    const phone   = document.getElementById('ceditPhone').value.trim();
    const address = document.getElementById('ceditAddress').value.trim();
    const note    = document.getElementById('ceditNote').value.trim();
    const newName = document.getElementById('ceditNewName').value.trim();

    const c = clients.find(c => c.id === id);
    if (!c) return toast('❗ 거래처를 찾을 수 없습니다');

    // 이름 변경 처리
    if (newName && newName !== c.name) {
        // 중복 체크
        const dup = clients.some(x => x.name.toLowerCase() === newName.toLowerCase() && x.id !== id);
        if (dup) return toast('❗ 이미 존재하는 거래처명입니다');
        const oldName = c.name;
        c.name = newName;
        // 관련 전표에 이름 일괄 반영
        let orderCount = 0;
        const oldNameTrim = oldName.trim();
        orders.forEach(o => {
            const idMatch   = o.clientId && o.clientId === id;
            const nameMatch = (o.clientName || '').trim() === oldNameTrim;
            if (idMatch || nameMatch) {
                o.clientName = newName;
                if (!o.clientId || o.clientId !== id) {
                    o.clientId = id;
                }
                _markDirtyOrder(o.id); // delta sync 마킹
                orderCount++;
            }
        });
        toast(`✅ 거래처명 변경 완료 (전표 ${orderCount}건 반영)`, 'var(--green)');
    }

    c.phone     = phone;
    c.address   = address;
    c.note      = note;
    c.updatedAt = new Date().toISOString();

    saveData();
    renderOrders();
    renderClients();
    renderDashboard();
    updateNavBadges();
    _refreshSettlementIfActive();
    closeModal('clientEditModal');
    if (!newName) toast('✅ 거래처 정보가 수정되었습니다', 'var(--green)');
}

// ─── 전표 수정 ───
let _oeditItems = [];   // 현재 편집 중인 품목 배열
let _oeditIsReturn = false; // 현재 편집 중인 전표가 반품/회수 전표인지 (수량 입력 UI 부호 처리용)

function openOrderEdit(id) {
    // 공유 내역 포함 탐색
    const found = _findOrderAnywhere(id);
    if (!found) return toast('❗ 전표를 찾을 수 없습니다');
    const o = found.order;
    // 공유 내역이면 모달에 표시
    const editTitle = document.getElementById('orderEditTitle') || document.getElementById('orderEditModal')?.querySelector('.card-title');
    if (editTitle) editTitle.textContent = found.isShared ? `📦 공유 납품 수정 (${found.sharedWsId})` : (o.isReturn ? '↩ 반품/회수 수정' : '납품 수정');
    document.getElementById('oeditOrderId').value    = id;
    document.getElementById('oeditClientName').value = o.clientName || '';
    document.getElementById('oeditDate').value       = o.date || '';
    document.getElementById('oeditNote').value       = o.note || '';
    _oeditItems = (o.items || []).map(it => ({ ...it }));  // 깊은 복사
    _oeditIsReturn = !!o.isReturn; // 반품/회수 전표면 수량 입력 UI를 양수로 보여주고 저장 시 부호 반전
    // ③ 타인거래 토글 초기화 — 반품/회수 전표는 타인거래와 동시에 적용될 수 없으므로 토글 자체를 숨기고 OFF로 고정
    const voidWrap = document.getElementById('oeditVoidToggleWrap');
    if (voidWrap) voidWrap.style.display = o.isReturn ? 'none' : 'flex';
    _applyOeditVoidUI(o.isReturn ? false : !!o.isVoid);
    renderOeditItems();
    openModal('orderEditModal');
}

// ③ 타인거래 토글 UI 적용
function _applyOeditVoidUI(isVoid) {
    const sw   = document.getElementById('oeditVoidSwitch');
    const knob = document.getElementById('oeditVoidKnob');
    if (!sw || !knob) return;
    // data-void 속성으로 상태 관리 (DOM 스타일 비교 취약점 제거)
    sw.dataset.void = isVoid ? '1' : '0';
    if (isVoid) {
        sw.style.background   = 'rgba(245,166,35,0.25)';
        sw.style.borderColor  = 'rgba(245,166,35,0.6)';
        knob.style.background = 'var(--orange)';
        knob.style.transform  = 'translateX(20px)';
    } else {
        sw.style.background   = 'var(--surf3)';
        sw.style.borderColor  = 'var(--border)';
        knob.style.background = 'var(--text3)';
        knob.style.transform  = 'translateX(0)';
    }
}

// ③ 토글 클릭 시 상태 전환
function toggleOeditVoid() {
    const sw   = document.getElementById('oeditVoidSwitch');
    if (!sw) return;
    // 현재 ON 여부: knob이 오른쪽으로 이동해 있으면 ON
    const knob = document.getElementById('oeditVoidKnob');
    const isCurrentlyVoid = sw.dataset.void === '1';
    _applyOeditVoidUI(!isCurrentlyVoid);
}

function renderOeditItems() {
    const list = document.getElementById('oeditItemList');
    if (!_oeditItems.length) {
        // items가 없는 경우: _noItems 전표(오프라인 저장 시 압축됨)인지 일반 빈 전표인지 구분 불가
        // → 안내 메시지 표시
        list.innerHTML = '<div style="text-align:center;color:var(--text3);font-size:13px;padding:12px 0;margin-bottom:8px;">품목이 없습니다. 온라인 연결 후 앱을 재실행하면 품목이 복원됩니다.<br>직접 추가하셔도 됩니다.</div>';
    } else {
        list.innerHTML = _oeditItems.map((it, i) => {
            const isLast = i === _oeditItems.length - 1;
            const nextNameSel = isLast ? null : `.oedit-item-row:nth-child(${i+2}) .oedit-item-input`;
            const onPriceEnter = isLast
                ? `if(event.key==='Enter'){event.preventDefault();const nn=document.getElementById('oeditNewName');if(nn&&nn.value.trim()){nn.focus();}else{saveOrderEdit();}}`
                : `if(event.key==='Enter'){event.preventDefault();document.querySelectorAll('.oedit-item-row')[${i+1}].querySelectorAll('.oedit-item-input')[0].focus();}`;
            return `
            <div class="oedit-item-row">
                <div class="oedit-item-name">
                    <input class="oedit-item-input" type="text" value="${(it.name||'').replace(/"/g,'&quot;')}"
                        enterkeyhint="next"
                        oninput="_oeditItems[${i}].name=this.value;_oeditRecalc()"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.closest('.oedit-item-row').querySelectorAll('.oedit-item-input')[1].focus();}"
                        style="width:100%;font-weight:700;">
                </div>
                <div class="oedit-qty-wrap">
                    <input class="oedit-item-input" type="number" value="${Math.abs(it.qty||0)}" min="1"
                        enterkeyhint="next"
                        oninput="_oeditItems[${i}].qty=(parseInt(this.value)||0)*(_oeditIsReturn?-1:1);_oeditItems[${i}].total=_oeditItems[${i}].qty*_oeditItems[${i}].price;_oeditRecalc()"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.closest('.oedit-item-row').querySelectorAll('.oedit-item-input')[2].focus();}">
                </div>
                <div class="oedit-price-wrap">
                    <input class="oedit-item-input" type="text" inputmode="numeric" value="${(it.price||0)>0?Number(it.price).toLocaleString('ko-KR'):0}" min="0"
                        data-oedit-price="${i}"
                        enterkeyhint="${isLast ? 'next' : 'next'}"
                        oninput="(function(el,idx){const v=parseInt(el.value.replace(/[^0-9]/g,''))||0;_oeditItems[idx].price=v;_oeditItems[idx].total=_oeditItems[idx].qty*v;_oeditRecalc();const f=v>0?v.toLocaleString('ko-KR'):el.value;if(el.value!==f){const s=el.selectionStart;el.value=f;try{el.setSelectionRange(f.length,f.length);}catch(e){}};})(this,${i})"
                        onkeydown="${onPriceEnter}">
                </div>
                <button class="oedit-del-btn" onclick="_oeditItems.splice(${i},1);renderOeditItems()">✕</button>
            </div>`;
        }).join('');
    }
    _oeditRecalc();
}

function _oeditRecalc() {
    const total = _oeditItems.reduce((s, it) => s + (Number(it.qty)||0) * (Number(it.price)||0), 0);
    const el = document.getElementById('oeditTotal');
    if (el) { el.textContent = fmt(total) + '원'; el.style.color = total < 0 ? 'var(--red)' : ''; }
}

function oeditAddItem() {
    const name  = (document.getElementById('oeditNewName').value  || '').trim();
    const qty   = parseInt(document.getElementById('oeditNewQty').value)   || 0;
    const price = _moneyVal('oeditNewPrice');
    if (!name)  return toast('❗ 품목명을 입력하세요');
    if (qty <= 0) return toast('❗ 수량을 1 이상 입력하세요');
    const signedQty = _oeditIsReturn ? -qty : qty;
    _oeditItems.push({ name, qty: signedQty, price, total: signedQty * price });
    document.getElementById('oeditNewName').value  = '';
    document.getElementById('oeditNewQty').value   = '';
    document.getElementById('oeditNewPrice').value = '';
    renderOeditItems();
    document.getElementById('oeditNewName').focus();
}

async function saveOrderEdit() {
    const id   = document.getElementById('oeditOrderId').value;
    const date = document.getElementById('oeditDate').value;
    const note = document.getElementById('oeditNote').value.trim();
    if (!date) return toast('❗ 납품 일자를 선택하세요');
    if (!_oeditItems.length) return toast('❗ 품목을 1개 이상 추가하세요');
    // 품목명 공백 체크
    if (_oeditItems.some(it => !(it.name||'').trim())) return toast('❗ 품목명을 모두 입력하세요');

    // 공유 내역 포함 탐색
    const foundEdit = _findOrderAnywhere(id);
    if (!foundEdit) return toast('❗ 전표를 찾을 수 없습니다');
    const o = foundEdit.order;

    // ── 공유 내역이면 A의 Firebase에 저장하되, 내가 대납한 거래이므로 내 재고도 수량 차이만큼 보정 ──
    if (foundEdit.isShared) {
        const items = _oeditItems.map(it => ({
            name:  (it.name||'').trim(),
            qty:   Number(it.qty)   || 0,
            price: Number(it.price) || 0,
            total: (Number(it.qty)||0) * (Number(it.price)||0)
        }));
        const total = items.reduce((s, it) => s + it.total, 0);
        const patch = { date, items, total, note };
        const oeditSw = document.getElementById('oeditVoidSwitch');
        const newIsVoidShared = oeditSw ? oeditSw.dataset.void === '1' : !!o.isVoid;
        patch.isVoid = newIsVoidShared;
        const wasVoidShared = !!o.isVoid;
        const oldItemsShared = [...(o.items||[])]; // Firebase 저장 전에 수정 전 품목 스냅샷 확보
        items.forEach(it => { if (it.price > 0) prices[it.name] = it.price; });
        const ok = await _patchSharedOrder(foundEdit.sharedWsId, id, patch);
        if (ok) {
            // ── 자동 재고 보정 (수정 전후 수량 차이 반영) — 저장 성공 후에만 적용 ──
            if (stockAutoDeduct && !newIsVoidShared) {
                const oldMap = {};
                if (!wasVoidShared) {
                    oldItemsShared.forEach(it => {
                        const key = normItemName(it.name);
                        oldMap[key] = (oldMap[key]||0) + (Number(it.qty)||0);
                    });
                }
                const newMap = {};
                items.forEach(it => {
                    const key = normItemName(it.name);
                    newMap[key] = (newMap[key]||0) + (Number(it.qty)||0);
                });
                const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
                const reasonLabelShared = wasVoidShared ? '타인거래→내거래 전환반영' : '공유대납수정보정';
                allKeys.forEach(key => {
                    const oldQty = oldMap[key]||0;
                    const newQty = newMap[key]||0;
                    const diff   = newQty - oldQty;
                    if (diff === 0) return;
                    const itemName = (items.find(it=>normItemName(it.name)===key)||oldItemsShared.find(it=>normItemName(it.name)===key)||{}).name||key;
                    const si = findStockByName(itemName);
                    if (!si) return;
                    const before = si.qty;
                    si.qty = Math.max(0, before - diff);
                    const actual = si.qty - before;
                    (si.log = si.log||[]).unshift({
                        type: 'edit_adj', qty: actual, before, after: si.qty,
                        reason: reasonLabelShared + '(' + (o.clientName||'') + ')',
                        date: todayKST(), at: new Date().toISOString()
                    });
                    si.log = _trimLogByDate(si.log);
                });
                saveData(true); // ★ 재고 변경분을 내 로컬/Firebase에 저장
                _refreshStockIfActive();
            }
            closeModal('orderEditModal');
            // ★ v130 fix: 렌더/갱신 체인 중 하나가 던지면 뒤쪽(특히 명세표 갱신·완료 토스트)이
            // 통째로 실행 안 되던 문제 — 명세표 갱신을 맨 앞으로, 전부 독립 실행으로 분리.
            _safeRefresh(
                () => { if (document.getElementById('statementModal')?.classList.contains('open')) showClientStatement(o.clientName, (patch.date || o.date).slice(0, 7)); },
                renderOrders, renderDashboard, updateInfoCounts, updateNavBadges,
                _refreshUnpaidIfActive, _refreshSettlementIfActive,
                () => toast('✅ 공유 납품 내역이 수정되었습니다', 'var(--green)')
            );
        }
        return;
    }

    // ③ 타인거래 토글 — 재고 보정 분기에 필요하므로 미리 계산
    const oeditSw   = document.getElementById('oeditVoidSwitch');
    const newIsVoid = oeditSw ? oeditSw.dataset.void === '1' : !!o.isVoid;
    const wasVoid   = !!o.isVoid;

    // ── 자동 재고 보정 (수정 전후 수량 차이 반영) ──
    // 분기는 "수정 후" 상태(newIsVoid) 기준: 최종적으로 타인거래가 되면 재고를 건드리지 않음
    // (내거래→타인거래 전환 시 기존 차감분을 복구하지 않는 기존 정책과 동일하게 유지).
    // 반대로 타인거래였다가 내거래로 전환되면, 그동안 재고에 전혀 반영된 적이 없으므로
    // 수정 전 수량(oldMap)을 0으로 취급해 새 수량 전체를 차감한다.
    if (stockAutoDeduct && !newIsVoid) {
        // 수정 전 품목 맵 { 정규화된이름: qty } — 타인거래였다면 반영된 적 없으므로 비워둠
        const oldMap = {};
        if (!wasVoid) {
            (o.items||[]).forEach(it => {
                const key = normItemName(it.name);
                oldMap[key] = (oldMap[key]||0) + (Number(it.qty)||0);
            });
        }
        // 수정 후 품목 맵
        const newMap = {};
        _oeditItems.forEach(it => {
            const key = normItemName(it.name);
            newMap[key] = (newMap[key]||0) + (Number(it.qty)||0);
        });
        // 모든 품목명 합집합
        const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
        const reasonLabel = wasVoid ? '타인거래→내거래 전환반영' : '납품수정보정';
        allKeys.forEach(key => {
            const oldQty = oldMap[key]||0;
            const newQty = newMap[key]||0;
            const diff   = newQty - oldQty; // 양수면 더 납품, 음수면 덜 납품
            if (diff === 0) return;
            // 품목명은 newMap에 있으면 새 이름으로, 없으면 oldMap 이름으로 탐색
            const itemName = (_oeditItems.find(it=>normItemName(it.name)===key)||o.items.find(it=>normItemName(it.name)===key)||{}).name||key;
            const si = findStockByName(itemName);
            if (!si) return;
            const before = si.qty;
            // diff > 0 → 추가 납품 → 재고 감소 / diff < 0 → 수량 감소 → 재고 증가
            si.qty = Math.max(0, before - diff);
            const actual = si.qty - before;
            // 수정보정은 증가/감소 모두 'edit_adj' 사용
            // 'in' 사용 시 입고 통계 오염 및 refreshStockCarryover todayIn 이중 합산 문제 발생
            const logType = 'edit_adj';
            (si.log = si.log||[]).unshift({
                type: logType, qty: actual, before, after: si.qty,
                reason: reasonLabel + '(' + (o.clientName||'') + ')',
                date: todayKST(), at: new Date().toISOString()
            });
            si.log = _trimLogByDate(si.log);
        });
        // 재고 갱신은 아래 공통 처리에서
    }

    const items = _oeditItems.map(it => ({
        name:  (it.name||'').trim(),
        qty:   Number(it.qty)   || 0,
        price: Number(it.price) || 0,
        total: (Number(it.qty)||0) * (Number(it.price)||0)
    }));
    const total = items.reduce((s, it) => s + it.total, 0);

    o.date  = date;
    o.items = items;
    o.total = total;
    o.note  = note;
    o.updatedAt = new Date().toISOString();
    _markDirtyOrder(o.id); // delta sync 마킹
    // ③ 타인거래 토글 반영 (oeditSw/newIsVoid/wasVoid는 재고 보정 단계에서 이미 계산됨)
    o.isVoid = newIsVoid;
    // 재고 반영은 위 자동 재고 보정 단계에서 newIsVoid/wasVoid 기준으로 이미 처리됨
    // ── paidAmount 캡핑: 새 합계보다 초과 지불된 경우 조정 ──
    let _autoCompleted = false;
    if (!o.isPaid) {
        if ((o.paidAmount||0) >= total && total > 0) {
            o.isPaid     = true;
            o.paidAmount = total;
            // 수정으로 완납 처리 시 discount는 의미 없으므로 초기화
            delete o.discount;
            _autoCompleted = true;
        } else if ((o.paidAmount||0) > total) {
            o.paidAmount = 0;
            delete o.discount;
        }
    } else {
        // 이미 완납 상태면 paidAmount를 새 합계로 동기화, discount 재계산
        if (o.discount > 0) {
            // 할인 완납 전표: 실수령액이 새 합계보다 크면 discount 제거
            if ((o.paidAmount||0) >= total) {
                o.paidAmount = total;
                delete o.discount;
            }
        } else {
            o.paidAmount = total;
        }
    }
    // 단가 캐시 갱신
    items.forEach(it => { if (it.price > 0) prices[it.name] = it.price; });

    saveData();
    closeModal('orderEditModal');
    // ★ v130 fix: 같은 이유 — 명세표 갱신을 맨 앞으로, 전부 독립 실행으로 분리
    _safeRefresh(
        () => { if (document.getElementById('statementModal')?.classList.contains('open')) showClientStatement(o.clientName, o.date.slice(0, 7)); },
        renderOrders, renderDashboard, updateInfoCounts, updateNavBadges,
        () => updateItemDatalist(o.clientId || ''),
        _refreshUnpaidIfActive, _refreshStockIfActive, _refreshSettlementIfActive,
        () => {
            const voidMsg = newIsVoid !== wasVoid
                ? (newIsVoid ? ' · 👤 타인거래로 변경' : ' · ↩ 내거래로 변경')
                : '';
            toast(_autoCompleted
                ? '💚 수정 완료 — 단가 감소로 완납 처리되었습니다' + voidMsg
                : '✅ 납품 내역이 수정되었습니다' + voidMsg, 'var(--green)');
        }
    );
}

function showOrderDetail(id) {
    const foundDetail = _findOrderAnywhere(id);
    if (!foundDetail) return;
    const o = foundDetail.order;
    const sharedBadgeDetail = foundDetail.isShared
        ? `<span style="font-size:10px;background:#e0e7ff;color:#4f46e5;border-radius:4px;padding:2px 6px;margin-left:6px;font-weight:700;">📦 ${escapeHtml(o._sharedWsId)}</span>` : '';
    const returnBadgeDetail = o.isReturn
        ? `<span class="return-badge" style="margin-left:6px;">↩ 반품/회수</span>` : '';
    document.getElementById('detailContent').innerHTML = `
        <div style="margin-bottom:14px;">
            <div style="font-size:18px;font-weight:700;margin-bottom:4px;">${escapeHtml(o.clientName||'(없음)')}${sharedBadgeDetail}${returnBadgeDetail}</div>
            <div style="font-size:13px;color:var(--text2);">납품일: ${escapeHtml(o.date)}</div>
        </div>
        <div style="overflow-x:auto;">
        <table class="detail-table">
            <thead><tr><th>품목</th><th class="text-center">수량</th><th class="text-right">단가</th><th class="text-right">금액</th></tr></thead>
            <tbody>
                ${o._noItems
                    ? `<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px;font-size:12px;">📡 품목 상세는 온라인 연결 후 Firebase에서 조회됩니다</td></tr>`
                    : (o.items||[]).map(it=>`<tr><td>${escapeHtml(it.name)}</td><td class="text-center">${escapeHtml(Math.abs(it.qty))}</td><td class="text-right">${fmt(it.price)}원</td><td class="text-right">${fmt(it.qty*it.price)}원</td></tr>`).join('')
                }
            </tbody>
            <tfoot>
                <tr style="font-weight:700;"><td colspan="3">합계</td><td class="text-right">${fmt(o.total)}원</td></tr>
            </tfoot>
        </table>
        </div>
        ${o.note?`<div class="order-memo-body priority-${memoPriorityLevel(o)}" style="margin-top:12px;" onclick="closeModal('detailModal');openMemoPopup('${escapeAttr(o.id)}')"><strong>메모:</strong> ${escapeHtml(o.note)}</div>`:''}
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
            <button class="btn btn-ghost btn-sm" onclick="closeModal('detailModal');openOrderEdit('${escapeAttr(o.id)}')">✏️ 수정</button>
            <button class="btn btn-ghost btn-sm" onclick="closeModal('detailModal');openMemoPopup('${escapeAttr(o.id)}')">📝 메모</button>
            ${o.isReturn ? '' : (o.isPaid ? `<button class="btn btn-ghost btn-sm" onclick="closeModal('detailModal');togglePaid('${escapeAttr(o.id)}')">↩️ 미수 복귀</button>` : `<button class="btn btn-accent btn-sm" onclick="closeModal('detailModal');openQuickPay('${escapeAttr(o.id)}')">💳 수금</button>`)}
        </div>`;
    openModal('detailModal');
}

