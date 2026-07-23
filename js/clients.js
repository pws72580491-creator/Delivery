// ╔══════════════════════════════════════════════════════════════╗
// ║  § 6  거래처                                                    ║
// ╚══════════════════════════════════════════════════════════════╝

function checkDupClient() {
    const name = document.getElementById('clientName').value.trim();
    const warn = document.getElementById('dupWarn');
    const exists = clients.some(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== editingClientId);
    warn.style.display = (name && exists) ? 'block' : 'none';
}

function saveClient() {
    const name    = document.getElementById('clientName').value.trim();
    const phone   = document.getElementById('clientPhone').value.trim();
    const address = document.getElementById('clientAddress').value.trim();
    const note    = document.getElementById('clientNote').value.trim();
    if (!name) return toast('❗ 거래처명을 입력하세요');
    const dup = clients.some(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== editingClientId);
    if (dup) return toast('❗ 이미 존재하는 거래처입니다');
    if (editingClientId) {
        const c = clients.find(c => c.id === editingClientId);
        if (c) {
            const oldName = c.name;
            c.name=name; c.phone=phone; c.address=address; c.note=note; c.updatedAt=new Date().toISOString();
            // 거래처명이 변경된 경우 관련 전표 일괄 반영
            if (oldName !== name) {
                let orderCount = 0;
                const oldNameTrim = oldName.trim();
                orders.forEach(o => {
                    // clientId 일치 OR clientName 일치(공백 무시) OR clientId가 비어있고 이름 일치
                    const idMatch   = o.clientId && o.clientId === editingClientId;
                    const nameMatch = (o.clientName || '').trim() === oldNameTrim;
                    if (idMatch || nameMatch) {
                        o.clientName = name;
                        // clientId가 없거나 불일치하면 이 기회에 바로잡기
                        if (!o.clientId || o.clientId !== editingClientId) {
                            o.clientId = editingClientId;
                        }
                        _markDirtyOrder(o.id); // delta sync 마킹
                        orderCount++;
                    }
                });
                if (orderCount > 0) toast(`✅ 거래처 수정 완료 (전표 ${orderCount}건 반영)`, 'var(--green)');
                else toast('✅ 거래처 수정 완료', 'var(--green)');
            } else {
                toast('✅ 거래처 수정 완료', 'var(--green)');
            }
        }
    } else {
        clients.push({ id:_uid(), name, phone, address, note, isHidden:false, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
        // ★ 로컬 변경 시각 갱신 → Firebase 리스너가 구 서버 데이터로 덮어쓰는 경쟁 방지
        _localWriteTime = Date.now();
        toast('✅ 거래처 등록 완료', 'var(--green)');
    }
    cancelClientEdit();
    saveData(true);
    _safeRefresh(renderClients, renderOrders, updateInfoCounts, renderDashboard, updateNavBadges, _refreshSettlementIfActive); // ★v119
}

function cancelClientEdit() {
    editingClientId = null;
    document.getElementById('clientName').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('clientAddress').value = '';
    document.getElementById('clientNote').value = '';
    if (document.getElementById('clientGroupSuggest')) document.getElementById('clientGroupSuggest').style.display = 'none';
    document.getElementById('dupWarn').style.display = 'none';
    document.getElementById('clientFormTitle').textContent = '거래처 등록';
    document.getElementById('clientCancelBtn').style.display = 'none';
}

function editClient(id) {
    const c = clients.find(c => c.id === id);
    if (!c) return;
    editingClientId = id;
    document.getElementById('clientName').value    = c.name;
    document.getElementById('clientPhone').value   = c.phone || '';
    document.getElementById('clientAddress').value = c.address || '';
    document.getElementById('clientNote').value    = c.note || '';
    document.getElementById('clientFormTitle').textContent = '거래처 수정';
    document.getElementById('clientCancelBtn').style.display = 'block';
    document.getElementById('clientName').focus();
    document.getElementById('mainContent').scrollTop = 0;
}

async function deleteClient(id) {
    const c = clients.find(c => c.id === id);
    if (!c) return;
    const hasOrders = orders.some(o => o.clientId === id);
    const msg = hasOrders
        ? `'${c.name}'은 납품 내역이 있습니다.\n삭제할까요? (납품 내역은 유지됩니다)`
        : `'${c.name}'을 삭제할까요?`;
    if (!await customConfirm(msg)) return;
    clients = clients.filter(c => c.id !== id);
    saveData();
    _safeRefresh(renderClients, updateInfoCounts, updateNavBadges, () => toast('🗑️ 삭제되었습니다'));
}

function toggleClientList() {
    clientListVisible = !clientListVisible;
    document.getElementById('clientList').style.display = clientListVisible ? 'block' : 'none';
    document.getElementById('clientToggleBtn').textContent = clientListVisible ? '숨기기' : '보이기';
    renderClients();
}

function toggleShowHidden() {
    showHiddenClients = !showHiddenClients;
    const btn = document.getElementById('showHiddenBtn');
    if (btn) {
        btn.textContent = showHiddenClients ? '숨김제외' : '숨김포함';
        btn.style.color = showHiddenClients ? 'var(--orange)' : '';
        btn.style.borderColor = showHiddenClients ? 'var(--orange)' : '';
    }
    renderClients();
}

// 개별 거래처 숨기기/보이기 토글
function hideClient(id) {
    const c = clients.find(c => c.id === id);
    if (!c) return;
    c.isHidden = !c.isHidden;
    c.updatedAt = new Date().toISOString();
    saveData(); renderClients();
    toast(c.isHidden ? '🙈 거래처를 숨겼습니다' : '👁 거래처를 표시합니다');
}

let clientSortMode = 'name'; // 'name' | 'recent' | 'unpaid' | 'total'

function setClientSort(mode, btn) {
    clientSortMode = mode;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderClients();
}

function renderClients() {
    // window.appData 노출 (index.html 그룹 헬퍼에서 참조)
    window.appData = { clients, orders, prices };

    const searchEl = document.getElementById('clientSearch');
    const q = searchEl ? searchEl.value : '';
    const statsMap = _buildClientStatsCache();
    const filtered = clients.filter(c => (showHiddenClients || !c.isHidden) && (matchSearch(c.name, q) || (c.phone && c.phone.includes(q))));

    filtered.sort((a,b) => {
        const sa = statsMap[a.id] || statsMap[a.name] || { count:0,total:0,unpaid:0,lastDate:'' };
        const sb = statsMap[b.id] || statsMap[b.name] || { count:0,total:0,unpaid:0,lastDate:'' };
        if (clientSortMode==='recent') return sb.lastDate.localeCompare(sa.lastDate);
        if (clientSortMode==='unpaid') return sb.unpaid - sa.unpaid;
        if (clientSortMode==='total')  return sb.total  - sa.total;
        return a.name.localeCompare(b.name, 'ko');
    });
    const el = document.getElementById('clientList');
    if (!el) return;

    if (!filtered.length) {
        el.innerHTML = '<div class="empty"><div class="empty-icon">🏪</div><div class="empty-text">등록된 거래처가 없습니다</div></div>';
        return;
    }


    el.innerHTML = filtered.map(c => _clientCardHTML(c, statsMap, q)).join('');
}

function _clientCardHTML(c, statsMap, q) {
    const stats     = statsMap[c.id] || statsMap[c.name] || { count:0, total:0, unpaid:0 };
    const unpaidAmt = stats.unpaid || 0;
    const safeId   = escapeAttr(c.id);
    const safeName = escapeAttr(c.name);
    // 미수금 경과일 계산 (가장 오래된 미수 전표 기준)
    let maxAgeDays = 0;
    if (unpaidAmt > 0) {
        const today = todayKST();
        orders.forEach(o => {
            if ((o.clientId === c.id || o.clientName === c.name) && !o.isPaid) {
                const days = Math.floor((new Date(today) - new Date(o.date)) / 86400000);
                if (days > maxAgeDays) maxAgeDays = days;
            }
        });
    }
    const ageCls = unpaidAmt <= 0 ? '' :
        maxAgeDays >= 90 ? 'has-unpaid unpaid-severe' :
        maxAgeDays >= 60 ? 'has-unpaid unpaid-danger' :
        maxAgeDays >= 30 ? 'has-unpaid unpaid-warn'   : 'has-unpaid unpaid-ok';
    const badgeCls = maxAgeDays >= 90 ? 'severe' : maxAgeDays >= 60 ? 'danger' : maxAgeDays >= 30 ? 'warn' : '';
    const ageLabel = unpaidAmt > 0
        ? (maxAgeDays >= 90 ? `🚨 ${maxAgeDays}일 경과` : maxAgeDays >= 60 ? `🔴 ${maxAgeDays}일 경과` : maxAgeDays >= 30 ? `🟠 ${maxAgeDays}일 경과` : `🟢 ${maxAgeDays}일 경과`)
        : '';

    // ── 오늘 납품한 거래처만: 가장 최근 메모 뱃지 ──
    const _todayStr = todayKST();
    const _hasTodayOrder = orders.some(o =>
        o.clientName === c.name && o.date === _todayStr);
    let lastMemoHtml = '';
    if (_hasTodayOrder) {
        const _lastMemo = orders
            .filter(o => o.clientName === c.name && o.note && o.note.trim())
            .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''))
            [0];
        if (_lastMemo) {
            const _dLabel  = _lastMemo.date === _todayStr ? '오늘' : _lastMemo.date;
            const _preview = _lastMemo.note.length > 30 ? _lastMemo.note.slice(0, 30) + '…' : _lastMemo.note;
            lastMemoHtml = `<div class="client-last-memo">💬 ${_dLabel} · ${escapeHtml(_preview)}</div>`;
        }
    }

    return `<div class="swipe-wrap" id="swipe-${escapeHtml(c.id)}" data-client-id="${escapeHtml(c.id)}">
        <div class="swipe-bg-left">📞</div>
        <div class="swipe-bg-right">🗑️</div>
        <div class="swipe-inner">
        <div class="client-card ${ageCls}" onclick="toggleClientTooltip(event, this)">
            ${(() => {
                // 이 거래처의 최근 메모 3개
                const memos = (orders||[])
                    .filter(o => o.clientName === c.name && o.note && o.note.trim())
                    .sort((a,b) => (b.date||'').localeCompare(a.date||''))
                    .slice(0, 3);
                if (!memos.length) return '';
                return `<div class="client-tooltip">${memos.map(o => `📅 ${o.date}\n📝 ${escapeHtml(o.note)}`).join('\n\n')}</div>`;
            })()}
            <div>
                <div class="client-name">${highlight(c.name, q)}${c._autoAdded ? `<span class="shared-client-badge">📦 ${escapeHtml(c._sharedLabel||c._sharedFrom||'공유')}</span>` : ''}</div>
                ${c.phone ? `<div class="client-phone">📞 ${escapeHtml(c.phone)}</div>` : ''}
                ${c.address ? `<div class="client-phone" style="font-size:11px;">📍 ${escapeHtml(c.address)}</div>` : ''}
                <div class="client-stats">거래 ${stats.count}건 · ${fmt(stats.total)}원</div>
                ${unpaidAmt > 0 ? `<div><span class="client-unpaid-badge ${badgeCls}">💸 미수 ${fmt(unpaidAmt)}원 ${ageLabel}</span></div>` : ''}
                ${c.note ? `<div class="client-stats" style="color:var(--text3);">📝 ${escapeHtml(c.note)}</div>` : ''}
                ${lastMemoHtml}
            </div>
            <div class="client-actions">
                ${c.phone ? `<a href="tel:${escapeHtml(c.phone)}" class="btn-call">📞</a>` : ''}
                <button class="btn-deliver" onclick="quickDeliver('${safeId}','${safeName}')">🚚</button>
                <button class="btn btn-ghost btn-sm" onclick="hideClient('${safeId}')" title="${c.isHidden ? '거래처 표시' : '거래처 숨기기'}">${c.isHidden ? '👁' : '🙈'}</button>
                <button class="btn btn-ghost btn-sm" onclick="editClient('${safeId}')">수정</button>
                <button class="btn btn-danger btn-sm" onclick="deleteClient('${safeId}')">삭제</button>
            </div>
        </div>
        </div>
    </div>`;
}

