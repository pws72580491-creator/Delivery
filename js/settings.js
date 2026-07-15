// ╔══════════════════════════════════════════════════════════════╗
// ║  § 13  설정                                                     ║
// ╚══════════════════════════════════════════════════════════════╝

function updateStorageBar() {
    try {
        // 전체 localStorage 키 합산
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const v   = localStorage.getItem(key);
            if (v) total += (key.length + v.length) * 2;
        }
        // 저장 예정 크기 (경량화 기준)
        const hasWorkspace = !!(localStorage.getItem('workspaceId'));
        const useLightMode = isConnected || hasWorkspace;
        const pendingSize = (
            JSON.stringify(clients).length +
            JSON.stringify(useLightMode ? _getLightOrders() : orders).length +
            JSON.stringify(prices).length +
            JSON.stringify(useLightMode ? _getLightStock() : stockItems).length
        ) * 2;

        // content:// 환경에서는 한도가 10MB일 수 있음 → 동적 감지
        const limitBytes = total > 5 * 1024 * 1024 ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
        const limitKB    = Math.round(limitBytes / 1024);
        const pct        = Math.min(100, (total / limitBytes) * 100);
        const kb         = (total / 1024).toFixed(1);
        const pendKB     = (pendingSize / 1024).toFixed(1);
        const label      = document.getElementById('storageUsedLabel');
        const bar        = document.getElementById('storageBar');
        if (label) label.textContent = `${kb} KB (저장예정 ${pendKB} KB) / ~${limitKB} KB`;
        if (bar) {
            bar.style.width = pct + '%';
            bar.style.background = pct > 85 ? 'linear-gradient(90deg,#ef4444,#f87171)'
                                 : pct > 60  ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                                 :              'linear-gradient(90deg,#22c55e,#6c63ff)';
        }
        // 80% 초과 시 긴급 정리 버튼 자동 표시
        const emergRow = document.getElementById('emergencyCleanRow');
        if (emergRow) emergRow.style.display = pct > 80 ? 'flex' : 'none';
    } catch(e) {}
}

// ─── 🚨 긴급 localStorage 정리 (한도 초과 시) ───

async function emergencyCleanStorage() {
    if (!await customConfirm('⚠️ 로컬 저장 데이터를 모두 지우고 경량 재저장합니다.\n\nFirebase에 연결되어 있으면 데이터가 안전하게 유지됩니다.\n계속하시겠습니까?')) return;
    try {
        // 앱 데이터 키 삭제 (설정 키는 유지)
        ['p_clients','p_orders','prices','p_stock'].forEach(k => localStorage.removeItem(k));
        // 경량 재저장
        localStorage.setItem('p_clients', JSON.stringify(clients.map(_minifyClient)));
        localStorage.setItem('p_orders',  JSON.stringify(_getLightOrders()));
        localStorage.setItem('prices',    JSON.stringify(prices));
        localStorage.setItem('p_stock',   JSON.stringify(_getLightStock()));
        updateStorageBar();
        toast('✅ 긴급 정리 완료! 저장공간이 확보되었습니다.', 'var(--green)');
    } catch(e) {
        // 그래도 실패하면 설정 외 전체 클리어
        try {
            const keep = {};
            ['workspaceId','wsLocked','theme','stockAutoDeduct','backupDay1','backupDay2','lastAutoBackupDate','lastBackupDate']
                .forEach(k => { const v = localStorage.getItem(k); if (v) keep[k] = v; });
            localStorage.clear();
            Object.entries(keep).forEach(([k,v]) => localStorage.setItem(k, v));
            localStorage.setItem('p_clients', JSON.stringify(clients.map(_minifyClient)));
            localStorage.setItem('p_orders',  JSON.stringify(_getLightOrders()));
            localStorage.setItem('prices',    JSON.stringify(prices));
            localStorage.setItem('p_stock',   JSON.stringify(_getLightStock()));
            updateStorageBar();
            toast('✅ 전체 초기화 후 재저장 완료.', 'var(--green)');
        } catch(e2) {
            toast('❗ 정리 실패. 브라우저 캐시를 직접 삭제해 주세요.', 'var(--red)');
        }
    }
}

// ─── ① 즉각 해결: 재고 이력 품목당 10개로 정리 ───

function trimStockLog() {
    if (!stockItems.length) return toast('재고 품목이 없습니다');
    let trimmed = 0;
    stockItems.forEach(si => {
        if (!Array.isArray(si.log)) return;
        const before = si.log.length;
        si.log = _trimLogByDate(si.log);  // 어제·오늘 이력만 유지
        trimmed += Math.max(0, before - si.log.length);
    });
    saveData();
    updateStorageBar();
    toast(`✅ 재고 이력 ${trimmed}건 삭제 완료! 공간이 확보되었습니다`, 'var(--green)');
}

