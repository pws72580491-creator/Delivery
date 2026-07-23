// ╔══════════════════════════════════════════════════════════════╗
// ║  § 7  납품 등록                                                  ║
// ╚══════════════════════════════════════════════════════════════╝

function normItemName(n) {
    return (n||'').trim().replace(/\s+/g,' ').toLowerCase();
}

function findStockByName(name) {
    const key = normItemName(name);
    return stockItems.find(s => normItemName(s.name) === key);
}

// ─── 납품 등록 ───

// ── 재고 재계산 (수동 실행 전용 — 재고 탭 🔄 버튼에서 호출)
// 오늘 납품 전표 기준으로 출고 누락된 품목을 보완. 자동 차감 ON 시에만 동작.
function recalcStockFromOrders(silent = false) {
    if (!stockAutoDeduct) return 0;
    let fixedCount = 0;
    const today = todayKST();
    orders.forEach(o => {
        // ★ 오늘 전표만 대상 — 재고 로그가 어제·오늘만 보관되므로(중복방지 체크 한계),
        //   날짜 필터가 없으면 과거 전표가 매번 다시 차감되는 심각한 버그가 됨
        if (o.date !== today) return;
        // ★ delegatedBy(대납 전표)는 남(B)이 자기 재고로 배송한 거래 — 내(A) 재고와 무관하므로 재계산 대상에서 제외
        if (o.isVoid || o.delegatedBy || !(o.items||[]).length) return;
        o.items.forEach(it => {
            const si = findStockByName(it.name);
            if (!si) return;
            const qtyNum = Number(it.qty) || 0;
            const deltaQty = -qtyNum; // 실제 적용될 재고 변화량 (일반 납품: 음수 차감 / 반품·회수: 양수 입고)
            // ★ 반품/회수 품목은 qty가 음수로 저장되므로, 이미 반영됐는지 확인할 때도
            //   부호를 그대로 비교해야 한다 (Math.abs로 비교하면 항상 불일치 → 매번 재적용되는 버그였음).
            //   type도 'auto'(일반 차감)뿐 아니라 'in'(반품/회수 입고 — 등록 시점에 기록됨)도 함께 인정해야
            //   정상 등록된 반품 전표를 재계산 버튼으로 또 적용해 중복 반영하는 것을 막을 수 있다.
            const alreadyLogged = (si.log || []).some(l =>
                (l.type === 'auto' || l.type === 'in') &&
                l.date === o.date &&
                l.reason && l.reason.includes(o.clientName) &&
                l.qty === deltaQty
            );
            if (alreadyLogged) return;
            const before = si.qty;
            si.qty = Math.max(0, si.qty + deltaQty);
            (si.log = si.log || []).push({
                type: deltaQty >= 0 ? 'in' : 'auto', qty: si.qty - before, before, after: si.qty,
                reason: (deltaQty >= 0 ? '반품/회수 입고(' : '납품차감(') + o.clientName + ') [재계산]',
                date: o.date, at: new Date().toISOString()
            });
            si.log = _trimLogByDate(si.log);
            fixedCount++;
        });
    });
    if (fixedCount > 0) {
        if (silent) {
            saveToLocal();
        } else {
            saveData();
            _markDirty('stock');
            _refreshStockIfActive();
            toast(`🔄 재고 재계산 완료 — ${fixedCount}건 출고 반영`, 'var(--green)');
        }
    }
    return fixedCount;
}

function searchDeliveryClient(q) {
    const drop = document.getElementById('clientDropdown');
    if (!q) { drop.classList.remove('open'); return; }

    const myList = clients.filter(c => matchSearch(c.name, q));
    const myNames = new Set(clients.map(c => c.name));
    const sharedList = _sharedClientsFromWs.filter(s =>
        matchSearch(s.name, q) && !myNames.has(s.name)
    );

    if (!myList.length && !sharedList.length) { drop.classList.remove('open'); return; }

    let html = myList.map(c =>
        `<div class="dropdown-item" onclick="pickDeliveryClient('${escapeAttr(c.id)}','${escapeAttr(c.name)}',null,null)">
            ${escapeHtml(c.name)}${c.phone ? ` (${escapeHtml(c.phone)})` : ''}
        </div>`).join('');

    if (sharedList.length) {
        html += `<div class="dropdown-section-label">📦 공유 거래처 <span style="font-size:10px;color:var(--text2);font-weight:400;">— 등록 없이 바로 납품·수정 가능</span></div>`;
        html += sharedList.map(s =>
            `<div class="dropdown-item dropdown-item-shared" onclick="pickDeliveryClient('__shared__','${escapeAttr(s.name)}','${escapeAttr(s.wsId)}','${escapeAttr(s.wsLabel)}')">
                ${escapeHtml(s.name)}
                <span class="shared-ws-badge">${escapeHtml(s.wsLabel)}</span>
            </div>`).join('');
    }

    drop.innerHTML = html;
    drop.classList.add('open');
}

