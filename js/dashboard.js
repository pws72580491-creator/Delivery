// ╔══════════════════════════════════════════════════════════════╗
// ║  § 10  대시보드                                                   ║
// ╚══════════════════════════════════════════════════════════════╝

function renderDashboard() {
    const month = todayKST().slice(0,7);
    const curr  = orders.filter(o=>o.date?.startsWith(month) && !o.delegatedBy);
    const _et   = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
    const sales  = curr.reduce((s,o)=>s+_et(o),0);
    // 미수금: 전체 기간 누적 미수금
    // delegatedBy: 대납 거래는 미수금 집계에서도 제외
    // ★ 주문별로 먼저 0 이상으로 자르지 않고 그대로 합산 → 반품/회수(음수 total)가
    //   같은 거래처의 다른 미수금과 정확히 상쇄된 뒤, 최종 합계만 0 이상으로 표시
    const totalUnpaid = Math.max(0, orders.filter(o => !o.delegatedBy && !o.isPaid)
        .reduce((s, o) => s + (o.total - _actualPaid(o)), 0));
    document.getElementById('dashSales').textContent  = fmt(sales);
    document.getElementById('dashUnpaid').textContent = fmt(totalUnpaid);

    // ─── 최근 7일 매출 바차트 ───
    _renderWeekBarChart();

    // ─── 최근 납품 내역 (최근 7건) ───
    const recentEl = document.getElementById('dashRecentSection');
    if (!recentEl) return;
    const recent = [...orders].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||b.createdAt?.localeCompare(a.createdAt||"")).slice(0,7);
    if (!recent.length) {
        recentEl.innerHTML = '';
        return;
    }
    const today = todayKST();
    recentEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;margin-top:4px;">
            <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.7px;text-transform:uppercase;">최근 납품</div>
            <button class="btn btn-ghost btn-sm" onclick="showTab('history')" style="font-size:10px;padding:4px 9px;">전체보기</button>
        </div>
        ${recent.map(o => {
            const isToday = o.date === today;
            const isUnpaid = !o.isPaid && !o.isReturn;
            return `<div class="recent-card" onclick="showOrderDetail('${escapeAttr(o.id)}')">
                <div>
                    <div class="recent-client">${escapeHtml(o.clientName||'(없음)')}${isToday?'<span style="margin-left:5px;font-size:9px;background:var(--accent);color:#fff;padding:1px 5px;border-radius:4px;font-weight:700;">오늘</span>':''}</div>
                    <div class="recent-date">${escapeHtml(o.date)} · ${(o.items||[]).length}품목${o.isReturn?'<span style="margin-left:5px;color:var(--red);font-weight:700;">↩반품/회수</span>':''}${isUnpaid?'<span style="margin-left:5px;color:var(--red);font-weight:700;">미수</span>':''}</div>
                </div>
                <div class="recent-amount" style="${o.isReturn?'color:var(--red);':''}">${fmt(o.total)}원</div>
            </div>`;
        }).join('')}`;

    // ── 대시보드 미수 거래처 현황 ──
    const unpaidEl = document.getElementById('dashUnpaidSection');
    if (!unpaidEl) return;
    const clientUnpaidMap = {};
    orders.forEach(o => {
        if (o.isPaid) return;
        const key = o.clientId || o.clientName;
        if (!clientUnpaidMap[key]) clientUnpaidMap[key] = { name: o.clientName||'(없음)', amt: 0, oldestDate: o.date, phone: '' };
        // ★ 반품/회수(음수 total)도 그대로 합산해 같은 거래처 미수금과 상쇄
        clientUnpaidMap[key].amt += (o.total - (o.paidAmount||0));
        if (o.date < clientUnpaidMap[key].oldestDate) clientUnpaidMap[key].oldestDate = o.date;
    });
    // 연락처 보충
    clients.forEach(cl => {
        const m = clientUnpaidMap[cl.id] || clientUnpaidMap[cl.name];
        if (m && cl.phone) m.phone = cl.phone;
    });
    const unpaidList = Object.values(clientUnpaidMap).filter(x => x.amt > 0).sort((a,b) => b.amt - a.amt).slice(0,5);
    if (!unpaidList.length) { unpaidEl.innerHTML = ''; return; }
    const todayD = todayKST();
    unpaidEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;margin-top:12px;">
            <div style="font-size:11px;font-weight:700;color:var(--red);letter-spacing:.7px;text-transform:uppercase;">💸 미수금 현황</div>
            <button class="btn btn-ghost btn-sm" onclick="showTab('unpaid')" style="font-size:10px;padding:4px 9px;">전체보기</button>
        </div>
        <div class="card" style="padding:8px 12px;">
        ${unpaidList.map(u => {
            const days = Math.floor((new Date(todayD) - new Date(u.oldestDate)) / 86400000);
            const dayCls = days >= 90 ? 'severe' : days >= 60 ? 'danger' : days >= 30 ? 'warn' : '';
            const dayLabel = days >= 90 ? `🚨 ${days}일` : days >= 60 ? `🔴 ${days}일` : days >= 30 ? `🟠 ${days}일` : `🟢 ${days}일`;
            return `<div class="dash-unpaid-row" onclick="showTab('unpaid')">
                <div>
                    <div class="dash-unpaid-name">${escapeHtml(u.name)}</div>
                    <div class="dash-unpaid-info">최장 경과</div>
                </div>
                <div class="dash-unpaid-right">
                    <div class="dash-unpaid-amt">${fmt(u.amt)}원</div>
                    <div class="dash-unpaid-days ${dayCls}">${dayLabel}</div>
                </div>
            </div>`;
        }).join('')}
        </div>`;
}