// ─── ② 오래된 전표 자동 정리 ───

async function trimOldOrders() {
    const months = parseInt(document.getElementById('autoTrimMonths').value) || 6;
    const cutoff = _kstMonthsAgo(months);
    const targets = orders.filter(o => o.isPaid && o.date < cutoff);
    if (!targets.length) return toast(`✅ ${months}개월 이상 된 완납 전표가 없습니다`);
    if (!await customConfirm(`완납된 전표 중 ${months}개월 이상 된 ${targets.length}건을 삭제합니다.\n(미수금 전표는 보존됩니다)\n\n삭제 전 JSON 백업을 권장합니다.`)) return;
    orders = orders.filter(o => !(o.isPaid && o.date < cutoff));
    invalidateOrdersCache();
    saveData();
    _fullRender();
    updateStorageBar();
    toast(`🗂️ 오래된 전표 ${targets.length}건 삭제 완료`, 'var(--green)');
}

function updateInfoCounts() {
    document.getElementById('infoClients').textContent = clients.length;
    document.getElementById('infoOrders').textContent  = orders.length;
    const el_all    = document.getElementById('sCountAll');
    const el_low    = document.getElementById('sCountLow');
    const el_danger = document.getElementById('sCountDanger');
    if (el_all)    el_all.textContent    = stockItems.length;
    if (el_low)    el_low.textContent    = stockItems.filter(s=>s.qty>s.danger&&s.qty<=s.low).length;
    if (el_danger) el_danger.textContent = stockItems.filter(s=>s.qty<=s.danger).length;
}

// ─── Excel 내보내기 ───

function exportHistoryExcel() {
    if (!orders.length) return toast('❗ 내보낼 데이터가 없습니다');
    const rows = [...orders].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).flatMap(o => {
        if ((o.items||[]).length === 0) {
            return [{ 날짜: o.date, 거래처: o.clientName, 품목: '(오프라인 저장 — 품목 상세 없음)', 수량: '-', 단가: '-', 금액: o.total, 합계: o.total, 납품상태: o.isPaid?'완납':'미수', 타인거래: o.isVoid?'Y':'', 반품회수: o.isReturn?'Y':'', 메모: o.note||'' }];
        }
        return (o.items||[]).map(it => ({
            날짜: o.date, 거래처: o.clientName, 품목: it.name,
            수량: it.qty, 단가: it.price, 금액: it.qty*it.price,
            합계: o.total, 납품상태: o.isPaid?'완납':'미수', 타인거래: o.isVoid?'Y':'', 반품회수: o.isReturn?'Y':'',
            수금방법: o.paidMethod==='transfer'?'계좌이체':o.paidMethod==='other'?'기타':o.paidAmount>0?'현금':'',
            메모: o.note||''
        }));
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '납품내역');
    XLSX.writeFile(wb, `납품내역_${todayKST()}.xlsx`);
    toast('📥 Excel 다운로드 완료', 'var(--green)');
}