// ─── 빠른 납품하기 (거래처 탭에서 바로 납품 탭으로) ───

function quickDeliver(id, name) {
    showTab('delivery');
    setTimeout(() => {
        document.getElementById('selectedClientId').value = id;
        document.getElementById('deliveryClient').value   = name;
        // 미수금 힌트 표시
        const hint = document.getElementById('clientUnpaidHint');
        if (hint) {
            const unpaidOrders = orders.filter(o => o.clientId === id && !o.isPaid);
            const unpaidAmt = unpaidOrders.reduce((s,o)=>s+o.total-(o.paidAmount||0), 0);
            if (unpaidAmt > 0) {
                hint.textContent = `💸 현재 미수금: ${fmt(unpaidAmt)}원 (${unpaidOrders.length}건)`;
                hint.classList.add('visible');
            } else {
                hint.textContent = '';
                hint.classList.remove('visible');
            }
        }
        // 거래처별 최근 품목 추천 표시
        showClientItemSuggestions(id);
        updateItemDatalist(id);
        document.getElementById('itemName').focus();
    }, 100);
}

// ─── 품목명 정규화 (재고 매칭용) ───

// ─── 거래처 카드 스와이프 초기화 ───
let _clientSwipeInited = false;

function initClientSwipe() {
    // 렌더링 시마다 호출되므로 중복 등록 방지
    if (_clientSwipeInited) return;
    const list = document.getElementById('clientList');
    if (!list) return;
    _clientSwipeInited = true;

    let startX = 0, startY = 0, currentEl = null, dx = 0;
    const THRESHOLD = 55;
    const MAX_DRAG = 100;

    list.addEventListener('touchstart', e => {
        const wrap = e.target.closest('.swipe-wrap');
        if (!wrap) return;
        currentEl = wrap;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        dx = 0;
        wrap.querySelector('.swipe-inner').style.transition = 'none';
    }, { passive: true });

    list.addEventListener('touchmove', e => {
        if (!currentEl) return;
        const curX = e.touches[0].clientX;
        const curY = e.touches[0].clientY;
        const newDx = curX - startX;
        const dy = Math.abs(curY - startY);
        if (Math.abs(newDx) < 5 && dy > 10) { currentEl = null; return; }
        dx = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, newDx));
        const inner = currentEl.querySelector('.swipe-inner');
        if (inner) inner.style.transform = `translateX(${dx}px)`;
        currentEl.classList.toggle('swiping-left', dx > 10);
        currentEl.classList.toggle('swiping-right', dx < -10);
    }, { passive: true });

    list.addEventListener('touchend', () => {
        if (!currentEl) return;
        const inner = currentEl.querySelector('.swipe-inner');
        const cid = currentEl.dataset.clientId;
        const c = clients.find(x => x.id === cid);

        if (dx > THRESHOLD && c && c.phone) {
            // 우로 스와이프 → 전화
            inner.style.transition = 'transform .25s ease';
            inner.style.transform = 'translateX(0)';
            currentEl.classList.remove('swiping-left','swiping-right');
            setTimeout(() => { window.location.href = 'tel:' + c.phone; }, 150);
        } else if (dx < -THRESHOLD && c) {
            // 좌로 스와이프 → 삭제
            inner.style.transition = 'transform .2s ease';
            inner.style.transform = `translateX(${-MAX_DRAG}px)`;
            setTimeout(() => {
                inner.style.transition = 'none';
                inner.style.transform = 'translateX(0)';
                currentEl.classList.remove('swiping-left','swiping-right');
                deleteClientWithAnim(cid, currentEl);
            }, 200);
        } else {
            inner.style.transition = 'transform .2s ease';
            inner.style.transform = 'translateX(0)';
            currentEl.classList.remove('swiping-left','swiping-right');
        }
        currentEl = null; dx = 0;
    });
}

async function deleteClientWithAnim(id, wrapEl) {
    const c = clients.find(c => c.id === id);
    if (!c) return;
    const hasOrders = orders.some(o => o.clientId === id);
    const msg = hasOrders
        ? `'${c.name}'은 납품 내역이 있습니다.\n삭제할까요? (납품 내역은 유지됩니다)`
        : `'${c.name}'을 삭제할까요?`;
    if (!await customConfirm(msg)) return;
    if (wrapEl) {
        wrapEl.classList.add('card-deleting');
        setTimeout(() => {
            clients = clients.filter(c => c.id !== id);
            saveData();
            _safeRefresh(renderClients, updateInfoCounts, updateNavBadges, () => toast('🗑️ 삭제되었습니다'));
        }, 350);
    } else {
        clients = clients.filter(c => c.id !== id);
        saveData();
        _safeRefresh(renderClients, updateInfoCounts, updateNavBadges, () => toast('🗑️ 삭제되었습니다'));
    }
}

