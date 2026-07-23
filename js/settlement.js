// ╔══════════════════════════════════════════════════════════════╗
// ║  § 9  정산                                                     ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── 정산 ───

// ★ v116: 거래명세서 누계 토글 전역 함수
// ★ v120: 이월 행(carry_N 키)은 주황 계열로 구분 표시
function _toggleAccum(idx, trEl) {
    const rowId = 'accum-row-' + idx;
    const existing = document.getElementById(rowId);
    if (existing) { existing.remove(); return; }
    const info = (window._accumMap || {})[idx];
    if (!info) return;
    const isCarry = String(idx).startsWith('carry_');
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.style.cssText = isCarry ? 'background:rgba(245,158,11,0.10);' : 'background:rgba(99,102,241,0.08);';
    const color = isCarry ? '#d97706' : '#4f46e5';
    const label = isCarry ? '이월 누계' : '누계';
    tr.innerHTML = `<td colspan="4" style="padding:6px 12px;font-size:12px;color:${color};font-weight:700;">📊 ${info.date}까지 ${label}: ${fmt(info.total)}원</td>`;
    trEl.after(tr);
}


function setSettleUnit(btn) {
    document.querySelectorAll('.settle-unit-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    settleUnit = btn.dataset.unit;
    // 컨트롤 패널 토글
    document.getElementById('settle-ctrl-monthly').style.display   = settleUnit==='monthly'   ? '' : 'none';
    document.getElementById('settle-ctrl-daily').style.display     = settleUnit==='daily'     ? '' : 'none';
    document.getElementById('settle-ctrl-quarterly').style.display = settleUnit==='quarterly' ? '' : 'none';
    // 결과 섹션 토글
    document.getElementById('settle-section-monthly').style.display   = settleUnit==='monthly'   ? '' : 'none';
    document.getElementById('settle-section-daily').style.display     = settleUnit==='daily'     ? '' : 'none';
    document.getElementById('settle-section-quarterly').style.display = settleUnit==='quarterly' ? '' : 'none';
    // 월별 탭: settlementTable display를 settleListVisible과 동기화
    if (settleUnit === 'monthly') {
        const st = document.getElementById('settlementTable');
        const sb = document.getElementById('settleToggleBtn');
        if (st) st.style.display = settleListVisible ? 'block' : 'none';
        if (sb) sb.textContent = settleListVisible ? '숨기기' : '보이기';
    }
    // 렌더
    _refreshSettlementIfActive();
}

function setSettlePeriod(btn) {
    document.querySelectorAll('#settle-ctrl-monthly .period-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.period;
    if (p==='current') {
        document.getElementById('settlementMonth').value = todayKST().slice(0,7);
        renderSettlement();
    } else if (p==='last') {
        const cur = todayKST().slice(0,7); // 'YYYY-MM'
        const [y, m] = cur.split('-').map(Number);
        const prevM = m === 1 ? 12 : m - 1;
        const prevY = m === 1 ? y - 1 : y;
        document.getElementById('settlementMonth').value = `${prevY}-${String(prevM).padStart(2,'0')}`;
        renderSettlement();
    }
    // 'custom' → 사용자가 직접 month 인풋 조작
}

function setSettlePeriodDaily(btn) {
    document.querySelectorAll('#settle-ctrl-daily .period-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.dperiod;
    const input = document.getElementById('settlementDateDaily');
    const today = todayKST();
    if (p === 'today') {
        input.value = today;
    } else if (p === 'yesterday') {
        input.value = kstAddDays(today, -1);
    } else if (p === 'prev') {
        input.value = kstAddDays(input.value || today, -1);
    } else if (p === 'next') {
        input.value = kstAddDays(input.value || today, +1);
    }
    renderSettlementDaily();
}

function setSettleYearQuick(btn) {
    document.querySelectorAll('#settle-ctrl-quarterly .period-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const _yr = parseInt(todayKST().slice(0, 4));
    document.getElementById('settlementYear').value = btn.dataset.qy==='current' ? _yr : _yr-1;
    renderSettlementQuarterly();
}

function setSettleFilter(f, btn) {
    settleFilter = f;
    document.querySelectorAll('#settlePayFilter .chip').forEach(b=>b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _refreshSettlementIfActive();
}

// ── 공통 필터 적용 ──

function applyPayFilter(list) {
    // 타인거래도 모든 정산에 포함 (재고 차감만 제외)
    if (settleFilter==='unpaid') return list.filter(o=>!o.isPaid);
    if (settleFilter==='paid')   return list.filter(o=>o.isPaid);
    return list;
}

// ── 요약 박스 렌더 ──

function renderSummaryBox(totalSales, paidAmount, unpaidAmount) {
    document.getElementById('settlementSummary').innerHTML = `
        <div class="settlement-box">
            <div class="settlement-row"><span>총 매출</span><span>${fmt(totalSales)}원</span></div>
            <div class="settlement-row"><span>수금액</span><span>${fmt(paidAmount)}원</span></div>
            <div class="settlement-row"><span>미수금</span><span>${fmt(unpaidAmount)}원</span></div>
        </div>`;
}

// ── 월별 정산 ──

function renderSettlement() {
    const month = document.getElementById('settlementMonth').value;
    if (!month) return;
    let filtered = applyPayFilter(orders.filter(o=>!o.delegatedBy && o.date?.startsWith(month)));
    // ★ 그룹 필터
    if (window._settleGroupFilterActive) {
        filtered = filtered.filter(o => window._settleGroupFilterActive.has(o.clientName));
    }
    const _et = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
    const totalSales   = filtered.reduce((s,o)=>s+_et(o),0);
    const paidAmount   = filtered.reduce((s,o)=>s+_actualPaid(o),0);
    const unpaidAmount = totalSales - paidAmount;
    renderSummaryBox(totalSales, paidAmount, unpaidAmount);
    // 캐시
    window._settleMap = {};
    window._settleMonth = month;
    filtered.forEach(o => {
        const key = o.clientName||'(없음)';
        if (!window._settleMap[key]) window._settleMap[key]={total:0,paid:0,count:0};
        // ★ v123 fix: 할인 완납 전표는 실청구액(_et, total-discount)으로 집계해야
        // 미수 = total - paid 계산 시 할인분이 남은 미수처럼 잘못 표시되지 않는다.
        // (상단 요약 박스는 이미 _et를 쓰고 있었는데, 거래처별 테이블만 raw o.total을 쓰고 있었음)
        window._settleMap[key].total += _et(o);
        window._settleMap[key].paid += _actualPaid(o);
        window._settleMap[key].count++;
    });
    if (settleListVisible) renderSettleTable();
}

// ── 일별 정산 (날짜 선택 → 해당일 상세) ──

function renderSettlementDaily() {
    const date = document.getElementById('settlementDateDaily').value;
    const el = document.getElementById('settlementDailyTable');
    if (!date) {
        document.getElementById('settlementSummary').innerHTML = '';
        el.innerHTML = '<div class="empty"><div class="empty-text">날짜를 선택하세요</div></div>';
        return;
    }

    const dow = ['일','월','화','수','목','금','토'][new Date(date + 'T12:00:00+09:00').getDay()];
    const [yr, mo, dd] = date.split('-');
    const dateLabel = `${yr}년 ${parseInt(mo)}월 ${parseInt(dd)}일 (${dow})`;

    let dayOrders = applyPayFilter(orders.filter(o => !o.delegatedBy && o.date === date));
    const _et = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
    const totalSales  = dayOrders.reduce((s,o)=>s+_et(o),0);
    const paidAmount  = dayOrders.reduce((s,o)=>s+_actualPaid(o),0);
    const unpaidAmt   = totalSales - paidAmount;

    // 요약 박스
    document.getElementById('settlementSummary').innerHTML = `
        <div class="settlement-box">
            <div style="font-size:12px;opacity:.8;margin-bottom:8px;">📅 ${dateLabel}</div>
            <div class="settlement-row"><span>총 매출</span><span>${fmt(totalSales)}원</span></div>
            <div class="settlement-row"><span>수금액</span><span>${fmt(paidAmount)}원</span></div>
            <div class="settlement-row"><span>미수금</span><span>${fmt(unpaidAmt)}원</span></div>
        </div>`;

    if (!dayOrders.length) {
        el.innerHTML = '<div class="empty"><div class="empty-text">해당 날짜 납품 내역이 없습니다</div></div>';
        return;
    }

    // 거래처별 그룹핑
    const clientMap = {};
    dayOrders.forEach(o => {
        const k = o.clientName||'(없음)';
        if (!clientMap[k]) clientMap[k] = [];
        clientMap[k].push(o);
    });

    el.innerHTML = `
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">총 ${dayOrders.length}건 · ${Object.keys(clientMap).length}개 거래처</div>
        ${Object.entries(clientMap).map(([cname, list]) => {
            const _et = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
            const cTotal  = list.reduce((s,o)=>s+_et(o),0);
            const cPaid   = list.reduce((s,o)=>s+_actualPaid(o),0);
            return `
            <div class="card" style="margin-bottom:10px;padding:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <span style="font-weight:900;font-size:15px;color:var(--accent);">${cname}</span>
                    <span style="font-size:12px;color:var(--text2);">${list.length}건</span>
                </div>
                ${list.map(o => `
                    <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:7px;background:var(--surf3);">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <span style="font-size:13px;font-weight:700;${o.isReturn?'color:var(--red);':''}">${fmt(o.total)}원</span>
                            <span class="pay-badge ${o.isReturn?'unpaid':(o.isPaid?'paid':'unpaid')}" style="cursor:default;font-size:10px;">${o.isReturn?'↩반품/회수':(o.isPaid?'완납':'미수')}</span>
                        </div>
                        <div style="font-size:12px;color:var(--text2);">
                            ${(o.items||[]).map(i=>`${escapeHtml(i.name)} ${Math.abs(i.qty)}개 × ${fmt(i.price||0)}원`).join(' / ')}
                        </div>
                        ${o.note?`<div style="font-size:11px;color:${memoPriorityLevel(o)===1?'var(--blue)':memoPriorityLevel(o)===3?'var(--red)':'var(--orange)'};margin-top:4px;">📝 ${escapeHtml(o.note)}</div>`:''}
                    </div>`).join('')}
                <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding-top:6px;border-top:1px solid var(--border);">
                    <span>소계</span>
                    <span style="color:${cPaid<cTotal?'var(--red)':'var(--green)'};">${fmt(cTotal)}원 ${cPaid<cTotal?'(미수 '+fmt(cTotal-cPaid)+'원)':'✅'}</span>
                </div>
            </div>`;
        }).join('')}`;
}

// ── 분기별 정산 ──

function renderSettlementQuarterly() {
    const year = parseInt(document.getElementById('settlementYear').value);
    if (!year) return;

    const quarters = [
        { label:'1분기', months:['01','02','03'], emoji:'🌱' },
        { label:'2분기', months:['04','05','06'], emoji:'☀️' },
        { label:'3분기', months:['07','08','09'], emoji:'🍂' },
        { label:'4분기', months:['10','11','12'], emoji:'❄️' },
    ];

    let allYearOrders = applyPayFilter(orders.filter(o=>!o.delegatedBy && o.date?.startsWith(String(year))));
    const _et = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
    const yearTotal  = allYearOrders.reduce((s,o)=>s+_et(o),0);
    const yearPaid   = allYearOrders.reduce((s,o)=>s+_actualPaid(o),0);
    renderSummaryBox(yearTotal, yearPaid, yearTotal-yearPaid);

    const qData = quarters.map(q => {
        const mos = q.months.map(m=>`${year}-${m}`);
        const list = applyPayFilter(orders.filter(o=> !o.delegatedBy && mos.some(m=>o.date?.startsWith(m))));
        const sales  = list.reduce((s,o)=>s+_et(o),0);
        const paid   = list.reduce((s,o)=>s+_actualPaid(o),0);
        // 월별 세부
        const monthRows = q.months.map(m => {
            const ml = applyPayFilter(orders.filter(o=>!o.delegatedBy && o.date?.startsWith(`${year}-${m}`)));
            const ms = ml.reduce((s,o)=>s+_et(o),0);
            const mp = ml.reduce((s,o)=>s+_actualPaid(o),0);
            return { month:`${year}-${m}`, sales:ms, paid:mp, count:ml.length };
        });
        return { ...q, sales, paid, unpaid:sales-paid, count:list.length, monthRows };
    });

    const maxQ = Math.max(...qData.map(q=>q.sales), 1);
    const el = document.getElementById('settlementQuarterlyTable');

    el.innerHTML = `
        <div class="quarter-grid">
            ${qData.map(q => {
                const pct = Math.round(q.sales/maxQ*100);
                const yearPct = yearTotal>0 ? Math.round(q.sales/yearTotal*100) : 0;
                return `
                <div class="quarter-card">
                    <div class="q-label">${q.emoji} ${q.label}</div>
                    <div class="q-sales">${fmt(q.sales)}원</div>
                    <div class="q-sub">${q.count}건 · 연간 ${yearPct}%</div>
                    ${q.unpaid>0?`<div class="q-unpaid">미수 ${fmt(q.unpaid)}원</div>`:'<div style="color:var(--green);font-size:11px;font-weight:700;margin-top:4px;">✅ 완납</div>'}
                    <div class="quarter-bar"><div class="quarter-bar-fill" style="width:${pct}%;"></div></div>
                </div>`;
            }).join('')}
        </div>

        <div class="card" style="margin-top:4px;">
            <div class="card-title">분기별 월 세부 내역</div>
            ${qData.map(q=>`
                <div style="margin-bottom:14px;">
                    <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px;">${q.emoji} ${q.label}</div>
                    <div class="table-wrap">
                    <table class="daily-table" style="min-width:unset;">
                        <thead><tr>
                            <th>월</th><th>건수</th><th>매출</th><th>수금</th><th>미수</th>
                        </tr></thead>
                        <tbody>
                            ${q.monthRows.map(r=>`
                                <tr class="${r.sales===0?'day-zero':''}">
                                    <td>${r.month.slice(5)}월</td>
                                    <td>${r.count||'-'}</td>
                                    <td>${r.sales?fmt(r.sales)+'원':'-'}</td>
                                    <td>${r.sales?fmt(r.paid)+'원':'-'}</td>
                                    <td style="color:var(--red);">${r.sales?(r.sales-r.paid?fmt(r.sales-r.paid)+'원':'✅'):'-'}</td>
                                </tr>`).join('')}
                            <tr style="font-weight:700;background:var(--surf3);">
                                <td>소계</td>
                                <td>${q.count}</td>
                                <td>${fmt(q.sales)}원</td>
                                <td>${fmt(q.paid)}원</td>
                                <td style="color:var(--red);">${q.unpaid?fmt(q.unpaid)+'원':'✅'}</td>
                            </tr>
                        </tbody>
                    </table>
                    </div>
                </div>`).join('')}
        </div>`;
}

function toggleSettleList() {
    settleListVisible = !settleListVisible;
    const el = document.getElementById('settlementTable');
    el.style.display = settleListVisible ? 'block' : 'none';
    document.getElementById('settleToggleBtn').textContent = settleListVisible ? '숨기기' : '보이기';
    if (settleListVisible) renderSettleTable();
}

function renderSettleTable() {
    const q   = document.getElementById('settleSearch').value;
    const map = window._settleMap||{};
    const month = window._settleMonth||'';
    let entries = Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0],'ko'));
    if (q) entries = entries.filter(([name])=>matchSearch(name,q));
    const el = document.getElementById('settlementTable');
    if (!entries.length) { el.innerHTML='<div class="empty"><div class="empty-text">해당 기간 내역이 없습니다</div></div>'; return; }
    el.innerHTML = `
        <p style="font-size:11px;color:var(--text2);margin-bottom:6px;">💡 거래처 클릭 시 상세 명세서 · ${entries.length}개 거래처</p>
        <div class="settle-table-wrap">
        <table class="settle-table">
            <colgroup>
                <col style="width:110px;min-width:100px;max-width:130px;">
                <col style="width:52px;">
                <col style="width:100px;">
                <col style="width:100px;">
                <col style="width:100px;">
            </colgroup>
            <thead><tr>
                <th>거래처</th>
                <th class="text-center">건수</th>
                <th class="text-right">매출</th>
                <th class="text-right">수금</th>
                <th class="text-right">미수</th>
            </tr></thead>
            <tbody>
                ${entries.map(([name,d])=>`
                    <tr onclick="showClientStatement('${escapeAttr(name)}','${escapeAttr(month)}')">
                        <td style="color:var(--accent);font-weight:700;">${highlight(name, q)}</td>
                        <td class="text-center">${d.count}</td>
                        <td class="text-right">${fmt(d.total)}원</td>
                        <td class="text-right">${fmt(d.paid)}원</td>
                        <td class="text-right" style="color:var(--red);font-weight:${d.total-d.paid>0?'700':'400'};">${fmt(d.total-d.paid)}원</td>
                    </tr>`).join('')}
            </tbody>
        </table>
        </div>`;
}

function onSettleSearch(q) {
    // 검색어 있을 때 테이블 자동 노출
    if (q && !settleListVisible) {
        settleListVisible = true;
        const el = document.getElementById('settlementTable');
        el.style.display = 'block';
        document.getElementById('settleToggleBtn').textContent = '숨기기';
    }
    // _settleMap이 비어있으면 renderSettlement 먼저 실행
    if (!window._settleMap || !Object.keys(window._settleMap).length) {
        renderSettlement();
    }
    renderSettleTable();
}

// ─── 거래명세표 공유 (카카오톡 / 시스템 공유 시트) ───

let _statShareText = ''; // 현재 열린 명세표 공유 텍스트 (버튼에서 참조)

async function shareStatement() {
    const text = _statShareText;
    if (!text) return;
    // 1순위: Web Share API → 안드로이드에서 카카오톡·문자·기타 앱 선택 가능
    if (navigator.share) {
        try {
            await navigator.share({ title: '거래명세표', text });
            return;
        } catch(e) {
            if (e.name === 'AbortError') return; // 사용자가 취소
            // 다른 오류면 클립보드 폴백으로 진행
        }
    }
    // 2순위: 클립보드 복사 후 안내
    try {
        await navigator.clipboard.writeText(text);
        toast('📋 내용이 복사됐습니다. 카카오톡에서 붙여넣기 하세요.', 'var(--accent)', 3000);
    } catch(e) {
        // 3순위: 구형 브라우저 폴백
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('📋 내용이 복사됐습니다. 카카오톡에서 붙여넣기 하세요.', 'var(--accent)', 3000);
    }
}

// ── 공유 텍스트 빌더 (showClientStatement에서 분리) ──
function _buildStatShareText(clientName, month, { filt, carryAmt, monthTotal, monthPaid, grandUnpaid }) {
    const _monthLabel = (() => { const p = month.split('-'); return p.length >= 2 ? `${parseInt(p[1])}월` : month; })();
    const orderLines = filt.map(o => {
        const itemStr = (o.items||[]).length ? (o.items||[]).map(i=>`${i.name} ${Math.abs(i.qty)}개`).join(', ') : '(품목 정보 없음)';
        const stateStr = o.isReturn ? '↩반품/회수' : o.isPaid ? '✅완납' : (o.paidAmount ? `💳부분(${fmt(o.paidAmount)}원)` : '🔴미수');
        return `  ${o.date}  ${itemStr}  ${fmt(o.total)}원 ${stateStr}`;
    }).join('\n');
    return [
        `📋 [${clientName}님 ${_monthLabel} 거래명세표]`,
        `📅 기간: ${month}`,
        carryAmt > 0 ? `⏩ 전월 이월: ${fmt(carryAmt)}원` : '',
        `💰 당월 매출: ${fmt(monthTotal)}원`,
        `💳 수금액: ${fmt(monthPaid)}원`,
        `🔴 청구 금액: ${fmt(grandUnpaid)}원`,
        `\n🏦 입금계좌: 농협 916-02-055664 (이애경)`,
        orderLines ? `\n📦 납품 내역\n${orderLines}` : '',
    ].filter(Boolean).join('\n');
}

// ─── 거래명세표 월 이동 (◀ ▶ 버튼 및 월 선택 picker) ───
function _shiftStatementMonth(delta) {
    const el = document.getElementById('statementContent')?.querySelector('[data-client-name]');
    if (!el) return;
    const clientName = el.dataset.clientName;
    const [y, m] = el.dataset.month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    showClientStatement(clientName, newMonth);
}
function _pickStatementMonth(value) {
    if (!value) return; // 취소 시 값 없음
    const el = document.getElementById('statementContent')?.querySelector('[data-client-name]');
    if (!el) return;
    showClientStatement(el.dataset.clientName, value);
}
// 라벨 탭 시 네이티브 월 선택 picker를 확실히 띄움 (showPicker 미지원 브라우저는 click()으로 폴백)
function _openStatementMonthPicker() {
    const inp = document.getElementById('statementMonthPicker');
    if (!inp) return;
    if (typeof inp.showPicker === 'function') { try { inp.showPicker(); return; } catch(e) {} }
    inp.click();
}

// 수금 이력 접기/펼치기 토글 (기본 접힘)
function _toggleStatPayHistory() {
    const body = document.getElementById('statPayHistoryBody');
    const icon = document.getElementById('statPayHistoryIcon');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (icon) icon.textContent = open ? '▶' : '▼';
}

async function showClientStatement(clientName, month) {
    const monthStart = month+'-01';

    // ── 공유 워크스페이스에서 동일 거래처명 내역 fetch ──
    const sharedWsIds = _getSharedWs();
    let sharedOrders = [];
    if (sharedWsIds.length && typeof firebase !== 'undefined' && firebase.apps.length) {
        const napumDb = firebase.database();
        await Promise.all(sharedWsIds.map(async item => {
            const wsId = item.wsId || item;
            try {
                // 1) 상대방이 허용한 거래처 목록 확인
                const scSnap = await napumDb.ref(`workspaces/${wsId}/sharedClients`).get();
                if (!scSnap.exists()) return;
                const rawSc = scSnap.val() || [];
                const allowedClients = rawSc.map(item => typeof item === 'string' ? item : item.name);
                // 허용 목록이 비어있으면 공유 안 함
                if (!allowedClients.length) return;
                // 현재 거래처가 허용 목록에 없으면 스킵
                if (!allowedClients.includes(clientName)) return;
                // 2) 허용된 경우에만 내역 fetch
                const myWsId = (localStorage.getItem('workspaceId') || '').toLowerCase();
                const snap = await napumDb.ref(`workspaces/${wsId}/orders`)
                    .orderByChild('clientName').equalTo(clientName).get();
                if (!snap.exists()) return;
                Object.values(snap.val() || {}).forEach(o => {
                    // ★ delegatedBy가 없으면(=원 거래처 담당자 본인이 직접 납품) 또는
                    //   delegatedBy가 내 wsId가 아니면(=다른 사용자가 대납) 제외
                    //   → 내가 직접 대납한 거래만 명세표에 포함
                    if (!o.delegatedBy || o.delegatedBy !== myWsId) return;
                    sharedOrders.push({ ...o, _sharedWsId: wsId });
                });
            } catch(e) { /* 접근 불가 워크스페이스 무시 */ }
        }));
    }
    const hasShared = sharedOrders.length > 0;
    // 내 전표 + 공유 전표 합산
    const allOrders = [
        ...orders.map(o => ({ ...o, _sharedWsId: null })),
        ...sharedOrders,
    ];

    const filt = allOrders.filter(o=>o.clientName===clientName&&o.date?.startsWith(month)).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    // 할인 완납된 전표는 실청구액(total - discount)으로 집계
    const _effectiveTotal = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
    const monthTotal  = filt.reduce((s,o)=>s+_effectiveTotal(o),0);
    // 수금액 = 완납전표 합산 + 부분입금 누적액
    const monthPaid   = filt.reduce((s,o)=>s+_actualPaid(o),0);
    const monthUnpaid = monthTotal - monthPaid;
    const carryOrders = allOrders.filter(o=>o.clientName===clientName&&o.date<monthStart&&!o.isPaid).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    const carryAmt    = carryOrders.reduce((s,o)=>s+o.total-(o.paidAmount||0),0);
    const grandUnpaid = carryAmt + monthUnpaid;
    // ── 오늘 이전까지(어제까지) 해당 거래처 합계 ──
    const todayStr = todayKST();
    const beforeTodayOrders = allOrders.filter(o=>o.clientName===clientName && o.date < todayStr && o.date?.startsWith(month));
    const beforeTodayTotal  = beforeTodayOrders.reduce((s,o)=>s+_effectiveTotal(o),0);
    const client = clients.find(c=>c.name===clientName);
    const phone  = client?.phone||'';
    const _monthLabel = (() => { const p = month.split('-'); return p.length >= 2 ? `${parseInt(p[1])}월` : month; })();
    const smsText = `[${clientName}님 ${_monthLabel} 거래명세표]\n기간: ${month}\n전월이월: ${fmt(carryAmt)}원\n당월매출: ${fmt(monthTotal)}원\n수금액: ${fmt(monthPaid)}원\n청구금액: ${fmt(grandUnpaid)}원\n\n입금계좌: 농협 916-02-055664 (이애경)`;
    // 공유 텍스트 빌더로 분리
    _statShareText = _buildStatShareText(clientName, month, { filt, carryAmt, monthTotal, monthPaid, grandUnpaid });
    // ★ v120: 이월 행 누계 — carryOrders 기준 누적합을 carry_N 키로 _accumMap에 등록
    // (아직 window._accumMap 초기화 전이므로 여기서 임시 변수로 계산, 이후 merge)
    let _carryRunAcc = 0;
    const _carryAccumTemp = {};
    carryOrders.forEach((o, ci) => {
        _carryRunAcc += (o.total - (o.paidAmount || 0));
        _carryAccumTemp['carry_' + ci] = { date: o.date, total: _carryRunAcc };
    });
    const carryRows = carryOrders.map((o, ci)=>{
        const carryPartial = !o.isPaid && (o.paidAmount||0)>0;
        const carryRemain  = carryPartial ? o.total-(o.paidAmount||0) : 0;
        const carryPartialRow = carryPartial ? `
        <tr style="background:rgba(245,158,11,0.08);">
            <td colspan="4" style="padding:5px 8px 7px 22px;border-top:none;">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:10px;font-weight:700;color:#60a5fa;letter-spacing:.5px;">💳 부분 수금</span>
                    <span style="font-size:12px;font-weight:800;color:#60a5fa;">${fmt(o.paidAmount)}원</span>
                    ${o.paidAt ? `<span style="font-size:10px;color:var(--text3);">${o.paidAt.slice(0,10)}</span>` : ''}
                    ${_methodBadgeHtml(o.paidMethod)}
                    ${o.paidNote ? `<span style="font-size:10px;color:var(--text2);background:var(--surf3);padding:1px 6px;border-radius:4px;">📝 ${o.paidNote}</span>` : ''}
                    <span style="margin-left:auto;font-size:10px;color:var(--red);font-weight:700;">잔여 ${fmt(carryRemain)}원</span>
                    <button onclick="openPayEdit('${o.id||''}','${escapeAttr(clientName)}','${escapeAttr(month)}')" style="padding:3px 8px;border-radius:6px;border:1px solid #60a5fa44;background:#60a5fa18;color:#60a5fa;font-size:10px;font-weight:700;cursor:pointer;">✏️ 수정</button>
                </div>
            </td>
        </tr>` : '';
        return `
        <tr style="background:var(--surf3);cursor:pointer;" onclick="openQuickPayFromStatement('${o.id||''}','${escapeAttr(clientName)}','${escapeAttr(month)}')" title="탭하여 결제 처리">
            <td style="color:var(--orange);font-size:12px;" onclick="event.stopPropagation();_toggleAccum('carry_${ci}',this.closest('tr'))" title="탭하여 이월 누계 보기">${o.date} <span style="font-size:9px;color:var(--text3);">📊</span> <span style="font-size:9px;color:var(--text3);" onclick="event.stopPropagation();showOrderDetail('${o.id||''}')">🔍</span></td>
            <td style="font-size:11px;">${_fmtItems(o)}</td>
            <td class="text-right" style="color:var(--orange);" onclick="event.stopPropagation();_toggleAccum('carry_${ci}',this.closest('tr'))" title="탭하여 이월 누계 보기">${fmt(o.total)}원${carryPartial?`<br><small style="color:#60a5fa;">수금 ${fmt(o.paidAmount)}원</small>`:''}</td>
            <td class="text-center"><span class="pay-badge unpaid" style="cursor:default;font-size:9px;">이월</span></td>
        </tr>${carryPartialRow}`;
    }).join('');
    // ★ v116: 날짜/금액 셀 클릭 시 해당 날짜까지 누계 토글 (전역 Map 사용)
    // ★ v120: 이월 행 누계(_carryAccumTemp)도 함께 등록
    window._accumMap = { ..._carryAccumTemp };
    let _runAcc = 0;
    filt.forEach((o, idx) => {
        _runAcc += _effectiveTotal(o);
        window._accumMap[idx] = { date: o.date, total: _runAcc };
    });
    const monthRows = filt.map((o, idx)=>{
        const partial = !o.isPaid && (o.paidAmount||0)>0;
        const remain  = partial ? o.total-(o.paidAmount||0) : 0;
        const sharedBadge = o._sharedWsId
            ? `<br><span style="font-size:9px;background:#e0e7ff;color:#4f46e5;border-radius:4px;padding:1px 5px;font-weight:700;">📦${escapeHtml(o._sharedWsId)}</span>` : '';
        // 공유 내역도 편집 가능 — 배지만 표시
        const voidBadge = o.isVoid ? `<br><span style="font-size:9px;background:rgba(245,166,35,.15);color:var(--orange);border-radius:4px;padding:1px 4px;font-weight:700;">👤타인</span>` : '';
        const returnBadge = o.isReturn ? `<br><span style="font-size:9px;background:var(--red-dim);color:var(--red);border-radius:4px;padding:1px 4px;font-weight:700;">↩반품/회수</span>` : '';
        const statBadge = o.isReturn
            ? `<span class="pay-badge" style="cursor:default;font-size:9px;background:var(--red-dim);color:var(--red);">↩조정</span>`
            : o.isPaid
            ? (o.discount>0
                ? `<span class="pay-badge paid" style="cursor:default;font-size:9px;">✂️할인완납</span>${voidBadge}`
                : `<span class="pay-badge paid" style="cursor:default;font-size:9px;">완납</span>${voidBadge}`)
            : partial
            ? `<span class="pay-badge" style="cursor:default;font-size:9px;background:#3b82f625;color:#60a5fa;font-weight:800;">부분<br><small>${fmt(o.paidAmount)}원</small></span>${voidBadge}`
            : `<span class="pay-badge unpaid" style="cursor:default;font-size:9px;">미수</span>${voidBadge}`;
        // 부분 결제 세부 행
        const partialDetailRow = partial ? `
        <tr style="background:rgba(59,130,246,0.06);">
            <td colspan="4" style="padding:5px 8px 7px 22px;border-top:none;">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:10px;font-weight:700;color:#60a5fa;letter-spacing:.5px;">💳 부분 수금</span>
                    <span style="font-size:12px;font-weight:800;color:#60a5fa;">${fmt(o.paidAmount)}원</span>
                    ${o.paidAt ? `<span style="font-size:10px;color:var(--text3);">${o.paidAt.slice(0,10)}</span>` : ''}
                    ${_methodBadgeHtml(o.paidMethod)}
                    ${o.paidNote ? `<span style="font-size:10px;color:var(--text2);background:var(--surf3);padding:1px 6px;border-radius:4px;">📝 ${o.paidNote}</span>` : ''}
                    <span style="margin-left:auto;font-size:10px;color:var(--red);font-weight:700;">잔여 ${fmt(remain)}원</span>
                    <button onclick="openPayEdit('${o.id||''}','${escapeAttr(clientName)}','${escapeAttr(month)}')" style="padding:3px 8px;border-radius:6px;border:1px solid #60a5fa44;background:#60a5fa18;color:#60a5fa;font-size:10px;font-weight:700;cursor:pointer;">✏️ 수정</button>
                </div>
            </td>
        </tr>` : '';
        // 공유 내역도 클릭 가능 (수정/결제 가능) / 반품·회수는 결제 대상이 아니므로 상세보기로
        const rowClick = o.isReturn
            ? `showOrderDetail('${o.id||''}')`
            : o.isPaid
                ? `showOrderDetail('${o.id||''}')`
                : `openQuickPayFromStatement('${o.id||''}','${escapeAttr(clientName)}','${escapeAttr(month)}')`;
        const rowTitle  = o._sharedWsId ? `📦 공유 내역 (${o._sharedWsId}) — 탭하여 처리` : o.isReturn ? '탭하여 상세 보기' : o.isPaid ? '탭하여 상세 보기' : '탭하여 결제 처리';
        const rowAccent = o._sharedWsId ? 'background:rgba(99,102,241,0.05);' : o.isReturn ? 'background:rgba(229,68,68,0.04);' : !o.isPaid ? 'background:rgba(239,68,68,0.04);' : '';
        const rowOnclick = rowClick ? `onclick="${rowClick}"` : '';
        const rowCursor  = rowClick ? 'cursor:pointer;' : 'cursor:default;';
        // ★ v116: 날짜·금액 셀 클릭 → 전역 _toggleAccum(idx, tr) 호출
        return `<tr style="${rowCursor}${rowAccent}" ${rowOnclick} title="${rowTitle}">
            <td onclick="event.stopPropagation();_toggleAccum(${idx},this.closest('tr'))" title="탭하여 누계 보기" style="cursor:pointer;">${o.date} <span style="font-size:9px;color:var(--text3);">📊</span> <span style="font-size:9px;color:var(--text3);" onclick="event.stopPropagation();showOrderDetail('${o.id||''}')" title="상세보기">🔍</span></td>
            <td style="font-size:11px;">${_fmtItems(o)}${sharedBadge}${returnBadge}</td>
            <td class="text-right" onclick="event.stopPropagation();_toggleAccum(${idx},this.closest('tr'))" title="탭하여 누계 보기" style="cursor:pointer;">${fmt(o.total)}원</td>
            <td class="text-center">${statBadge}</td>
        </tr>${partialDetailRow}`;
    }).join('');
    document.getElementById('statementContent').innerHTML = `
        <div data-client-name="${escapeAttr(clientName)}" data-month="${escapeAttr(month)}" style="margin-bottom:14px;">
            <div style="font-size:19px;font-weight:900;margin-bottom:8px;">${escapeHtml(clientName)}</div>
            <div style="display:flex;align-items:center;justify-content:center;gap:4px;position:relative;">
                <button onclick="_shiftStatementMonth(-1)" aria-label="이전 달" style="width:34px;height:34px;flex-shrink:0;border-radius:9px;border:1px solid var(--border);background:var(--surf2);color:var(--text2);font-size:18px;font-weight:700;cursor:pointer;">‹</button>
                <label for="statementMonthPicker" onclick="_openStatementMonthPicker()" style="flex:1;text-align:center;font-size:17px;font-weight:900;white-space:nowrap;cursor:pointer;padding:6px 2px;border-radius:9px;" title="탭하여 월 선택">
                    ${month} 거래명세표 <span style="font-size:12px;">📅</span>
                </label>
                <button onclick="_shiftStatementMonth(1)" aria-label="다음 달" style="width:34px;height:34px;flex-shrink:0;border-radius:9px;border:1px solid var(--border);background:var(--surf2);color:var(--text2);font-size:18px;font-weight:700;cursor:pointer;">›</button>
                <input type="month" id="statementMonthPicker" value="${month}" onchange="_pickStatementMonth(this.value)" style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none;">
            </div>
        </div>
        ${hasShared ? `<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#4f46e5;display:flex;align-items:center;gap:6px;">
            🔗 <strong>공유 합산 내역</strong>&nbsp;— 공유 워크스페이스 ${sharedWsIds.length}개 포함
            <span style="margin-left:auto;font-size:10px;color:#6366f1;">📦 배지 = 공유 내역 (수정·결제 가능)</span>
        </div>` : ''}
        <div style="background:var(--surf2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;">
            ${carryAmt>0?`<div style="display:flex;justify-content:space-between;margin-bottom:7px;"><span style="color:var(--orange);">⏩ 전월 이월</span><strong style="color:var(--orange);">${fmt(carryAmt)}원</strong></div>`:''}
            <div style="display:flex;justify-content:space-between;margin-bottom:7px;"><span style="color:var(--text2);">이번 달 합계 (어제까지)</span><strong style="color:var(--text);">${fmt(beforeTodayTotal)}원</strong></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:7px;"><span style="color:var(--text2);">당월 매출</span><strong style="color:var(--accent);">${fmt(monthTotal)}원</strong></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:7px;"><span style="color:var(--text2);">수금액</span><strong style="color:var(--green);">${fmt(monthPaid)}원</strong></div>
            <div style="display:flex;justify-content:space-between;border-top:2px solid var(--red);padding-top:9px;margin-top:3px;">
                <span style="color:var(--red);font-weight:700;">청구 금액</span>
                <strong style="color:var(--red);font-size:18px;">${fmt(grandUnpaid)}원</strong>
            </div>
        </div>
        ${(()=>{
            // 부분 수금 이력이 있는 전표만 추출 (당월 + 이월 모두)
            const allMonthOrders = [...carryOrders, ...filt];
            const partialOrders = allMonthOrders.filter(o => (o.paidAmount||0) > 0);
            if (!partialOrders.length) return '';
            const rows = partialOrders.map(o => {
                const isCarry = o.date < monthStart;
                const oId = o.id || '';
                return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
                    <div style="min-width:72px;font-size:11px;color:${isCarry?'var(--orange)':'var(--text2)'};">${o.date}${isCarry?' <span style="font-size:9px;">(이월)</span>':''}</div>
                    <div style="flex:1;font-size:11px;color:var(--text2);min-width:80px;">${(o.items||[]).map(i=>i.name).join(', ')}</div>
                    <div style="text-align:right;">
                        <div style="font-size:13px;font-weight:800;color:#60a5fa;">💳 ${fmt(o.paidAmount)}원 수금</div>
                        ${o.discount>0?`<div style="font-size:11px;color:var(--orange);font-weight:700;">✂️ 할인 ${fmt(o.discount)}원</div>`:''}
                        ${_methodBadgeHtml(o.paidMethod)}
                        ${o.paidMethod==='mixed'&&o.paidMethodDetail?`<div style="font-size:10px;color:var(--text2);">🏦${fmt(o.paidMethodDetail.transfer||0)}원 + 💵${fmt(o.paidMethodDetail.cash||0)}원</div>`:''}
                        ${o.paidAt?`<div style="font-size:10px;color:var(--text3);">${o.paidAt.slice(0,10)}</div>`:''}
                        ${o.paidNote?`<div style="font-size:10px;color:var(--text2);">📝 ${o.paidNote}</div>`:''}
                        ${!o.isPaid?`<div style="font-size:10px;color:var(--red);">잔여 ${fmt(o.total-(o.paidAmount||0))}원</div>`:`<div style="font-size:10px;color:var(--green);">✅ 완납</div>`}
                    </div>
                    <button onclick="openPayEdit('${oId}','${escapeAttr(clientName)}','${escapeAttr(month)}')" style="flex-shrink:0;padding:5px 10px;border-radius:7px;border:1px solid var(--border);background:var(--surf3);color:var(--text2);font-size:11px;font-weight:700;cursor:pointer;">✏️ 수정</button>
                </div>`;
            }).join('');
            const totalPartialPaid = partialOrders.reduce((s,o)=>s+(o.paidAmount||0),0);
            // ★ 기본 접힘 — 헤더를 탭하면 펼침/접힘 토글
            return `<div style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.25);border-radius:10px;padding:13px 14px;margin-bottom:14px;">
                <div onclick="_toggleStatPayHistory()" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-size:11px;font-weight:700;color:#60a5fa;letter-spacing:.8px;text-transform:uppercase;">
                    <span>💳 수금 이력 (${partialOrders.length}건 · 합계 ${fmt(totalPartialPaid)}원)</span>
                    <span id="statPayHistoryIcon" style="font-size:13px;">▶</span>
                </div>
                <div id="statPayHistoryBody" style="display:none;margin-top:10px;">${rows}</div>
            </div>`;
        })()}
        <div style="overflow-x:auto;">
        <table class="settle-table" style="min-width:300px;">
            <thead><tr><th>날짜</th><th>품목</th><th class="text-right">금액</th><th class="text-center">상태</th></tr></thead>
            <tbody>
                ${carryRows}
                ${monthRows||'<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:14px;">당월 내역 없음</td></tr>'}
            </tbody>
        </table>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
            ${phone?`<a href="sms:${phone}?body=${encodeURIComponent(smsText)}" class="btn btn-success" style="flex:1;min-width:80px;text-decoration:none;text-align:center;">💬 문자</a>`:''}
            <button class="btn btn-primary" style="flex:1;min-width:80px;" onclick="saveStatementPNG('${escapeAttr(clientName)}','${escapeAttr(month)}')">🖼️ PNG 저장</button>
        </div>
        <button onclick="shareStatement()" style="width:100%;margin-top:8px;padding:13px;border-radius:var(--radius-s);border:none;background:#FEE500;color:#191919;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;letter-spacing:-.3px;">
            <svg width="20" height="20" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="20" cy="18" rx="18" ry="14" fill="#191919"/><path fill="#FEE500" d="M11 18a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0zm8.5 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0zm3.5 0a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0z"/><path fill="#191919" d="M15 25l-2 6 5-3"/></svg>
            카카오톡으로 보내기
        </button>
        ${grandUnpaid > 0 ? `
        <button class="btn-partial-pay" onclick="openPartialPay('${escapeAttr(clientName)}','${escapeAttr(month)}')">
            💳 입금 처리 (부분 · 전체)
        </button>
        <button class="btn-bulk-pay" onclick="bulkPayClient('${escapeAttr(clientName)}','${escapeAttr(month)}')">
            💚 미수금 전체 완납 (${fmt(grandUnpaid)}원)
        </button>` : `<div style="text-align:center;color:var(--green);font-weight:700;margin-top:10px;font-size:13px;">✅ 완납 완료</div>`}`;
    openModal('statementModal');
}

// ─── 거래처 명세표 JPG 저장 ───

function saveStatementPNG(clientName, month) {
    const monthStart = month + '-01';
    const filt = orders.filter(o => !o.delegatedBy && o.clientName === clientName && o.date?.startsWith(month))
                       .sort((a, b) => (a.date||"").localeCompare(b.date||""));
    const _effectiveTotal = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
    const monthTotal  = filt.reduce((s, o) => s + _effectiveTotal(o), 0);
    const monthPaid   = filt.reduce((s,o)=>s+_actualPaid(o),0);
    const monthUnpaid = monthTotal - monthPaid;
    const carryOrders = orders.filter(o => !o.delegatedBy && o.clientName === clientName && o.date < monthStart && !o.isPaid)
                              .sort((a, b) => (a.date||"").localeCompare(b.date||""));
    const carryAmt    = carryOrders.reduce((s, o) => s + o.total - (o.paidAmount || 0), 0);
    const grandUnpaid = carryAmt + monthUnpaid;

    const carryRows = carryOrders.map(o => `
        <tr class="carry-row">
            <td>${o.date}</td>
            <td>${(o.items || []).map(i => `${escapeHtml(i.name)}(${Math.abs(i.qty)})`).join(', ')}</td>
            <td class="num">${fmt(o.total)}원</td>
            <td class="center">${o.isReturn ? '<span class="badge unpaid">↩반품/회수</span>' : '<span class="badge carry">이월</span>'}</td>
        </tr>`).join('');

    const monthRows = filt.map(o => {
        const partial = !o.isPaid && (o.paidAmount || 0) > 0;
        const remain  = partial ? o.total - (o.paidAmount || 0) : 0;
        const badge   = o.isReturn
            ? '<span class="badge unpaid">↩반품/회수</span>'
            : o.isPaid
            ? '<span class="badge paid">완납</span>'
            : partial
            ? `<span class="badge part">부분<br><small>${fmt(o.paidAmount)}원</small></span>`
            : '<span class="badge unpaid">미수</span>';
        return `<tr>
            <td>${o.date}</td>
            <td>${(o.items || []).map(i => `${escapeHtml(i.name)}(${Math.abs(i.qty)})`).join(', ')}</td>
            <td class="num">${fmt(o.total)}원${partial ? `<br><small class="remain">잔여 ${fmt(remain)}원</small>` : ''}</td>
            <td class="center">${badge}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>png_render</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕', sans-serif;
    font-size: 14px; color: #111; background: #fff;
    width: 480px; padding: 20px 18px 28px;
  }
  .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:12px; margin-bottom:14px; border-bottom:2.5px solid #111; }
  .doc-title { font-size:20px; font-weight:900; letter-spacing:-0.5px; }
  .client-name { font-size:13px; font-weight:700; color:#444; margin-top:4px; }
  .doc-meta { font-size:11px; color:#666; text-align:right; line-height:1.8; }
  .sum-grid { display:grid; grid-template-columns:${carryAmt > 0 ? 'repeat(4,1fr)' : 'repeat(3,1fr)'}; gap:6px; margin-bottom:10px; }
  .sum-card { border-radius:10px; padding:9px 6px; text-align:center; border:1.5px solid #e5e7eb; background:#fafafa; }
  .sum-label { font-size:10px; color:#888; font-weight:600; margin-bottom:4px; }
  .sum-val { font-size:14px; font-weight:900; line-height:1.2; word-break:break-all; }
  .sum-card.carry { background:#fffbeb; border-color:#fcd34d; }
  .sum-card.carry .sum-val { color:#d97706; }
  .sum-card.sales { background:#eff6ff; border-color:#93c5fd; }
  .sum-card.sales .sum-val { color:#2563eb; }
  .sum-card.paid-c { background:#f0fdf4; border-color:#86efac; }
  .sum-card.paid-c .sum-val { color:#16a34a; }
  .sum-card.charge { background:#fff1f2; border-color:#fca5a5; }
  .sum-card.charge .sum-val { color:#dc2626; }
  .charge-bar { background:#fff1f2; border:2px solid #dc2626; border-radius:10px; padding:11px 14px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; }
  .charge-bar .c-label { font-size:13px; font-weight:700; color:#dc2626; }
  .charge-bar .c-val { font-size:22px; font-weight:900; color:#dc2626; }
  .tbl-wrap { border-radius:10px; border:1.5px solid #e5e7eb; overflow:hidden; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  thead th { background:#f9fafb; padding:9px 8px; border-bottom:1.5px solid #d1d5db; font-size:11px; font-weight:700; color:#555; text-align:left; }
  td { padding:9px 8px; border-bottom:1px solid #f0f0f0; vertical-align:middle; line-height:1.4; }
  tbody tr:last-child td { border-bottom:none; }
  .carry-row td { background:#fffbeb; }
  .carry-row td:first-child { color:#d97706; font-weight:600; }
  .num { text-align:right; white-space:nowrap; }
  .center { text-align:center; }
  .remain { display:block; color:#dc2626; font-size:10px; margin-top:2px; }
  .badge { display:inline-block; font-size:10px; font-weight:700; padding:3px 8px; border-radius:99px; line-height:1.3; white-space:nowrap; }
  .badge.paid { background:#dcfce7; color:#16a34a; }
  .badge.unpaid { background:#fee2e2; color:#dc2626; }
  .badge.carry { background:#fef3c7; color:#d97706; }
  .badge.part { background:#dbeafe; color:#2563eb; }
  .footer { margin-top:16px; padding-top:10px; border-top:1px solid #e5e7eb; font-size:11px; color:#aaa; text-align:center; line-height:1.8; }
/* ── 미수금 전용 탭 ── */
.unpaid-summary-bar {
    display: flex; gap: 8px; margin-bottom: 12px;
}
.unpaid-sum-card {
    flex: 1; background: var(--surf2); border: 1px solid var(--border);
    border-radius: var(--radius-s); padding: 10px 12px; text-align: center;
}
.unpaid-sum-card.danger { border-color: #ef444466; background: #ef444410; }
.unpaid-sum-label { font-size: 10px; color: var(--text2); font-weight: 700; margin-bottom: 4px; }
.unpaid-sum-val   { font-size: 17px; font-weight: 900; color: var(--text); }
.unpaid-sum-card.danger .unpaid-sum-val { color: var(--red); }

.unpaid-age-tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.unpaid-age-tab  {
    padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 700;
    border: 1.5px solid var(--border); background: var(--surf2); color: var(--text2);
    cursor: pointer;
}
.unpaid-age-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.unpaid-client-card {
    background: var(--surf2); border: 1px solid var(--border);
    border-radius: var(--radius-s); padding: 12px 14px;
    margin-bottom: 8px; border-left: 4px solid var(--border);
    position: relative;
}
.unpaid-client-card.age-ok     { border-left-color: var(--accent); }
.unpaid-client-card.age-warn   { border-left-color: var(--orange); }
.unpaid-client-card.age-danger { border-left-color: #ef4444; background: #ef444408; }
.unpaid-client-card.age-severe { border-left-color: #7f1d1d; background: #ef444414; }

.unpaid-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.unpaid-card-name { font-size: 16px; font-weight: 900; color: var(--text); }
.unpaid-card-amt  { font-size: 18px; font-weight: 900; color: var(--red); }
.unpaid-card-meta { font-size: 11px; color: var(--text2); margin-bottom: 8px; }
.unpaid-age-badge {
    display: inline-block; font-size: 10px; font-weight: 700;
    padding: 2px 7px; border-radius: 8px; margin-left: 6px;
    background: var(--surf3); color: var(--text2);
}
.age-warn   .unpaid-age-badge { background: #f59e0b22; color: var(--orange); }
.age-danger .unpaid-age-badge { background: #ef444422; color: #ef4444; }
.age-severe .unpaid-age-badge { background: #7f1d1d33; color: #fca5a5; }
.unpaid-card-orders { font-size: 11px; color: var(--text2); margin-bottom: 10px; }
.unpaid-card-order-row {
    display: flex; justify-content: space-between; padding: 3px 0;
    border-bottom: 1px solid var(--border);
}
.unpaid-card-order-row:last-child { border-bottom: none; }
.unpaid-card-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.unpaid-card-actions a, .unpaid-card-actions button {
    flex: 1; min-width: 60px; padding: 7px 4px;
    border-radius: 7px; border: 1px solid var(--border);
    background: var(--surf3); color: var(--text2);
    font-size: 11px; font-weight: 700; cursor: pointer;
    text-align: center; text-decoration: none;
}
.unpaid-card-actions .btn-pay {
    background: var(--accent); color: #fff; border-color: var(--accent);
}
.unpaid-card-actions .btn-sms {
    background: #22c55e18; color: var(--green); border-color: #22c55e44;
}

/* 거래처 카드 미수금 강조 */
.client-card.has-unpaid { border-left: 4px solid var(--border); }
.client-card.unpaid-ok     { border-left-color: var(--accent); }
.client-card.unpaid-warn   { border-left-color: var(--orange); }
.client-card.unpaid-danger { border-left-color: #ef4444; }
.client-card.unpaid-severe { border-left-color: #7f1d1d; }
.client-unpaid-badge {
    display: inline-block; font-size: 11px; font-weight: 800;
    padding: 2px 8px; border-radius: 8px; margin-top: 4px;
    background: #ef444415; color: var(--red); border: 1px solid #ef444433;
}
.client-unpaid-badge.warn   { background: #f59e0b15; color: var(--orange); border-color: #f59e0b33; }
.client-unpaid-badge.danger { background: #ef444420; color: #ef4444; border-color: #ef444455; }
.client-unpaid-badge.severe { background: #7f1d1d30; color: #fca5a5; border-color: #7f1d1d55; }

/* 대시보드 미수 거래처 목록 */
.dash-unpaid-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 7px 0; border-bottom: 1px solid var(--border); cursor: pointer;
}
.dash-unpaid-row:last-child { border-bottom: none; }
.dash-unpaid-name { font-size: 13px; font-weight: 700; }
.dash-unpaid-info { font-size: 10px; color: var(--text2); }
.dash-unpaid-right { text-align: right; }
.dash-unpaid-amt { font-size: 14px; font-weight: 900; color: var(--red); }
.dash-unpaid-days { font-size: 10px; font-weight: 700; }
.dash-unpaid-days.warn   { color: var(--orange); }
.dash-unpaid-days.danger { color: #ef4444; }
.dash-unpaid-days.severe { color: #fca5a5; }

/* ── 수금 방법 선택 ── */
.pay-method-group { display:flex; gap:8px; margin-bottom:14px; }
.pay-method-btn {
    flex:1; padding:10px 6px; border-radius:10px;
    border:2px solid var(--border); background:var(--surf2);
    color:var(--text2); font-size:13px; font-weight:700;
    cursor:pointer; text-align:center; transition:all .15s;
}
.pay-method-btn.active {
    border-color:var(--accent); background:var(--accent);
    color:#fff;
}
.pay-method-btn.cash.active   { border-color:#22c55e; background:#22c55e; }
.pay-method-btn.transfer.active { border-color:#3b82f6; background:#3b82f6; }
.pay-method-badge {
    display:inline-block; font-size:10px; font-weight:700;
    padding:1px 7px; border-radius:6px; margin-left:5px;
    vertical-align:middle;
}
.pay-method-badge.cash     { background:#22c55e18; color:#22c55e; border:1px solid #22c55e44; }
.pay-method-badge.transfer { background:#3b82f618; color:#60a5fa; border:1px solid #3b82f644; }
.pay-method-badge.other    { background:#f59e0b18; color:var(--orange); border:1px solid #f59e0b44; }

/* ── 수금방법 퀵 팝업 ── */
.quick-pay-popup {
    position:fixed; bottom:0; left:50%; transform:translateX(-50%);
    width:100%; max-width:520px;
    background:var(--surf); border-top:2px solid var(--border);
    border-radius:20px 20px 0 0;
    padding:18px 16px 32px;
    z-index:3500;
    box-shadow:0 -8px 32px rgba(0,0,0,.35);
    transition:transform .25s cubic-bezier(.4,0,.2,1), opacity .2s;
    opacity:0; transform:translateX(-50%) translateY(100%);
}
.quick-pay-popup.open {
    opacity:1; transform:translateX(-50%) translateY(0);
}
.quick-pay-overlay {
    position:fixed; inset:0; background:rgba(0,0,0,.45);
    z-index:3499; display:none;
}
.quick-pay-overlay.open { display:block; }
.quick-pay-title {
    font-size:15px; font-weight:900; color:var(--text);
    margin-bottom:6px; text-align:center;
}
.quick-pay-sub {
    font-size:12px; color:var(--text2); margin-bottom:16px; text-align:center;
}
.quick-pay-btns { display:flex; gap:10px; }
.quick-pay-btn {
    flex:1; padding:18px 8px; border-radius:14px;
    border:2px solid var(--border); background:var(--surf2);
    color:var(--text); font-size:14px; font-weight:900;
    cursor:pointer; text-align:center; transition:all .15s;
    display:flex; flex-direction:column; align-items:center; gap:4px;
}
.quick-pay-btn:active { transform:scale(.96); }
.quick-pay-btn.cash     { border-color:#22c55e44; }
.quick-pay-btn.cash:active, .quick-pay-btn.cash:hover
                        { background:#22c55e18; border-color:#22c55e; }
.quick-pay-btn.transfer { border-color:#3b82f644; }
.quick-pay-btn.transfer:active, .quick-pay-btn.transfer:hover
                        { background:#3b82f618; border-color:#3b82f6; }
.quick-pay-btn .qp-icon { font-size:28px; }
.quick-pay-btn .qp-label { font-size:13px; font-weight:900; }
.quick-pay-btn .qp-amt  { font-size:16px; font-weight:900; color:var(--green); }
.quick-pay-cancel       { display:block; width:100%; margin-top:10px; padding:11px;
                          border-radius:10px; border:none; background:none;
                          color:var(--text2); font-size:13px; cursor:pointer; }
/* 수금 통계 분리 표시 */
.hist-sum-breakdown {
    display:flex; justify-content:center; gap:10px; margin-top:5px; flex-wrap:wrap;
}
.hist-sum-method {
    font-size:10px; font-weight:700; opacity:.9;
    background:rgba(255,255,255,.15); border-radius:6px;
    padding:2px 7px; white-space:nowrap;
}

</style>
</head>
<body>
  <div class="header">
    <div style="display:flex;justify-content:space-between;align-items:baseline;width:100%;">
      <div class="doc-title">${escapeHtml(clientName)}</div>
      <div class="doc-title">${month} 거래명세표</div>
    </div>
  </div>
  <div style="text-align:right;font-size:11px;color:#888;margin-bottom:10px;">${new Date().toLocaleDateString('ko-KR')}</div>
  <div class="sum-grid">
    ${carryAmt > 0 ? `<div class="sum-card carry"><div class="sum-label">전월이월</div><div class="sum-val">${fmt(carryAmt)}<small style="font-size:10px">원</small></div></div>` : ''}
    <div class="sum-card sales"><div class="sum-label">당월매출</div><div class="sum-val">${fmt(monthTotal)}<small style="font-size:10px">원</small></div></div>
    <div class="sum-card paid-c"><div class="sum-label">수금액</div><div class="sum-val">${fmt(monthPaid)}<small style="font-size:10px">원</small></div></div>
    <div class="sum-card charge"><div class="sum-label">청구금액</div><div class="sum-val">${fmt(grandUnpaid)}<small style="font-size:10px">원</small></div></div>
  </div>
  <div class="charge-bar">
    <span class="c-label">💳 청구 금액</span>
    <span class="c-val">${fmt(grandUnpaid)}<small style="font-size:13px">원</small></span>
  </div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th style="width:82px">날짜</th><th>품목</th><th class="num" style="width:90px">금액</th><th class="center" style="width:48px">상태</th></tr></thead>
      <tbody>
        ${carryRows}
        ${monthRows || '<tr><td colspan="4" style="text-align:center;color:#bbb;padding:20px 0;">당월 내역 없음</td></tr>'}
      </tbody>
    </table>
  </div>
  <div class="footer">DeliveryPro · ${escapeHtml(clientName)} · ${month}<br>${new Date().toLocaleString('ko-KR')} 출력</div>
</body>
</html>`;

    toast('🖼️ 이미지 생성 중...');
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:520px;height:auto;border:none;visibility:hidden;';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();

    setTimeout(() => {
        const body = iframe.contentDocument.body;
        body.style.width = '480px';
        const h = body.scrollHeight;
        iframe.style.height = h + 'px';
        html2canvas(body, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: 480,
            height: h,
            scrollX: 0,
            scrollY: 0
        }).then(canvas => {
            document.body.removeChild(iframe);
            const link = document.createElement('a');
            link.download = `${clientName}_${month}_거래명세표.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            toast('✅ PNG 이미지가 저장되었습니다!');
        }).catch(err => {
            document.body.removeChild(iframe);
            console.error(err);
            toast('❗ 이미지 저장 실패. 다시 시도해주세요.');
        });
    }, 800);
}

function _getUnpaidList(clientName, month) {
    // 오래된 전표부터 정렬 (이월 → 당월 순) — 공유 캐시도 포함
    const monthStart = month + '-01';
    const allOrders = [...orders, ..._sharedOrdersCache];
    return allOrders
        .filter(o => o.clientName === clientName && !o.isPaid &&
                     (o.date?.startsWith(month) || o.date < monthStart))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function openPartialPay(clientName, month) {
    const list = _getUnpaidList(clientName, month);
    if (!list.length) return toast('✅ 미수금이 없습니다');

    const total = list.reduce((s, o) => s + o.total - (o.paidAmount || 0), 0);
    const monthStart = month + '-01';
    const carry = list.filter(o => o.date < monthStart)
                      .reduce((s, o) => s + o.total - (o.paidAmount || 0), 0);

    document.getElementById('ppClientName').value        = clientName;
    document.getElementById('ppMonth').value             = month;
    document.getElementById('ppClientTitle').textContent = clientName + '  ·  ' + month;
    document.getElementById('ppTotalUnpaid').textContent = fmt(total) + '원';
    document.getElementById('ppAmount').value            = '';
    document.getElementById('ppNote').value              = '';
    document.getElementById('ppPreview').style.display   = 'none';

    // 이월 표시
    const carryRow = document.getElementById('ppCarryRow');
    if (carry > 0) {
        carryRow.style.display = 'flex';
        document.getElementById('ppCarryAmt').textContent = fmt(carry) + '원';
    } else {
        carryRow.style.display = 'none';
    }

    // 빠른 금액 버튼 생성
    const seen = new Set();
    const btns = [];
    const add = (label, val) => {
        if (val > 0 && val <= total && !seen.has(val)) {
            seen.add(val); btns.push({ label, val });
        }
    };
    add('전체 ' + fmt(total) + '원', total);
    if (carry > 0 && carry < total) add('이월 ' + fmt(carry) + '원', carry);
    const half = Math.round(total / 2 / 1000) * 1000;
    if (half > 0) add('절반 ' + fmt(half) + '원', half);
    [500000, 300000, 200000, 100000, 50000].forEach(v => add(fmt(v) + '원', v));

    document.getElementById('ppQuickBtns').innerHTML = btns.slice(0, 5).map(b =>
        '<button type="button" class="chip" style="font-size:11px;padding:5px 10px;"' +
        ' onclick="_setMoneyVal(\'ppAmount\',' + b.val + ');previewPartialPay()">' +
        b.label + '</button>'
    ).join('');

    _setPayMethod('pp', 'cash');
    // 혼합 UI 초기화
    const mixedGrp  = document.getElementById('ppMixedGroup');
    const singleGrp = document.getElementById('ppSingleAmtGroup');
    const quickBtns = document.getElementById('ppQuickBtns');
    if (mixedGrp)  { mixedGrp.style.display = 'none'; }
    if (singleGrp) { singleGrp.style.display = ''; }
    if (quickBtns) { quickBtns.style.display = ''; }
    const ppTransfer = document.getElementById('ppTransferAmt');
    const ppCash     = document.getElementById('ppCashAmt');
    const ppMixedPv  = document.getElementById('ppMixedPreview');
    if (ppTransfer) ppTransfer.value = '';
    if (ppCash)     ppCash.value = '';
    if (ppMixedPv)  ppMixedPv.style.display = 'none';
    openModal('partialPayModal');
    setTimeout(() => document.getElementById('ppAmount').focus(), 80);
}

function previewPartialPay() {
    const clientName = document.getElementById('ppClientName').value;
    const month      = document.getElementById('ppMonth').value;
    const amount     = _moneyVal('ppAmount') || 0;
    const preview    = document.getElementById('ppPreview');
    if (amount <= 0) { preview.style.display = 'none'; return; }

    const list  = _getUnpaidList(clientName, month);
    const total = list.reduce((s, o) => s + o.total - (o.paidAmount || 0), 0);
    let remain  = amount;
    const rows  = [];

    for (const o of list) {
        if (remain <= 0) break;
        const due   = o.total - (o.paidAmount || 0);
        const apply = Math.min(due, remain);
        remain -= apply;
        const full = apply >= due;
        rows.push(
            o.date + '&nbsp;&nbsp;<b>' + fmt(apply) + '원</b>&nbsp;&nbsp;' +
            (full ? '<span style="color:var(--green);">→ 완납 ✅</span>'
                  : '<span style="color:var(--orange);">→ 잔여 ' + fmt(due - apply) + '원</span>')
        );
    }
    if (remain > 0) {
        rows.push('<span style="color:var(--orange);">⚠ 미수금보다 ' + fmt(remain) + '원 초과</span>');
    }
    const after = Math.max(0, total - amount);
    rows.push('<hr style="border:none;border-top:1px solid var(--border);margin:5px 0;">');
    rows.push('입금 후 잔여 미수금: <b style="color:' +
        (after > 0 ? 'var(--red)' : 'var(--green)') + ';">' + fmt(after) + '원</b>');

    preview.innerHTML = rows.join('<br>');
    preview.style.display = 'block';
}


// ─── 수금 방법 선택 ───
function selectPayMethod(prefix, method, btn) {
    const group = document.getElementById(prefix + 'MethodGroup');
    if (!group) return;
    group.querySelectorAll('.pay-method-btn').forEach(b => {
        b.classList.remove('active');
    });
    btn.classList.add('active');
    // pp 모달: 혼합 선택 시 분리 입력 UI 표시
    if (prefix === 'pp') {
        const isMixed = method === 'mixed';
        const singleGrp = document.getElementById('ppSingleAmtGroup');
        const mixedGrp  = document.getElementById('ppMixedGroup');
        const quickBtns = document.getElementById('ppQuickBtns');
        if (singleGrp) singleGrp.style.display = isMixed ? 'none' : '';
        if (mixedGrp)  mixedGrp.style.display  = isMixed ? 'block' : 'none';
        if (quickBtns) quickBtns.style.display  = isMixed ? 'none' : '';
        if (isMixed) {
            document.getElementById('ppTransferAmt').value = '';
            document.getElementById('ppCashAmt').value = '';
            document.getElementById('ppMixedPreview').style.display = 'none';
        }
        const sheet = document.getElementById('partialPayModal')?.querySelector('.modal-sheet');
        if (sheet) setTimeout(() => sheet.scrollTo({ top: sheet.scrollHeight, behavior: 'smooth' }), 80);
    }
}

function _getPayMethod(prefix) {
    const group = document.getElementById(prefix + 'MethodGroup');
    if (!group) return 'cash';
    const active = group.querySelector('.pay-method-btn.active');
    return active ? active.dataset.method : 'cash';
}

function _setPayMethod(prefix, method) {
    const group = document.getElementById(prefix + 'MethodGroup');
    if (!group) return;
    group.querySelectorAll('.pay-method-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.method === (method || 'cash'));
    });
}

function _methodLabel(method) {
    if (method === 'transfer') return '🏦 계좌이체';
    if (method === 'other')    return '📝 기타';
    if (method === 'mixed')    return '💳 혼합결제';
    return '💵 현금';
}
function _methodBadgeHtml(method) {
    if (!method || method === 'cash')     return '<span class="pay-method-badge cash">💵현금</span>';
    if (method === 'transfer') return '<span class="pay-method-badge transfer">🏦이체</span>';
    if (method === 'mixed')    return '<span class="pay-method-badge" style="background:#7c3aed22;color:#a78bfa;">💳혼합</span>';
    return '<span class="pay-method-badge other">📝기타</span>';
}

function previewMixedPay() {
    const clientName = document.getElementById('ppClientName').value;
    const month      = document.getElementById('ppMonth').value;
    const transfer   = _moneyVal('ppTransferAmt');
    const cash       = _moneyVal('ppCashAmt');
    const total      = transfer + cash;
    const preview    = document.getElementById('ppMixedPreview');
    if (!preview) return;
    if (total <= 0) { preview.style.display = 'none'; return; }
    const list    = _getUnpaidList(clientName, month);
    const unpaid  = list.reduce((s, o) => s + o.total - (o.paidAmount || 0), 0);
    const remain  = unpaid - total;
    let html = `🏦 이체 <strong>${fmt(transfer)}원</strong> + 💵 현금 <strong>${fmt(cash)}원</strong> = 합계 <strong>${fmt(total)}원</strong><br>`;
    if (remain > 0)        html += `<span style="color:var(--orange);">잔여 미수금 ${fmt(remain)}원</span>`;
    else if (remain === 0) html += `<span style="color:var(--green);">✅ 전액 완납</span>`;
    else                   html += `<span style="color:var(--red);">⚠ 미수금(${fmt(unpaid)}원) 초과 ${fmt(-remain)}원</span>`;
    preview.innerHTML = html;
    preview.style.display = 'block';
}

function togglePpDiscount() {
    const body   = document.getElementById('ppDiscountBody');
    const toggle = document.getElementById('ppDiscountToggle');
    const open   = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    toggle.classList.toggle('open', !open);
}

// 입금처리 모달 — 할인 완납: 입금액만큼 받고 나머지 차액은 할인으로 완납 처리
async function confirmPartialPayDiscount() {
    const clientName = document.getElementById('ppClientName').value;
    const month      = document.getElementById('ppMonth').value;
    const amount     = _moneyVal('ppAmount');
    const note       = document.getElementById('ppNote').value.trim();
    const method     = _getPayMethod('pp');

    if (method === 'mixed') return toast('❗ 할인 완납은 단일 수금 방법(현금/이체)으로만 가능합니다');
    if (!amount || amount <= 0) return toast('❗ 실수령액을 입력하세요');

    const list  = _getUnpaidList(clientName, month);
    if (!list.length) return toast('✅ 미수금이 없습니다');

    const total = list.reduce((s, o) => s + o.total - (o.paidAmount || 0), 0);
    if (amount > total) return toast('❗ 실수령액이 총 미수금보다 많습니다');

    if (!await customConfirm(
        `총 미수금 ${fmt(total)}원 중\n` +
        `실수령 ${fmt(amount)}원, 할인 ${fmt(total - amount)}원으로\n✅ 전체 완납 처리할까요?`,
        '완납 처리', 'btn-primary'
    )) return;

    const now = new Date().toISOString();
    let remain = amount;
    const fbUpdates = {}; // 공유 내역 Firebase 업데이트 묶음

    for (const o of list) {
        const due = o.total - (o.paidAmount || 0);
        if (due <= 0) continue;
        const apply = Math.min(due, remain);
        remain -= apply;
        const discountAmt = due - apply; // 이 전표에 적용된 할인액
        const patch = {
            isPaid:     true,
            paidAmount: (o.paidAmount || 0) + apply, // 실수령액만 저장
            paidAt:     now,
            paidMethod: method,
            updatedAt:  now,
        };
        if (discountAmt > 0) patch.discount = (o.discount || 0) + discountAmt;
        if (note) patch.paidNote = note;
        patch.crmControlled = null; // 납품앱 직접 결제 → CRM 우선권 해제 (공유 전표 Firebase에도 반영)
        Object.assign(o, patch);
        delete o.crmControlled;

        if (o._sharedWsId) {
            // 공유 전표: A의 Firebase에 직접 반영
            Object.keys(patch).forEach(k => {
                fbUpdates[`workspaces/${o._sharedWsId}/orders/${o.id}/${k}`] = patch[k] ?? null;
            });
            fbUpdates[`workspaces/${o._sharedWsId}/orders/${o.id}/updatedAt`] = now;
        } else {
            _markDirtyOrder(o.id); // 내 전표: delta sync 마킹
        }
    }

    // 공유 내역 일괄 Firebase 반영
    if (Object.keys(fbUpdates).length && typeof firebase !== 'undefined' && firebase.apps.length) {
        firebase.database().ref('/').update(fbUpdates)
            .catch(e => console.warn('[할인완납공유]', e));
    }

    _saveAndFlush();
    closeModal('partialPayModal');
    _safeRefresh(
        () => showClientStatement(clientName, month),
        renderOrders, renderDashboard, updateInfoCounts, updateNavBadges,
        _refreshUnpaidIfActive, _refreshSettlementIfActive
    );
    const discount = total - amount;
    toast(`✂️ 할인 완납 처리 (할인 ${fmt(discount)}원)`, 'var(--green)');
    // CRM 역방향 패치: 내 전표만 (공유 전표는 A의 거래장이 직접 처리)
    list.filter(o => !o._sharedWsId).forEach(o => _afterDlPayPatch(o.id, o));
}

async function confirmPartialPay() {
    const clientName = document.getElementById('ppClientName').value;
    const month      = document.getElementById('ppMonth').value;
    const note       = document.getElementById('ppNote').value.trim();
    const method     = _getPayMethod('pp');

    // ── 혼합 결제 분기 ──
    if (method === 'mixed') {
        const transferAmt = _moneyVal('ppTransferAmt');
        const cashAmt     = _moneyVal('ppCashAmt');
        const total       = transferAmt + cashAmt;
        if (total <= 0) return toast('❗ 이체/현금 금액을 입력하세요');
        if (transferAmt <= 0 && cashAmt <= 0) return toast('❗ 이체 또는 현금 금액을 입력하세요');

        const list   = _getUnpaidList(clientName, month);
        if (!list.length) return toast('✅ 미수금이 없습니다');
        const unpaid = list.reduce((s, o) => s + o.total - (o.paidAmount || 0), 0);
        if (total > unpaid) {
            if (!await customConfirm(`입금액(${fmt(total)}원)이 미수금(${fmt(unpaid)}원)보다 많습니다.\n전체 완납으로 처리할까요?`, '전체 완납')) return;
        }

        let remain = total, fullCnt = 0, partCnt = 0;
        const now  = new Date().toISOString();
        const fbUpdates = {}; // 공유 내역 Firebase 업데이트 묶음
        for (const o of list) {
            if (remain <= 0) break;
            const due   = o.total - (o.paidAmount || 0);
            const apply = Math.min(due, remain);
            remain -= apply;
            const ratio = total > 0 ? apply / total : 0;
            const applyTransfer = Math.round(transferAmt * ratio);
            const applyCash     = apply - applyTransfer;
            const patch = { paidMethodDetail: { transfer: applyTransfer, cash: applyCash }, paidAt: now, paidMethod: 'mixed' };
            if (note) patch.paidNote = note;
            if (apply >= due) {
                patch.isPaid = true; patch.paidAmount = o.total;
                fullCnt++;
            } else {
                patch.paidAmount = (o.paidAmount || 0) + apply;
                partCnt++;
            }
            Object.assign(o, patch);
            if (o._sharedWsId) {
                // 공유 내역: Firebase 업데이트 묶음에 추가
                Object.keys(patch).forEach(k => {
                    fbUpdates[`workspaces/${o._sharedWsId}/orders/${o.id}/${k}`] = patch[k] ?? null;
                });
                fbUpdates[`workspaces/${o._sharedWsId}/orders/${o.id}/updatedAt`] = new Date().toISOString();
            } else {
                _markDirtyOrder(o.id);
            }
        }
        // 공유 내역 일괄 Firebase 반영
        if (Object.keys(fbUpdates).length && typeof firebase !== 'undefined' && firebase.apps.length) {
            firebase.database().ref('/').update(fbUpdates).catch(e => console.warn('[공유부분수금]', e));
        }
        _saveAndFlush(); closeModal('partialPayModal');
        _safeRefresh(
            () => showClientStatement(clientName, month),
            renderOrders, renderDashboard, updateInfoCounts, updateNavBadges,
            _refreshUnpaidIfActive, _refreshSettlementIfActive
        );
        toast(`💳 혼합 완납 (🏦${fmt(transferAmt)}원 + 💵${fmt(cashAmt)}원)`, 'var(--green)');
        list.filter(o => !o._sharedWsId).forEach(o => _afterDlPayPatch(o.id, o));
        return;
    }

    // ── 기존 단일 방법 처리 ──
    const amount = _moneyVal('ppAmount');

    if (!amount || amount <= 0) return toast('❗ 입금액을 입력하세요');

    const list  = _getUnpaidList(clientName, month);
    if (!list.length) return toast('✅ 미수금이 없습니다');

    const total = list.reduce((s, o) => s + o.total - (o.paidAmount || 0), 0);
    if (amount > total) {
        if (!await customConfirm(
            '입금액(' + fmt(amount) + '원)이 미수금(' + fmt(total) + '원)보다 많습니다.\n전체 완납으로 처리할까요?',
            '전체 완납'
        )) return;
    }

    let remain = amount, fullCnt = 0, partCnt = 0;
    const now  = new Date().toISOString();
    const fbUpdates2 = {}; // 공유 내역 Firebase 업데이트 묶음

    for (const o of list) {
        if (remain <= 0) break;
        const due   = o.total - (o.paidAmount || 0);
        const apply = Math.min(due, remain);
        remain -= apply;
        const resolvedMethod = (o.paidMethod && o.paidMethod !== method) ? 'mixed' : method;
        const patch = { paidAt: now, paidMethod: resolvedMethod };
        if (note) patch.paidNote = note;
        if (apply >= due) {
            patch.isPaid = true; patch.paidAmount = o.total;
            fullCnt++;
        } else {
            patch.paidAmount = (o.paidAmount || 0) + apply;
            patch.crmControlled = null;
            partCnt++;
        }
        Object.assign(o, patch);
        if (o._sharedWsId) {
            Object.keys(patch).forEach(k => {
                fbUpdates2[`workspaces/${o._sharedWsId}/orders/${o.id}/${k}`] = patch[k] ?? null;
            });
            fbUpdates2[`workspaces/${o._sharedWsId}/orders/${o.id}/updatedAt`] = new Date().toISOString();
        } else {
            _markDirtyOrder(o.id);
        }
    }

    // 공유 내역 일괄 Firebase 반영
    if (Object.keys(fbUpdates2).length && typeof firebase !== 'undefined' && firebase.apps.length) {
        firebase.database().ref('/').update(fbUpdates2).catch(e => console.warn('[공유부분수금단일]', e));
    }
    _saveAndFlush();
    closeModal('partialPayModal');
    _safeRefresh(
        () => showClientStatement(clientName, month),
        renderOrders, renderDashboard, updateInfoCounts, updateNavBadges,
        _refreshUnpaidIfActive, _refreshSettlementIfActive
    );

    const methodLbl = _methodLabel(method);
    const msg = fullCnt > 0 && partCnt > 0
        ? methodLbl + ' ' + fullCnt + '건 완납 + 부분 입금 처리 완료'
        : fullCnt > 0
            ? methodLbl + ' ' + fullCnt + '건 완납 처리 완료'
            : methodLbl + ' 부분 입금 ' + fmt(amount) + '원 처리 완료';
    toast(msg, 'var(--green)');
    // CRM 역방향 패치 (내 전표만)
    list.filter(o => !o._sharedWsId).forEach(o => _afterDlPayPatch(o.id, o));
}

// ─── 수금 수정 ───

function openPayEdit(orderId, clientName, month) {
    const foundPe = _findOrderAnywhere(String(orderId));
    if (!foundPe) return toast('❗ 전표를 찾을 수 없습니다');
    const o = foundPe.order;

    document.getElementById('peOrderId').value    = orderId;
    document.getElementById('peClientName').value = clientName;
    document.getElementById('peMonth').value      = month;

    const itemNames = (o.items||[]).map(i=>`${i.name}(${Math.abs(i.qty)})`).join(', ');
    document.getElementById('peOrderInfo').textContent  = `${o.date} · ${itemNames}`;
    document.getElementById('peOrderTotal').textContent = fmt(o.total) + '원';
    _setMoneyVal('peAmount', o.paidAmount || 0);
    document.getElementById('peNote').value   = o.paidNote || '';

    // 빠른 버튼: 0원(취소), 절반, 전액
    const seen = new Set();
    const btns = [];
    const addBtn = (label, val) => {
        if (!seen.has(val)) { seen.add(val); btns.push({ label, val }); }
    };
    addBtn('전액 ' + fmt(o.total) + '원', o.total);
    const half = Math.round(o.total / 2 / 1000) * 1000;
    if (half > 0 && half < o.total) addBtn('절반 ' + fmt(half) + '원', half);
    [500000, 300000, 200000, 100000, 50000].forEach(v => { if (v < o.total) addBtn(fmt(v) + '원', v); });
    addBtn('수금 취소 (0원)', 0);

    document.getElementById('peQuickBtns').innerHTML = btns.slice(0, 5).map(b =>
        `<button type="button" class="chip" style="font-size:11px;padding:5px 10px;"
         onclick="_setMoneyVal('peAmount',${b.val});">${b.label}</button>`
    ).join('');

    // statementModal 위에 표시
    _setPayMethod('pe', o.paidMethod || 'cash');
    openModal('payEditModal');
    setTimeout(() => document.getElementById('peAmount').focus(), 80);
}

function confirmPayEdit() {
    const orderId    = document.getElementById('peOrderId').value;
    const clientName = document.getElementById('peClientName').value;
    const month      = document.getElementById('peMonth').value;
    const amount     = _moneyVal('peAmount');
    const note       = document.getElementById('peNote').value.trim();
    const method     = _getPayMethod('pe');

    const foundPeConfirm = _findOrderAnywhere(String(orderId));
    if (!foundPeConfirm) return toast('❗ 전표를 찾을 수 없습니다');
    const o = foundPeConfirm.order;

    if (amount < 0) return toast('❗ 0 이상의 금액을 입력하세요');

    let patch, toastMsg;
    if (amount === 0) {
        patch = { paidAmount: 0, isPaid: false, paidAt: null, paidNote: null,
                  paidMethod: null, paidMethodDetail: null, crmControlled: null };
        toastMsg = '🔴 수금 취소 — 미수로 변경됨';
    } else if (amount >= o.total) {
        patch = { paidAmount: o.total, isPaid: true, paidAt: new Date().toISOString(),
                  paidMethod: method, crmControlled: null };
        if (note) patch.paidNote = note;
        toastMsg = '💚 완납으로 수정됨 · ' + _methodLabel(method);
    } else {
        patch = { paidAmount: amount, isPaid: false, paidAt: new Date().toISOString(), paidMethod: method };
        if (note) patch.paidNote = note;
        toastMsg = _methodLabel(method) + ' ' + fmt(amount) + '원으로 수정됨';
    }
    Object.assign(o, patch);
    toast(toastMsg, amount > 0 ? 'var(--green)' : undefined);

    // ★ v113 fix: isShared 여부와 무관하게 payEditModal 먼저 닫기 (공유 전표도 모달 즉시 닫혀야 UI 갱신됨)
    closeModal('payEditModal');

    if (foundPeConfirm.isShared) {
        _patchSharedOrder(foundPeConfirm.sharedWsId, orderId, patch)
            .then(ok => {
                if (ok) {
                    _safeRefresh(
                        () => showClientStatement(clientName, month),
                        renderOrders, renderDashboard, updateInfoCounts, updateNavBadges,
                        _refreshUnpaidIfActive, _refreshSettlementIfActive
                    );
                    // 공유 전표도 CRM 역방향 패치
                    _afterDlPayPatch(o.id, o);
                }
            });
    } else {
        _markDirtyOrder(orderId);
        _saveAndFlush();
        _safeRefresh(
            () => showClientStatement(clientName, month),
            renderOrders, renderDashboard, updateInfoCounts, updateNavBadges,
            () => _afterDlPayPatch(o.id, o),
            _refreshUnpaidIfActive, _refreshSettlementIfActive
        );
    }
}

async function confirmPayEditCancel() {
    if (!await customConfirm('이 전표의 수금을 취소하고 미수로 되돌릴까요?')) return;
    document.getElementById('peAmount').value = '';
    confirmPayEdit();
}



// 전체완납 팝업 상태
let _bulkPayState = null;

function bulkPayClient(clientName, month) {
    const monthStart = month + '-01';
    // 공유 캐시 포함
    const allOrdersForBulk = [...orders, ..._sharedOrdersCache];
    const unpaidList = allOrdersForBulk.filter(o =>
        o.clientName === clientName &&
        (o.date?.startsWith(month) || o.date < monthStart) &&
        !o.isPaid
    );
    if (!unpaidList.length) return toast('✅ 미수금이 없습니다');
    const total = unpaidList.reduce((s,o)=>s+o.total-(o.paidAmount||0),0);
    // 팝업으로 수금방법 선택
    _bulkPayState = { clientName, month, unpaidList, total };
    document.getElementById('bulkPaySub').textContent =
        `${clientName} · ${unpaidList.length}건 · ${fmt(total)}원 전체 완납`;
    document.getElementById('bulkPayOverlay').classList.add('open');
    document.getElementById('bulkPayPopup').classList.add('open');
}

function closeBulkPayPopup() {
    document.getElementById('bulkPayOverlay').classList.remove('open');
    document.getElementById('bulkPayPopup').classList.remove('open');
    _bulkPayState = null;
}

async function _doBulkPay(selectedMethod) {
    if (!_bulkPayState) return;
    const { clientName, month, unpaidList } = _bulkPayState;
    closeBulkPayPopup();
    const now = new Date().toISOString();
    const fbBulk = {};
    unpaidList.forEach(o => {
        o.isPaid = true; o.paidAmount = o.total; o.paidAt = now; o.paidMethod = selectedMethod;
        if (o._sharedWsId) {
            const p = `workspaces/${o._sharedWsId}/orders/${o.id}`;
            fbBulk[p + '/isPaid']     = true;
            fbBulk[p + '/paidAmount'] = o.total;
            fbBulk[p + '/paidAt']     = now;
            fbBulk[p + '/paidMethod'] = selectedMethod;
            fbBulk[p + '/updatedAt']  = now;
        } else {
            _markDirtyOrder(o.id);
        }
    });
    if (Object.keys(fbBulk).length && typeof firebase !== 'undefined' && firebase.apps.length) {
        await firebase.database().ref('/').update(fbBulk).catch(e => console.warn('[공유전체완납]', e));
    }
    _saveAndFlush();
    _safeRefresh(
        () => showClientStatement(clientName, month),
        renderOrders, renderDashboard, updateInfoCounts, updateNavBadges,
        _refreshUnpaidIfActive, _refreshSettlementIfActive
    );
    toast(`💚 ${unpaidList.length}건 완납 처리 완료 · ${_methodLabel(selectedMethod)}`, 'var(--green)');
    // CRM 역방향 패치 (내 전표 + 공유 전표 모두 — wsId는 crm-sync가 _sharedWsId로 판단)
    unpaidList.forEach(o => _afterDlPayPatch(o.id, o));
}