function exportSettlementExcel() {
    if (settleUnit === 'daily') {
        const date = document.getElementById('settlementDateDaily').value;
        if (!date) return toast('❗ 날짜를 선택하세요');
        const filtered = applyPayFilter(orders.filter(o=>o.date===date));
        if (!filtered.length) return toast('❗ 해당 날짜 데이터가 없습니다');
        const rows = filtered.map(o=>({ 날짜:o.date, 거래처:o.clientName, 품목:(o.items||[]).map(i=>`${i.name}(${Math.abs(i.qty)})`).join(','), 금액:o.total, 수금상태:o.isReturn?'반품/회수':(o.isPaid?'완납':'미수'), 수금방법:o.paidMethod==='transfer'?'계좌이체':o.paidMethod==='other'?'기타':'현금', 메모:o.note||'' }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '일별정산');
        XLSX.writeFile(wb, `일별정산서_${date}.xlsx`);
        return toast('📥 일별 정산서 다운로드 완료', 'var(--green)');
    }
    if (settleUnit === 'quarterly') {
        const year = document.getElementById('settlementYear').value;
        if (!year) return toast('❗ 연도를 선택하세요');
        const filtered = applyPayFilter(orders.filter(o=>o.date?.startsWith(String(year))));
        if (!filtered.length) return toast('❗ 해당 연도 데이터가 없습니다');
        const qMap = { '1분기':{매출:0,수금:0,건수:0}, '2분기':{매출:0,수금:0,건수:0}, '3분기':{매출:0,수금:0,건수:0}, '4분기':{매출:0,수금:0,건수:0} };
        // ★ v123 fix: 할인 완납 전표는 실청구액(total-discount)으로 집계 — 원래 raw total을 그대로 더해
        // '미수'(매출-수금) 컬럼에 할인분이 남은 미수처럼 잘못 표시되던 문제 (renderSettlement와 동일 원인)
        const _etQ = o => o.isPaid && o.discount > 0 ? o.total - o.discount : o.total;
        filtered.forEach(o => {
            const m = parseInt(o.date.slice(5,7));
            const q = m<=3?'1분기':m<=6?'2분기':m<=9?'3분기':'4분기';
            qMap[q].매출 += _etQ(o);
            qMap[q].수금 += _actualPaid(o);
            qMap[q].건수++;
        });
        const rows = Object.entries(qMap).map(([q,v])=>({ 분기:q, 건수:v.건수, 매출:v.매출, 수금:v.수금, 미수:v.매출-v.수금 }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '분기별정산');
        XLSX.writeFile(wb, `분기별정산서_${year}.xlsx`);
        return toast('📥 분기별 정산서 다운로드 완료', 'var(--green)');
    }
    // 기본 월별
    const month = document.getElementById('settlementMonth').value;
    if (!month) return toast('❗ 정산 월을 선택하세요');
    const filtered = applyPayFilter(orders.filter(o=>o.date?.startsWith(month)));
    if (!filtered.length) return toast('❗ 해당 월 데이터가 없습니다');
    const rows = filtered.map(o=>({ 날짜:o.date, 거래처:o.clientName, 품목:(o.items||[]).map(i=>`${i.name}(${Math.abs(i.qty)})`).join(','), 금액:o.total, 수금상태:o.isReturn?'반품/회수':(o.isPaid?'완납':'미수'), 수금방법:o.paidMethod==='transfer'?'계좌이체':o.paidMethod==='other'?'기타':'현금', 메모:o.note||'' }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '정산');
    XLSX.writeFile(wb, `정산서_${month}.xlsx`);
    toast('📥 정산서 다운로드 완료', 'var(--green)');
}

function exportJSON() {
    const data = { clients, orders, prices, stockItems, exportDate:new Date().toISOString(), version:'95' };
    const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`delivery_backup_${todayKST()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    toast('📥 JSON 백업 완료', 'var(--green)');
}

function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10*1024*1024) return toast('❗ 파일이 너무 큽니다 (최대 10MB)');
    const reader = new FileReader();
    reader.onload = async ev => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!data || typeof data!=='object') throw new Error('올바른 JSON 형식이 아닙니다');
            // clients/orders 필드 존재 여부 확인 (toArray는 항상 배열 반환)
            if (!data.clients && !data.orders) throw new Error('clients/orders 필드가 없습니다');
            const imp_clients = toArray(data.clients);
            const imp_orders  = toArray(data.orders);
            if (!await customConfirm(`가져올 데이터:\n거래처 ${imp_clients.length}개 · 전표 ${imp_orders.length}건\n\n기존 데이터를 덮어씌웁니다. 계속하시겠습니까?`, '가져오기', 'btn-primary')) { e.target.value=''; return; }
            if (clients.length||orders.length) {
                try { await runBackupCloudOnly('가져오기전'); } catch(err) {
                    if (!await customConfirm('백업 실패. 백업 없이 계속하시겠습니까?')) { e.target.value=''; return; }
                }
            }
            // ── 공통 정규화 함수로 처리 ──
            const normalized = normalizeBackupData(data);
            clients    = normalized.clients;
            orders     = normalized.orders;
            if (data.prices)     prices     = data.prices;
            if (data.stockItems) stockItems = toArray(data.stockItems).map(normStock);
            lastHash = {clients:'',orders:'',prices:'',stock:''};
            // ★ v114: 가져오기 시 오프라인 큐 초기화 (구 데이터 잔류 방지)
            ['_sharedOrderQueue','_sharedOrderDeadQueue','_crmPatchFailQueue'].forEach(k => localStorage.removeItem(k));
            if (typeof _updateSharedQueueBadge === 'function') _updateSharedQueueBadge();
            if (typeof _updateDeadQueueBadge   === 'function') _updateDeadQueueBadge();
            saveData(); _fullRender();
            toast('✅ 가져오기 완료', 'var(--green)');
        } catch(err) { toast('❗ 가져오기 실패: '+err.message); }
        e.target.value='';
    };
    reader.onerror = ()=>{ toast('❗ 파일 읽기 오류'); e.target.value=''; };
    reader.readAsText(file);
}

// ─── 샘플 데이터 ───

function loadSample() {
    clients = [
        { id:'s1', name:'강남마트',  phone:'010-1234-5678', address:'서울 강남구', note:'', createdAt:new Date().toISOString() },
        { id:'s2', name:'서초상회',  phone:'010-9876-5432', address:'서울 서초구', note:'', createdAt:new Date().toISOString() },
        { id:'s3', name:'역삼식당',  phone:'010-5555-1234', address:'서울 강남구', note:'단골', createdAt:new Date().toISOString() },
        { id:'s4', name:'청담마켓',  phone:'', address:'서울 강남구', note:'', createdAt:new Date().toISOString() }
    ];
    prices = { 두부:1500, 콩나물:800, 계란:250, 감자:2000 };
    const ym = todayKST().slice(0,7);
    orders = [
        { id:'o1', clientId:'s1', clientName:'강남마트', date:`${ym}-01`, items:[{name:'두부',qty:10,price:1500,total:15000},{name:'콩나물',qty:5,price:800,total:4000}], total:19000, isPaid:true,  note:'', createdAt:new Date().toISOString() },
        { id:'o2', clientId:'s2', clientName:'서초상회', date:`${ym}-03`, items:[{name:'계란',qty:30,price:250,total:7500}], total:7500, isPaid:false, note:'', createdAt:new Date().toISOString() },
        { id:'o3', clientId:'s3', clientName:'역삼식당', date:`${ym}-07`, items:[{name:'감자',qty:20,price:2000,total:40000},{name:'두부',qty:5,price:1500,total:7500}], total:47500, isPaid:true,  note:'급행', createdAt:new Date().toISOString() },
        { id:'o4', clientId:'s1', clientName:'강남마트', date:`${ym}-10`, items:[{name:'콩나물',qty:15,price:800,total:12000}], total:12000, isPaid:false, note:'', createdAt:new Date().toISOString() },
    ];
    lastHash = {clients:'',orders:'',prices:'',stock:''};
    saveData(); _fullRender();
    toast('🎉 샘플 데이터 생성 완료', 'var(--green)');
}

async function resetAllData() {
    const total = clients.length + orders.length;
    if (!total) return toast('❗ 삭제할 데이터가 없습니다');
    if (!await customConfirm(`거래처 ${clients.length}개 · 전표 ${orders.length}건을 모두 삭제합니다.\n이 작업은 되돌릴 수 없습니다!`)) return;
    if (!await customConfirm('마지막 확인입니다. 삭제 전 백업이 실행됩니다. 계속하시겠습니까?', '백업 후 삭제')) return;
    try { await runBackup('전체초기화전',false); } catch(e) {
        if (!await customConfirm('백업 실패. 백업 없이 삭제하시겠습니까?')) return;
    }
    clients=[]; orders=[]; prices={}; stockItems=[];
    localStorage.removeItem('p_stock');
    // ★ v114: 초기화 시 오프라인 큐도 제거
    ['_sharedOrderQueue','_sharedOrderDeadQueue','_crmPatchFailQueue'].forEach(k => localStorage.removeItem(k));
    if (typeof _updateSharedQueueBadge === 'function') _updateSharedQueueBadge();
    if (typeof _updateDeadQueueBadge   === 'function') _updateDeadQueueBadge();
    lastHash={clients:'',orders:'',prices:'',stock:''};
    saveData(); _fullRender();
    toast('🗑️ 초기화 완료');
}

// ─── 동기화 진단 로그 (v108) ───

function openDiagLogModal() {
    const el = document.getElementById('diagLogText');
    if (el) el.textContent = diagLogText();
    openModal('diagLogModal');
}

async function copyDiagLog() {
    const text = diagLogText();
    try {
        await navigator.clipboard.writeText(text);
        toast('📋 진단 로그가 복사됐습니다', 'var(--accent)', 2500);
    } catch(e) {
        // 구형 브라우저 폴백
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('📋 진단 로그가 복사됐습니다', 'var(--accent)', 2500); }
        catch(e2) { toast('❗ 복사 실패 — 직접 길게 눌러 선택해주세요', 'var(--red)'); }
        document.body.removeChild(ta);
    }
}

async function confirmClearDiagLog() {
    if (!await customConfirm('진단 로그 기록을 모두 지웁니다. 계속하시겠습니까?')) return;
    diagLogClear();
    const el = document.getElementById('diagLogText');
    if (el) el.textContent = diagLogText();
    toast('🗑️ 진단 로그를 지웠습니다');
}