function pickDeliveryClient(id, name, sharedWsId, sharedWsLabel) {
    // ── 공유 거래처 선택 시: clients에 추가하지 않고 가상 ID로 처리 ──
    // 가상 ID 형식: "__shared__:워크스페이스ID:거래처명"
    if (id === '__shared__') {
        // ★ Fix: 공유 거래처를 명시적으로 선택한 경우 B의 clients에 같은 이름이 있어도
        //   가상 ID(__shared__:wsId:name)를 유지 — 그렇지 않으면 B 자신의 Firebase에
        //   저장되어 A에게 반영되지 않는 문제 발생
        id = `__shared__:${sharedWsId}:${name}`;
    }

    document.getElementById('selectedClientId').value = id;
    document.getElementById('deliveryClient').value   = name;
    document.getElementById('clientDropdown').classList.remove('open');
    // 미수금 표시 (공유 거래처는 공유 캐시에서 집계)
    const hint = document.getElementById('clientUnpaidHint');
    if (hint) {
        hint.style.color = '';
        let unpaidOrders, unpaidAmt;
        if (id.startsWith('__shared__:')) {
            // 공유 캐시 + 내 orders 합산 미수금
            const fromShared = _sharedOrdersCache.filter(o => o.clientName === name && !o.isPaid);
            const fromMine   = orders.filter(o => o.clientName === name && !o.isPaid);
            unpaidOrders = [...fromShared, ...fromMine];
        } else {
            unpaidOrders = orders.filter(o => o.clientId === id && !o.isPaid);
        }
        unpaidAmt = unpaidOrders.reduce((s,o)=>s+o.total-(o.paidAmount||0), 0);
        if (unpaidAmt > 0) {
            hint.textContent = `💸 현재 미수금: ${fmt(unpaidAmt)}원 (${unpaidOrders.length}건)`;
            hint.classList.add('visible');
        } else {
            hint.textContent = '';
            hint.classList.remove('visible');
        }
    }
    showClientItemSuggestions(id);
    updateItemDatalist(id);
}

function updateItemDatalist(clientId) {
    // clientId 인자 우선; 미전달 시 DOM에서 읽기 (동기화 콜백은 '' 전달)
    if (clientId === undefined) clientId = document.getElementById('selectedClientId')?.value || '';
    const allNames = _buildItemNamesCache();
    let names;
    if (clientId) {
        const cache = _buildClientItemsCache();
        const clientNames = (cache[clientId] || []).map(it => it.name);
        const clientSet   = new Set(clientNames);
        const otherNames  = allNames.filter(n => !clientSet.has(n));
        names = [...clientNames.sort(), ...otherNames];
    } else {
        names = allNames;
    }
    const el = document.getElementById('itemDatalist');
    if (el) el.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}">`).join('');
}

// 최근 단가 캐시 빌더 (품목명 → 최근 단가 배열)

function _buildRecentPricesCache() {
    if (_recentPricesCache) return _recentPricesCache;
    const cache = {}; // name → [price, ...]  (최신 납품일 순, 중복 제거, 최대 4개)
    const sorted = [...orders].sort((a, b) => (b.date||"").localeCompare(a.date||""));
    for (const o of sorted) {
        for (const it of (o.items || [])) {
            if (!it.name || it.price <= 0) continue;
            if (!cache[it.name]) cache[it.name] = [];
            if (!cache[it.name].includes(it.price)) {
                cache[it.name].push(it.price);
            }
        }
    }
    _recentPricesCache = cache;
    return cache;
}

