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
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <div style="font-size:19px;font-weight:900;">${escapeHtml(clientName)}</div>
                <label style="display:flex;align-items:center;gap:5px;margin-left:auto;font-size:12px;font-weight:700;color:var(--text2);cursor:pointer;white-space:nowrap;" title="현재 명세표에 보이는 전표 전체의 계산서 발급 여부를 한 번에 체크/해제">
                    <input type="checkbox" id="statementInvoiceAllCb" onclick="toggleAllInvoiceIssued('${escapeAttr(clientName)}','${escapeAttr(month)}')" style="width:17px;height:17px;cursor:pointer;">
                    계산서 일괄
                </label>
            </div>
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
        <label style="display:flex;align-items:center;gap:6px;margin-top:12px;font-size:12px;font-weight:700;color:var(--text2);cursor:pointer;">
            <input type="checkbox" id="statementSealCb" ${localStorage.getItem('showSupplierSeal') !== '0' ? 'checked' : ''} onchange="localStorage.setItem('showSupplierSeal', this.checked ? '1' : '0')" style="width:16px;height:16px;cursor:pointer;">
            🔖 PNG 저장 시 대표 도장 포함
        </label>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
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
    // 계산서 일괄 체크박스 — 현재 명세표에 보이는 전표 기준으로 전체/부분/전체해제 상태 반영
    const _invoiceTargets = [...carryOrders, ...filt];
    const _invoiceAllCb = document.getElementById('statementInvoiceAllCb');
    if (_invoiceAllCb && _invoiceTargets.length) {
        const _issuedCnt = _invoiceTargets.filter(o => o.invoiceIssued).length;
        _invoiceAllCb.checked = _issuedCnt === _invoiceTargets.length;
        _invoiceAllCb.indeterminate = _issuedCnt > 0 && _issuedCnt < _invoiceTargets.length;
    }
    openModal('statementModal');
}

// "계산서 일괄" 체크박스 — 지금 명세표에 보이는 전표(당월 + 미수 이월) 전체를 한 번에 체크/해제
// 일부만 체크된 상태에서 누르면 전체 체크로, 전부 체크된 상태에서 누르면 전체 해제로 동작
async function toggleAllInvoiceIssued(clientName, month) {
    const monthStart = month + '-01';
    const allOrdersForBulk = [...orders, ..._sharedOrdersCache];
    const targets = allOrdersForBulk.filter(o =>
        o.clientName === clientName &&
        (o.date?.startsWith(month) || (o.date < monthStart && !o.isPaid))
    );
    if (!targets.length) return;
    const newVal = !targets.every(o => o.invoiceIssued);
    const patch = { invoiceIssued: newVal };
    for (const o of targets) {
        if (o._sharedWsId) {
            await _patchSharedOrder(o._sharedWsId, o.id, patch);
        } else {
            Object.assign(o, patch);
            _markDirtyOrder(o.id);
        }
    }
    _saveAndFlush();
    _safeRefresh(() => showClientStatement(clientName, month), renderOrders);
}

// ─── 거래처 명세표 JPG 저장 ───

function saveStatementPNG(clientName, month) {
    // 공급자 정보 (거래명세표 이미지 상단에 표기)
    const SUPPLIER_NAME  = '이른아침';
    const SUPPLIER_REGNO = '615-91-44749';
    const SUPPLIER_CEO   = '이 애 경';
    const SUPPLIER_ADDR  = '경남 김해시 장유로 416번길 41-21(신문동)';
    const SUPPLIER_SEAL   = 'data:image/png;base64,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';
    const showSeal = localStorage.getItem('showSupplierSeal') !== '0'; // 기본값: 표시
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
  .supplier-info { font-size:11px; color:#666; line-height:1.7; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #eee; }
  .seal-img { height:34px; vertical-align:middle; margin-left:3px; transform:translateY(-2px); }
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
  <div class="supplier-info">
    공급자: ${escapeHtml(SUPPLIER_NAME)} · 사업자등록번호: ${SUPPLIER_REGNO} · 대표: ${escapeHtml(SUPPLIER_CEO)}${showSeal ? `<img src="${SUPPLIER_SEAL}" class="seal-img" alt="">` : ''}<br>
    ${escapeHtml(SUPPLIER_ADDR)}
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
    // ★ v151 fix: 할인완납된 전표(paidAmount < total)를 열면 paidAmount로 프리필되어,
    // 금액을 안 건드리고 그대로 저장 시 amount < total → 아래 부분결제 분기로 빠져 완납이
    // 미수로 되돌아가는 문제가 있었음. 이미 완납(isPaid)인 전표는 total로 프리필한다.
    _setMoneyVal('peAmount', o.isPaid ? o.total : (o.paidAmount || 0));
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

    // ★ v151 fix: 세 분기 모두 discount:null 포함 — 할인완납(o.discount>0) 전표를 수금수정
    // 하면 discount가 안 지워져 대시보드·정산·CRM 매출집계(_effectiveTotal 패턴, 9곳 이상)가
    // 정정된 금액이 아닌 예전 할인만큼 축소 집계되는 문제가 있었음. 수금수정은 금액을 명시적
    // 으로 재지정하는 동작이므로 이전 할인 컨텍스트는 항상 초기화한다.
    let patch, toastMsg;
    if (amount === 0) {
        patch = { paidAmount: 0, isPaid: false, paidAt: null, paidNote: null,
                  paidMethod: null, paidMethodDetail: null, crmControlled: null, discount: null };
        toastMsg = '🔴 수금 취소 — 미수로 변경됨';
    } else if (amount >= o.total) {
        patch = { paidAmount: o.total, isPaid: true, paidAt: new Date().toISOString(),
                  paidMethod: method, crmControlled: null, discount: null };
        if (note) patch.paidNote = note;
        toastMsg = '💚 완납으로 수정됨 · ' + _methodLabel(method);
    } else {
        patch = { paidAmount: amount, isPaid: false, paidAt: new Date().toISOString(), paidMethod: method, discount: null };
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