// ─── 최근 7일 매출 바차트 ───
function _renderWeekBarChart() {
    const el = document.getElementById('dashWeekBarChart');
    const totalEl = document.getElementById('dashWeekTotal');
    if (!el) return;
    const today = todayKST();
    const days = [];
    for (let i = 6; i >= 0; i--) days.push(kstAddDays(today, -i));
    const _et = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
    const data = days.map(d => ({
        label: d.slice(5),
        day: ['일','월','화','수','목','금','토'][new Date(d).getDay()],
        isToday: d === today,
        sales: orders.filter(o => o.date === d && !o.isVoid && !o.delegatedBy).reduce((s, o) => s + _et(o), 0)
    }));
    const maxVal = Math.max(...data.map(d => d.sales), 1);
    const weekTotal = data.reduce((s, d) => s + d.sales, 0);
    if (totalEl) totalEl.textContent = fmt(weekTotal) + '원';
    el.innerHTML = data.map(d => {
        const pct = Math.round((d.sales / maxVal) * 100);
        const barH = Math.max(pct * 0.9, d.sales > 0 ? 4 : 0); // max 90px
        const isToday = d.isToday;
        const barColor = isToday
            ? 'linear-gradient(180deg,#f87171,#ef4444)'
            : 'linear-gradient(180deg,rgba(248,113,113,.75),rgba(239,68,68,.5))';
        const labelColor = isToday ? '#fca5a5' : 'rgba(248,113,113,.85)';
        const amtLabel = d.sales >= 1000000
            ? (d.sales/1000000).toFixed(1)+'M'
            : d.sales >= 1000
            ? Math.round(d.sales/1000)+'K'
            : d.sales > 0 ? String(d.sales) : '';
        // 금액 레이블: 막대가 충분히 높으면 내부에, 낮으면 막대 위에
        const labelInside = barH >= 22 && amtLabel;
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;position:relative;">
            ${!labelInside && amtLabel ? `<div style="font-size:9px;font-weight:700;color:${labelColor};height:12px;line-height:12px;text-align:center;width:100%;overflow:visible;white-space:nowrap;">${amtLabel}</div>` : `<div style="height:12px;"></div>`}
            <div style="width:100%;flex:1;display:flex;align-items:flex-end;position:relative;">
                <div style="width:100%;height:${barH}px;background:${barColor};border-radius:4px 4px 2px 2px;transition:height .4s cubic-bezier(.4,0,.2,1);min-height:${d.sales>0?'3px':'0'};box-shadow:${isToday?'0 0 8px rgba(239,68,68,.5)':'none'};display:flex;align-items:flex-start;justify-content:center;">
                    ${labelInside ? `<span style="font-size:8px;font-weight:700;color:rgba(255,255,255,.9);margin-top:3px;line-height:1;writing-mode:vertical-rl;transform:rotate(180deg);">${amtLabel}</span>` : ''}
                </div>
            </div>
            <div style="font-size:10px;font-weight:${isToday?'900':'700'};color:${isToday?'#fca5a5':'rgba(248,113,113,.75)'};line-height:1.2;margin-top:1px;">${d.day}</div>
            <div style="font-size:9px;color:rgba(248,113,113,.55);line-height:1;">${d.label}</div>
        </div>`;
    }).join('');
}



let _unpaidAgeFilter = 'all'; // 'all' | '0' | '30' | '60' | '90'

function setUnpaidAgeFilter(age, btn) {
    _unpaidAgeFilter = age;
    document.querySelectorAll('.unpaid-age-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderUnpaid();
}

function renderUnpaid() {
    const today = todayKST();

    // ── 거래처별 미수금 집계 ──
    const clientMap = {};
    orders.forEach(o => {
        if (o.isPaid) return;
        // ★ 주문별로 0 이상 자르지 않고 그대로(음수 가능) 합산 → 반품/회수가 같은
        //   거래처의 다른 미수금을 정확히 상쇄. 최종 amt는 아래에서 0 이상만 노출.
        const remain = o.total - (o.paidAmount || 0);
        if (remain === 0) return;
        const key = o.clientId || o.clientName;
        if (!clientMap[key]) clientMap[key] = {
            name: o.clientName || '(없음)', amt: 0, orders: [], oldestDate: o.date, phone: '', clientId: o.clientId
        };
        clientMap[key].amt += remain;
        clientMap[key].orders.push({ ...o, _remain: remain });
        if (o.date < clientMap[key].oldestDate) clientMap[key].oldestDate = o.date;
    });
    // 연락처 보충
    clients.forEach(cl => {
        const m = clientMap[cl.id] || clientMap[cl.name];
        if (m && cl.phone) m.phone = cl.phone;
    });

    const all = Object.values(clientMap).filter(x => x.amt > 0 &&
        (window._unpaidGroupFilterActive ? window._unpaidGroupFilterActive.has(x.name) : true));

    // 요약 통계
    const totalAmt = all.reduce((s, x) => s + x.amt, 0);
    const totalOrders = all.reduce((s, x) => s + x.orders.length, 0);
    const elTot = document.getElementById('upTotalAmt');
    const elCnt = document.getElementById('upClientCount');
    const elOrd = document.getElementById('upOrderCount');
    if (elTot) elTot.textContent = fmt(totalAmt) + '원';
    if (elCnt) elCnt.textContent = all.length + '곳';
    if (elOrd) elOrd.textContent = totalOrders + '건';

    // 경과일 필터
    const filtered = all.filter(u => {
        const days = Math.floor((new Date(today) - new Date(u.oldestDate)) / 86400000);
        if (_unpaidAgeFilter === 'all') return true;
        if (_unpaidAgeFilter === '0')  return days < 30;
        if (_unpaidAgeFilter === '30') return days >= 30 && days < 60;
        if (_unpaidAgeFilter === '60') return days >= 60 && days < 90;
        if (_unpaidAgeFilter === '90') return days >= 90;
        return true;
    }).sort((a, b) => {
        // 오래된 순 → 금액 순
        const da = Math.floor((new Date(today) - new Date(a.oldestDate)) / 86400000);
        const db = Math.floor((new Date(today) - new Date(b.oldestDate)) / 86400000);
        return db - da || b.amt - a.amt;
    });

    const el = document.getElementById('unpaidClientList');
    if (!el) return;

    if (!filtered.length) {
        el.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">해당 조건의 미수금이 없습니다</div></div>';
        return;
    }

    el.innerHTML = filtered.map(u => {
        const days = Math.floor((new Date(today) - new Date(u.oldestDate)) / 86400000);
        const ageCls = days >= 90 ? 'age-severe' : days >= 60 ? 'age-danger' : days >= 30 ? 'age-warn' : 'age-ok';
        const badgeCls = days >= 90 ? 'severe' : days >= 60 ? 'danger' : days >= 30 ? 'warn' : '';
        const ageLabel = days >= 90 ? `🚨 최장 ${days}일 경과` : days >= 60 ? `🔴 최장 ${days}일 경과` : days >= 30 ? `🟠 최장 ${days}일 경과` : `🟢 최장 ${days}일 경과`;
        const curMonth = today.slice(0, 7);
        const sortedOrders = [...u.orders].sort((a, b) => (a.date||"").localeCompare(b.date||""));
        const orderRows = sortedOrders.slice(0, 4).map(o => {
            const d = Math.floor((new Date(today) - new Date(o.date)) / 86400000);
            const dCls = d >= 90 ? 'severe' : d >= 60 ? 'danger' : d >= 30 ? 'warn' : '';
            const isCredit = o._remain < 0;
            const amtColor = isCredit ? 'var(--green)' : 'var(--red)';
            const tag = isCredit ? '<small style="color:var(--green);font-size:9px;"> ↩반품/회수</small>'
                : (o.paidAmount>0 ? '<small style="color:#60a5fa;font-size:9px;"> 부분수금</small>' : '');
            return `<div class="unpaid-card-order-row">
                <span style="font-size:11px;color:var(--text2);">${o.date} <span class="dash-unpaid-days ${dCls}">(${d}일)</span></span>
                <span style="font-size:12px;font-weight:700;color:${amtColor};">${fmt(o._remain)}원${tag}</span>
            </div>`;
        }).join('');
        const moreCount = sortedOrders.length - 4;
        const smsBody = encodeURIComponent(`[미수금 안내]\n${u.name}님 미수금 ${fmt(u.amt)}원이 있습니다. 확인 부탁드립니다.`);
        const safeClientName = escapeAttr(u.name);
        return `<div class="unpaid-client-card ${ageCls}">
            <div class="unpaid-card-top">
                <div>
                    <div class="unpaid-card-name">${escapeHtml(u.name)}</div>
                    <div style="margin-top:3px;"><span class="unpaid-age-badge ${badgeCls}">${ageLabel}</span></div>
                </div>
                <div class="unpaid-card-amt">${fmt(u.amt)}원</div>
            </div>
            <div class="unpaid-card-meta">${u.phone ? `📞 ${escapeHtml(u.phone)}` : '연락처 없음'} · 미수 ${u.orders.length}건</div>
            <div class="unpaid-card-orders">
                ${orderRows}
                ${moreCount > 0 ? `<div style="font-size:10px;color:var(--text3);padding-top:4px;">외 ${moreCount}건 더 있음</div>` : ''}
            </div>
            <div class="unpaid-card-actions">
                ${u.phone ? `<a href="tel:${escapeHtml(u.phone)}">📞 전화</a>` : ''}
                ${u.phone ? `<a href="sms:${escapeHtml(u.phone)}?body=${smsBody}" class="btn-sms">💬 문자</a>` : ''}
                <button onclick="showClientStatement('${safeClientName}','${escapeAttr(curMonth)}')" style="background:var(--surf3);color:var(--text2);">📋 명세표</button>
                <button class="btn-pay" onclick="openPartialPay('${safeClientName}','${escapeAttr(curMonth)}')">💳 입금처리</button>
            </div>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
//  재고 관리
// ═══════════════════════════════════════════════════════════

// 재고 아이템 정규화 (Firebase 수신·초기 로드 공통)

// ─── 스파크라인 SVG 생성 ───

function makeSparkline(values, color, width, height) {
    if (!values || values.length < 2) return '';
    const max = Math.max(...values, 1);
    const pts = values.map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - (v / max) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>
        <polyline points="0,${height} ${pts} ${width},${height}" fill="${color}" fill-opacity=".12" stroke="none"/>
    </svg>`;
}

// 최근 7일 데이터 계산

function getLast7DaysData(type) {
    const today = todayKST();
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = kstAddDays(today, -i);
        days.push(d);
    }
    return days.map(d => {
        const dayOrders = orders.filter(o => o.date === d);
        const _et = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
        if (type === 'sales') return dayOrders.reduce((s, o) => s + _et(o), 0);
        if (type === 'paid')  return dayOrders.reduce((s, o) => s + _actualPaid(o), 0);
        if (type === 'unpaid') return dayOrders.filter(o => !o.isPaid).reduce((s, o) => s + o.total, 0);
        return 0;
    });
}

function renderSparklines() {
    const W = 80, H = 28;
    const setSparkline = (id, vals, color) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = makeSparkline(vals, color, W, H);
    };
    setSparkline('sparkSales',  getLast7DaysData('sales'),  '#a39fff');
    setSparkline('sparkUnpaid', getLast7DaysData('unpaid'), '#fb7185');
}

// ─── 정산 바차트 ───

function renderSettleBarChart(monthKey) {
    const el = document.getElementById('settleBarChart');
    if (!el) return;
    // 최근 6개월 데이터 (문자열 연산으로 UTC 오프셋 버그 방지)
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const [baseY, baseM] = monthKey.split('-').map(Number);
        let m = baseM - i, y = baseY;
        while (m <= 0) { m += 12; y--; }
        while (m > 12) { m -= 12; y++; }
        const ym = `${y}-${String(m).padStart(2,'0')}`;
        const mos = orders.filter(o => o.date?.startsWith(ym) && !o.delegatedBy);
        const _et  = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
        const total = mos.reduce((s, o) => s + _et(o), 0);
        const paid  = mos.reduce((s, o) => s + _actualPaid(o), 0);
        const unpaid = total - paid;
        months.push({ label: ym.slice(5) + '월', total, paid, unpaid });
    }
    const maxVal = Math.max(...months.map(m => m.total), 1);
    const bars = months.map(m => {
        const h = Math.round((m.total / maxVal) * 80);
        const hasUnpaid = m.unpaid > 0;
        return `<div class="bar-col">
            <div class="bar-val">${m.total > 0 ? (m.total >= 1000000 ? (m.total/1000000).toFixed(1)+'M' : (m.total/1000).toFixed(0)+'K') : ''}</div>
            <div class="bar-fill${hasUnpaid ? ' has-unpaid' : ''}" style="height:${h}px" title="${m.label}: ${fmt(m.total)}원"></div>
            <div class="bar-label">${m.label}</div>
        </div>`;
    }).join('');
    el.innerHTML = `<div class="settle-chart-wrap">
        <div class="settle-chart-title">최근 6개월 매출</div>
        <div class="bar-chart">${bars}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:8px;">■ <span style="color:var(--accent);">완납</span> &nbsp; ■ <span style="color:var(--red);">미수포함</span></div>
    </div>`;
}

// ─── 카운트업 애니메이션 ───

function animateCount(el, target) {
    if (!el) return;
    const duration = 400;
    const start = Date.now();
    const startVal = 0;
    el.classList.remove('animated');
    void el.offsetWidth; // reflow
    el.classList.add('animated');
    const tick = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const val = Math.round(startVal + (target - startVal) * ease);
        el.textContent = val.toLocaleString('ko-KR');
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = target.toLocaleString('ko-KR');
    };
    requestAnimationFrame(tick);
}