function getRecentPrices(name) {
    const cache = _buildRecentPricesCache();
    const matched = (cache[name] || []).slice(0, 4);
    // prices 단가 캐시에 있고 목록에 없으면 추가
    if (prices[name] && !matched.includes(prices[name])) matched.push(prices[name]);
    return matched.slice(0, 4);
}

// 거래처별 최근 품목+단가 (최근 납품일 순, 중복 품목명 제거) — 캐시 활용

function getClientRecentItems(clientId, limit=30) {
    if (!clientId) return [];
    const cache = _buildClientItemsCache();
    const list  = cache[clientId] || [];
    return limit >= list.length ? list : list.slice(0, limit);
}

function showClientItemSuggestions(clientId) {
    const box   = document.getElementById('clientItemSuggest');
    const chips = document.getElementById('cisChips');
    if (!box || !chips) return;
    const items = getClientRecentItems(clientId);
    if (!items.length) { box.classList.remove('visible'); return; }
    chips.innerHTML = items.map(it => {
        const priceLabel = it.price > 0 ? `${fmt(it.price)}원` : '단가미정';
        const safeItName = escapeAttr(it.name);
        return `<button class="cis-chip" onclick="fillItemFromSuggest('${safeItName}',${Number(it.price)||0})" title="${escapeHtml(it.date)} 납품">
            <span class="cis-chip-name">${escapeHtml(it.name)}</span>
            <span class="cis-chip-price">${priceLabel}</span>
        </button>`;
    }).join('');
    box.classList.add('visible');
}

function fillItemFromSuggest(name, price) {
    document.getElementById('itemName').value  = name;
    if (price > 0) _setMoneyVal('itemPrice', price); else document.getElementById('itemPrice').value = '';
    onItemNameInput(name);
    // 수량 입력란으로 포커스 + 화면 스크롤
    const qtyEl = document.getElementById('itemQty');
    qtyEl.focus();
    setTimeout(() => {
        qtyEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

function onItemNameInput(name) {
    const hint     = document.getElementById('priceHint');
    const clientId = document.getElementById('selectedClientId').value;
    if (!name) { hint.textContent=''; return; }
    // 거래처별 최근 단가 우선
    if (clientId) {
        const clientItem = getClientRecentItems(clientId).find(it => normItemName(it.name) === normItemName(name));
        if (clientItem && clientItem.price > 0) {
            hint.innerHTML = `<span style="color:var(--accent);font-weight:700;">이 거래처 최근 단가: ${fmt(clientItem.price)}원</span>`;
            return;
        }
    }
    const recent = getRecentPrices(name);
    hint.textContent = recent.length ? `최근 단가: ${recent.map(p=>fmt(p)+'원').join(' / ')}` : '';
}

function autoFillPrice(el) {
    if (el.value !== '') return;
    const name     = document.getElementById('itemName').value.trim();
    const clientId = document.getElementById('selectedClientId').value;
    if (!name) return;
    // 거래처별 최근 단가 우선
    if (clientId) {
        const clientItem = getClientRecentItems(clientId).find(it => normItemName(it.name) === normItemName(name));
        if (clientItem && clientItem.price > 0) { _setMoneyVal('itemPrice', clientItem.price); return; }
    }
    const recent = getRecentPrices(name);
    if (recent.length > 0) _setMoneyVal('itemPrice', recent[0]);
}

function addItemToGroup() {
    const name  = document.getElementById('itemName').value.trim();
    const qty   = parseInt(document.getElementById('itemQty').value)   || 0;
    const priceRaw = document.getElementById('itemPrice').value.replace(/[^0-9]/g,'');
    const price = priceRaw === '' ? null : (parseInt(priceRaw, 10) || 0);
    const date  = document.getElementById('deliveryDate').value;
    if (!name)   return toast('❗ 품목명을 입력하세요');
    if (qty<=0)  return toast('❗ 수량을 1 이상 입력하세요');
    if (price === null) return toast('❗ 단가를 입력하세요');
    if (price < 0)      return toast('❗ 단가는 0 이상이어야 합니다');
    if (!date)   return toast('❗ 납품일자를 선택하세요');
    let group = tempGroups.find(g => g.date===date);
    if (!group) { group={date,items:[]}; tempGroups.push(group); tempGroups.sort((a,b)=>(a.date||"").localeCompare(b.date||"")); }
    group.items.push({ name, qty, price, total:qty*price });

    // ── 재고 부족 경고 (자동차감 ON이고 재고 등록된 품목일 때) ──
    if (stockAutoDeduct && !_deliveryIsVoid) {
        const si = findStockByName(name);
        if (si) {
            // tempGroups 전체에서 해당 품목 누적 수량 계산
            const totalNeeded = tempGroups.reduce((s, g) =>
                s + g.items.filter(i => normItemName(i.name) === normItemName(name))
                           .reduce((ss, i) => ss + i.qty, 0), 0);
            if (totalNeeded > si.qty) {
                toast(`⚠️ ${name} 재고 부족 — 현재 ${si.qty}${si.unit||'개'}, 필요 ${totalNeeded}${si.unit||'개'}`, 'var(--orange)', 3000);
            }
        }
    }
    document.getElementById('itemName').value  = '';
    document.getElementById('itemQty').value   = '';
    document.getElementById('itemPrice').value = '';
    document.getElementById('priceHint').textContent = '';
    renderTempGroups();
    // 키보드 내리고 화면 맨 아래로 스크롤
    document.activeElement?.blur();
    setTimeout(() => {
        const content = document.getElementById('mainContent');
        if (content) content.scrollTop = content.scrollHeight;
    }, 100);
}

function removeTempGroupItem(gi, ii) {
    tempGroups[gi].items.splice(ii,1);
    if (!tempGroups[gi].items.length) tempGroups.splice(gi,1);
    renderTempGroups();
}

async function removeTempGroup(gi) {
    if (!await customConfirm(`${tempGroups[gi].date} 날짜의 품목을 모두 삭제할까요?`)) return;
    tempGroups.splice(gi,1); renderTempGroups();
}

function renderTempGroups() {
    const grand = tempGroups.reduce((s,g)=>s+g.items.reduce((ss,i)=>ss+i.total,0),0);
    const box   = document.getElementById('tempTotalBox');
    const list  = document.getElementById('tempGroupList');
    if (!tempGroups.length) {
        list.innerHTML='';
        box.style.display='none';
        const cb = document.getElementById('deliveryConfirmBtn');
        if (cb) cb.style.display = 'none';
        return;
    }
    list.innerHTML = tempGroups.map((g,gi) => {
        const gTotal = g.items.reduce((s,i)=>s+i.total,0);
        const rows = g.items.map((it,ii) => `
            <div class="temp-item-row">
                <span><strong>${escapeHtml(it.name)}</strong> | ${escapeHtml(it.qty)}개 × ${fmt(it.price)}원</span>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span>${fmt(it.total)}원</span>
                    <button onclick="removeTempGroupItem(${gi},${ii})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;">✕</button>
                </div>
            </div>`).join('');
        return `<div class="date-group-card">
            <div class="date-group-header">
                <span class="date-group-label">📅 ${g.date}</span>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="date-group-subtotal">${fmt(gTotal)}원</span>
                    <button onclick="removeTempGroup(${gi})" style="padding:3px 8px;background:var(--red);color:#fff;border:none;border-radius:5px;font-size:11px;cursor:pointer;">날짜 삭제</button>
                </div>
            </div>
            ${rows}
        </div>`;
    }).join('');
    document.getElementById('tempTotal').textContent = fmt(grand)+'원';
    document.getElementById('tempDateCount').textContent = `${tempGroups.length}일 · ${tempGroups.reduce((s,g)=>s+g.items.length,0)}품목`;
    box.style.display = 'block';
    // 확정 버튼 동적 렌더링
    let confirmBtn = document.getElementById('deliveryConfirmBtn');
    if (!confirmBtn) {
        confirmBtn = document.createElement('button');
        confirmBtn.id = 'deliveryConfirmBtn';
        confirmBtn.className = 'btn btn-success btn-full';
        confirmBtn.onclick = openDeliveryConfirm;
        box.after(confirmBtn);
    }
    confirmBtn.innerHTML = `🚚 납품 확정 — <span style="font-family:'DM Mono',monospace;">${fmt(grand)}원</span>`;
    confirmBtn.onclick = openDeliveryConfirm;
    confirmBtn.style.display = 'block';
}

async function openDeliveryConfirm() {
    const clientId = document.getElementById('selectedClientId').value;
    if (!clientId)          return toast('❗ 거래처를 선택하세요');
    if (!tempGroups.length) return toast('❗ 품목을 추가하세요');
    // 가상 ID(__shared__:wsId:name)는 clients에 없으므로 가상 객체 생성
    let client;
    if (clientId.startsWith('__shared__:')) {
        const parts = clientId.split(':');
        // 형식: __shared__:wsId:name (wsId에 ':' 포함 가능하므로 index 2 이후 전체)
        const clientName = parts.slice(2).join(':');
        client = { id: clientId, name: clientName, _isSharedVirtual: true, _sharedWsId: parts[1] };
    } else {
        client = clients.find(c => c.id === clientId);
    }
    if (!client) return toast('❗ 거래처를 다시 선택하세요');

    // ── 재고 부족 검사 (자동차감 ON이고 타인거래 아닐 때) ──
    if (stockAutoDeduct && !_deliveryIsVoid) {
        // 품목별 총 필요 수량 집계
        const needed = {};
        tempGroups.forEach(g => {
            g.items.forEach(it => {
                const key = normItemName(it.name);
                needed[key] = (needed[key] || { name: it.name, qty: 0 });
                needed[key].qty += it.qty;
            });
        });
        const shortages = [];
        Object.values(needed).forEach(({ name, qty }) => {
            const si = findStockByName(name);
            if (si && qty > si.qty) {
                shortages.push({ name, need: qty, have: si.qty, unit: si.unit || '개' });
            }
        });
        if (shortages.length > 0) {
            const msg = shortages.map(s =>
                `· ${s.name}: 필요 ${s.need}${s.unit} / 현재 ${s.have}${s.unit} (${s.need - s.have}${s.unit} 부족)`
            ).join('\n');
            const proceed = await customConfirm(`⚠️ 재고가 부족한 품목이 있습니다.\n\n${msg}\n\n그래도 납품을 진행할까요?`, '납품 진행', 'btn-primary');
            if (!proceed) return;
        }
    }

    // 요약 정보 구성
    const dateCount = tempGroups.length;
    const itemCount = tempGroups.reduce((s, g) => s + g.items.length, 0);

    document.getElementById('deliveryConfirmSub').textContent =
        `${client.name} · ${dateCount}일 · 품목 ${itemCount}개`;

    document.getElementById('deliveryConfirmOverlay').classList.add('open');
    document.getElementById('deliveryConfirmPopup').classList.add('open');
    // 타인거래 · 반품/회수 토글 초기화
    _deliveryIsVoid = false;
    _deliveryIsReturn = false;
    _updateDeliveryVoidToggle();
    _updateDeliveryReturnToggle();
    _renderDeliveryConfirmSummary();
}

// 납품확정 팝업의 품목 요약 + 합계를 그린다. 반품/회수 토글 ON이면 모든 금액을 음수·빨간색으로 표시.
// 토글 핸들러에서도 재호출되어 실시간으로 부호를 갱신한다.
function _renderDeliveryConfirmSummary() {
    const sign = _deliveryIsReturn ? -1 : 1;
    let rawTotal = 0;
    let html = '';
    tempGroups.forEach(g => {
        html += `<div style="font-weight:700;color:var(--accent);margin-bottom:4px;">📅 ${g.date}</div>`;
        g.items.forEach(it => {
            rawTotal += it.total;
            // 재고 부족 힌트는 실제로 차감이 일어나는 일반 납품(타인거래·반품 아님)에서만 표시
            const si = stockAutoDeduct && !_deliveryIsVoid && !_deliveryIsReturn ? findStockByName(it.name) : null;
            const isShort = si && it.qty > si.qty;
            const stockHint = si ? `<span style="font-size:10px;color:${isShort?'var(--red)':'var(--green)'};margin-left:4px;">(재고 ${si.qty}${escapeHtml(si.unit||'개')}${isShort?' ⚠부족':''})</span>` : '';
            const lineColor = _deliveryIsReturn ? 'var(--red)' : (isShort?'var(--red)':'var(--text)');
            html += `<div style="display:flex;justify-content:space-between;align-items:baseline;color:${isShort&&!_deliveryIsReturn?'var(--red)':'var(--text2)'};padding-left:8px;margin-bottom:3px;gap:8px;">
                <span style="flex:1;min-width:0;">${escapeHtml(it.name)}${stockHint}</span>
                <span style="font-size:11px;white-space:nowrap;color:var(--text3);">${it.qty}개 × ${fmt(it.price)}원</span>
                <span style="font-family:'DM Mono',monospace;font-weight:700;color:${lineColor};white-space:nowrap;">= ${fmt(it.total*sign)}원</span>
            </div>`;
        });
    });
    document.getElementById('deliveryConfirmSummary').innerHTML = html;
    const totalEl = document.getElementById('deliveryConfirmTotal');
    totalEl.textContent = fmt(rawTotal*sign) + '원';
    totalEl.style.color = _deliveryIsReturn ? 'var(--red)' : 'var(--accent)';
}

function closeDeliveryConfirm() {
    document.getElementById('deliveryConfirmOverlay').classList.remove('open');
    document.getElementById('deliveryConfirmPopup').classList.remove('open');
}

// ── 타인거래 토글 ──
let _deliveryIsVoid = false;
// ── 반품/회수 토글 (재고 입고 + 금액 차감, 타인거래와 동시 적용 불가) ──
let _deliveryIsReturn = false;

function toggleDeliveryVoid() {
    _deliveryIsVoid = !_deliveryIsVoid;
    if (_deliveryIsVoid && _deliveryIsReturn) { _deliveryIsReturn = false; _updateDeliveryReturnToggle(); }
    _updateDeliveryVoidToggle();
    _renderDeliveryConfirmSummary();
}

function toggleDeliveryReturn() {
    _deliveryIsReturn = !_deliveryIsReturn;
    if (_deliveryIsReturn && _deliveryIsVoid) { _deliveryIsVoid = false; _updateDeliveryVoidToggle(); }
    _updateDeliveryReturnToggle();
    _renderDeliveryConfirmSummary();
}

function _updateDeliveryVoidToggle() {
    const btn = document.getElementById('deliveryVoidToggle');
    if (!btn) return;
    if (_deliveryIsVoid) {
        btn.style.background = 'rgba(245,166,35,.15)';
        btn.style.borderColor = 'var(--orange)';
        btn.style.color = 'var(--orange)';
        btn.textContent = '👤 타인거래 ON — 재고 차감만 제외됨';
    } else {
        btn.style.background = 'var(--surf2)';
        btn.style.borderColor = 'var(--border)';
        btn.style.color = 'var(--text2)';
        btn.textContent = '👤 타인거래 (재고 차감만 제외)';
    }
}

function _updateDeliveryReturnToggle() {
    const btn = document.getElementById('deliveryReturnToggle');
    if (!btn) return;
    if (_deliveryIsReturn) {
        btn.style.background = 'rgba(229,57,53,.12)';
        btn.style.borderColor = 'var(--red)';
        btn.style.color = 'var(--red)';
        btn.textContent = '↩ 반품/회수 ON — 재고 입고 · 금액 차감';
    } else {
        btn.style.background = 'var(--surf2)';
        btn.style.borderColor = 'var(--border)';
        btn.style.color = 'var(--text2)';
        btn.textContent = '↩ 반품/회수 (재고 입고 + 금액 차감)';
    }
}

// (합계 표시는 _renderDeliveryConfirmSummary()에 통합됨)

async function submitOrder() {
    const clientIdRaw = document.getElementById('selectedClientId').value;
    // 가상 ID(__shared__:wsId:name) 또는 일반 ID 처리
    let client;
    if (clientIdRaw.startsWith('__shared__:')) {
        const parts = clientIdRaw.split(':');
        const sharedWsId   = parts[1];
        const clientName   = parts.slice(2).join(':');
        client = { id: clientIdRaw, name: clientName, _isSharedVirtual: true, _sharedWsId: sharedWsId };
    } else {
        client = clients.find(c => c.id === clientIdRaw);
    }
    if (!clientIdRaw || !client || !tempGroups.length) return;
    const isVoid = !!_deliveryIsVoid;
    const isReturn = !!_deliveryIsReturn;
    const isSharedVirtual = !!client._isSharedVirtual;
    const sharedTargetWsId = client._sharedWsId || null;

    // ── 자동 재고 처리 (타인거래면 스킵) — 일반 납품은 차감, 반품/회수는 입고 ──
    // ★ 공유거래처 대납도 내가 직접 상품을 출고하는 거래이므로 내 재고에서 차감한다(타인거래와는 다름)
    if (stockAutoDeduct && !isVoid) {
        tempGroups.forEach(group => {
            (group.items||[]).forEach(it => {
                const si = findStockByName(it.name);
                if (!si) return;
                const before = si.qty;
                const qtyNum = Number(it.qty)||0;
                si.qty = Math.max(0, si.qty + (isReturn ? qtyNum : -qtyNum));
                (si.log = si.log||[]).unshift({ type: isReturn ? 'in' : 'auto', qty:si.qty-before, before, after:si.qty,
                    reason: (isReturn ? (isSharedVirtual ? '공유대납반품입고(' : '반품/회수 입고(') : (isSharedVirtual ? '공유대납차감(' : '납품차감(')) + client.name + ')', date:group.date, at:new Date().toISOString() });
                si.log = _trimLogByDate(si.log);
            });
        });
    }

    const newOrders = [];
    tempGroups.forEach(group => {
        // 반품/회수: 수량·금액을 음수로 저장 → 재고(입고)·정산(차감) 전반에서 기존 수식이 그대로 상쇄 처리함
        const itemsForOrder = isReturn
            ? group.items.map(i => ({ ...i, qty: -i.qty, total: -i.total }))
            : [...group.items];
        const total = itemsForOrder.reduce((s,i)=>s+i.total,0);
        const order = {
            id: _uid(), clientId: isSharedVirtual ? '' : clientIdRaw, clientName: client.name,
            date:group.date, items:itemsForOrder,
            total, note:'', isPaid:false,
            createdAt:new Date().toISOString()
        };
        if (isVoid) order.isVoid = true;
        if (isReturn) order.isReturn = true;
        // ★ 공유 거래처 대납 표시: A의 Firebase에 저장되지만 B(SESSION_ID)가 납품한 거래
        // → A 앱에서 총매출 집계 시 제외, B 앱에서만 매출로 인식
        if (isSharedVirtual) order.delegatedBy = ((localStorage.getItem('workspaceId') || SESSION_ID) + '').toLowerCase(); // ★ wsId로 저장 (재시작 후에도 동일 식별, sync.js 비교 로직과 대소문자 일치)
        newOrders.push(order);
        // 단가 캐시 갱신 (원래 양수 단가 기준으로 저장)
        (group.items||[]).forEach(it => { if (it.price > 0) prices[it.name] = it.price; });
    });

    if (isSharedVirtual && sharedTargetWsId) {
        // ── 공유 거래처: A의 Firebase에 직접 저장 ──
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            // Firebase 미연결 시 오프라인 큐에 저장 → 재연결 시 자동 업로드
            _enqueueSharedOrder(sharedTargetWsId, newOrders);
            newOrders.forEach(order => {
                const wsItem = _getSharedWs().find(w => w.wsId === sharedTargetWsId);
                _sharedOrdersCache.push({
                    ...order,
                    _sharedWsId:    sharedTargetWsId,
                    _sharedWsLabel: wsItem?.label || sharedTargetWsId,
                    _readOnly:      false,
                    _mySharedEntry: true,
                });
            });
            toast('📤 오프라인 중 — 공유 납품이 대기 큐에 저장됩니다 (재연결 시 자동 업로드)', 'var(--orange)', 4000);
        } else {
            // Firebase 연결 중 — A의 Firebase에 직접 저장
            const db = firebase.database();
            const updates = {};
            newOrders.forEach(order => {
                updates[`workspaces/${sharedTargetWsId}/orders/${order.id}`] = order;
            });
            // A의 워크스페이스 루트 lastUpdated/writtenBy 업데이트
            // → A의 .on('value') 리스너가 워크스페이스 루트 변경을 감지해 화면에 반영
            updates[`workspaces/${sharedTargetWsId}/lastUpdated`] = new Date().toISOString();
            updates[`workspaces/${sharedTargetWsId}/writtenBy`]   = `__shared_by__:${SESSION_ID}`;
            try {
                await db.ref('/').update(updates);
                // ★ 실시간 리스너가 있으면 자동으로 _sharedOrdersCache 갱신됨
                // 리스너가 없는 경우(첫 등록 등)에만 수동으로 캐시에 추가
                if (!_sharedOrdersListeners[sharedTargetWsId]) {
                    newOrders.forEach(order => {
                        const wsItem = _getSharedWs().find(w => w.wsId === sharedTargetWsId);
                        const already = _sharedOrdersCache.find(o => o.id === order.id);
                        if (!already) {
                            _sharedOrdersCache.push({
                                ...order,
                                _sharedWsId:    sharedTargetWsId,
                                _sharedWsLabel: wsItem?.label || sharedTargetWsId,
                                _readOnly:      false,
                                _mySharedEntry: true,
                            });
                        }
                    });
                }
                toast('✅ 공유 거래처 납품 등록 완료!', 'var(--green)');
            } catch(e) {
                // Firebase 저장 실패 시 큐에 보관
                _enqueueSharedOrder(sharedTargetWsId, newOrders);
                console.error('[공유납품] Firebase 저장 오류 — 큐 저장:', e);
                toast('⚠️ 공유 납품 저장 실패 — 대기 큐에 보관됩니다 (재연결 시 자동 업로드)', 'var(--orange)', 4000);
            }
        } // end else (Firebase 연결됨)
    } else {
        // ── 일반 거래처: 내 orders에 저장 ──
        newOrders.forEach(order => {
            orders.push(order);
            _markDirtyOrder(order.id);
        });
    }
    // 거래명세서 자동 오픈을 위해 확정 직전에 거래처명·월 저장
    const _savedClientName = client.name;
    const _savedMonth = (tempGroups[0]?.date || todayKST()).slice(0, 7);
    _deliveryIsVoid = false;
    _deliveryIsReturn = false;
    tempGroups = [];
    closeDeliveryConfirm();
    // 거래처 입력창 완전 초기화 → 새 거래처 바로 입력 가능
    document.getElementById('deliveryClient').value   = '';
    document.getElementById('selectedClientId').value = '';
    document.getElementById('deliveryDate').value     = todayKST();
    // 미수금 힌트 초기화
    const hint = document.getElementById('clientUnpaidHint');
    if (hint) { hint.textContent = ''; hint.classList.remove('visible'); }
    // 품목 추천 칩 숨기기
    const suggestBox = document.getElementById('clientItemSuggest');
    if (suggestBox) suggestBox.classList.remove('visible');
    // 단가 힌트 초기화
    const priceHint = document.getElementById('priceHint');
    if (priceHint) priceHint.textContent = '';
    renderTempGroups();
    // ★ v122: 공유거래처 대납도 이제 내 재고를 차감하므로, 재고 변경분 유실 방지를 위해 항상 로컬 저장 필요
    // (기존엔 "공유 거래처 납품은 내 로컬 저장 불필요"였으나, 대납 시 재고 차감이 추가되며 전제가 깨짐)
    saveData(true);
    _safeRefresh(updateInfoCounts, updateNavBadges, renderDashboard, () => updateItemDatalist(''), _refreshSettlementIfActive, _refreshStockIfActive, _refreshUnpaidIfActive, renderOrders); // 공유 캐시 포함 내역 갱신
    // 납품 확정 후: 내역 탭 전환 → 거래명세서 자동 오픈
    // ★ v130 fix: showTab/setHistPeriod/toast가 도중에 던지면 뒤이은 showClientStatement 예약(setTimeout) 자체가
    // 안 걸려서 명세서 자동오픈이 통째로 무산될 수 있었음 — 각각 독립 실행으로 분리.
    setTimeout(() => {
        _safeRefresh(
            () => showTab('history'),
            () => setHistPeriod('today', document.querySelector('.chip.hist-period[data-p="today"]')),
            () => { if (!isSharedVirtual) { toast(isReturn ? '↩ 반품/회수 등록 완료! (재고 입고 처리됨)' : isVoid ? '👤 타인거래로 등록 완료 (재고 차감 제외)' : '✅ 납품 등록 완료!', 'var(--green)'); } }
        );
        setTimeout(() => showClientStatement(_savedClientName, _savedMonth), 200);
    }, 80);
}

