// ╔══════════════════════════════════════════════════════════════╗
// ║  § 17  앱 초기화 (DOMContentLoaded)                               ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── 시스템 다크모드 자동 감지 ───

function initSystemTheme() {
    // 이미 사용자가 직접 설정한 경우는 그대로
    if (localStorage.getItem('theme')) return;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('light', !isDark);
    document.getElementById('themeBtn').textContent = isDark ? '☀️' : '🌙';
}

// ─── 대시보드 렌더 후 sparklines & count-up 실행 ───
let _dashSparkTimer = null;
renderDashboard = _safeWrap(renderDashboard, function() {
    if (_dashSparkTimer) clearTimeout(_dashSparkTimer);
    _dashSparkTimer = setTimeout(() => {
        _dashSparkTimer = null;
        renderSparklines();
        ['dashSales','dashUnpaid'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const raw = el.textContent.replace(/,/g,'');
            const num = parseFloat(raw);
            if (!isNaN(num) && num > 0) animateCount(el, num);
        });
    }, 50);
});

// ─── renderSettlement 후킹 (바차트 추가) ───
renderSettlement = _safeWrap(renderSettlement, function() {
    const month = document.getElementById('settlementMonth')?.value || todayKST().slice(0,7);
    renderSettleBarChart(month);
});
renderSettlementDaily = _safeWrap(renderSettlementDaily, function() {
    const date = document.getElementById('settlementDateDaily')?.value || todayKST();
    renderSettleBarChart(date.slice(0,7));
});
renderSettlementQuarterly = _safeWrap(renderSettlementQuarterly, function() {
    const year = document.getElementById('settlementYear')?.value || todayKST().slice(0,4);
    renderSettleBarChart(year + '-01');
});

// ─── updateInfoCounts 후킹 (배지 갱신) ───
updateInfoCounts = _safeWrap(updateInfoCounts, function() { updateNavBadges(); });

// ─── renderClients 후킹 (스와이프 초기화) ───
renderClients = _safeWrap(renderClients, function() { _clientSwipeInited = false; initClientSwipe(); });


// ─── 달걀 품목 초기 등록 ───
const EGG_ITEMS_DEFAULT = [
    { name:'왕란', unit:'판', low:5, danger:2, note:'왕란' },
    { name:'특란', unit:'판', low:5, danger:2, note:'특란' },
    { name:'대란', unit:'판', low:5, danger:2, note:'대란' },
    { name:'중란', unit:'판', low:5, danger:2, note:'중란' },
];

const ETC_ITEMS_DEFAULT = [
    { name:'이른아침 왕란 30입',   unit:'박스', low:3, danger:1 },
    { name:'이른아침 특란 30입',   unit:'박스', low:3, danger:1 },
    { name:'이른아침 대란 30입',   unit:'박스', low:3, danger:1 },
    { name:'이른아침 초란 30입',   unit:'박스', low:3, danger:1 },
    { name:'이른아침 왕란 10입',   unit:'박스', low:3, danger:1 },
    { name:'이른아침 PURE특란 10입', unit:'박스', low:3, danger:1 },
    { name:'이른아침 대란 10입',   unit:'박스', low:3, danger:1 },
    { name:'이른아침 PURE왕란 15입', unit:'박스', low:3, danger:1 },
    { name:'이른아침 영양왕란 15입', unit:'박스', low:3, danger:1 },
    { name:'이른아침 영양특란 10입', unit:'박스', low:3, danger:1 },
    { name:'명품영양란 특란 30입',  unit:'박스', low:3, danger:1 },
    { name:'유정란 1번 10입',      unit:'박스', low:3, danger:1 },
    { name:'유정란 1번 30입',      unit:'박스', low:3, danger:1 },
    { name:'유정란 2번 10입',      unit:'박스', low:3, danger:1 },
    { name:'유정란 2번 15입',      unit:'박스', low:3, danger:1 },
    { name:'유정란 2번 30입',      unit:'박스', low:3, danger:1 },
    { name:'구운란 10입',          unit:'박스', low:3, danger:1 },
    { name:'구운란 벌크 30입',     unit:'박스', low:3, danger:1 },
    { name:'구운란 망 30입',       unit:'박스', low:3, danger:1 },
    { name:'메추리알 24알',        unit:'박스', low:3, danger:1 },
    { name:'깐메추리알 1kg',       unit:'박스', low:3, danger:1 },
];

// ─── 초기화 ───

// ─── 스와이프 제스처 ───

function initSwipeGestures() {
    let startX=0, startY=0, blocked=false;
    const content = document.getElementById('mainContent');
    content.addEventListener('touchstart', e=>{
        blocked = !!e.target.closest('.table-wrap') ||
                  !!e.target.closest('#settlementTable');
        startX = e.changedTouches[0].screenX;
        startY = e.changedTouches[0].screenY;
    }, {passive:true});
    content.addEventListener('touchend', e=>{
        if (blocked) return;
        const dx = e.changedTouches[0].screenX - startX;
        const dy = e.changedTouches[0].screenY - startY;
        // 수평 이동이 수직 이동의 1.5배 이상이어야 탭 전환 (대각선 스크롤 방지)
        if (Math.abs(dx) < 60) return;
        if (Math.abs(dy) > Math.abs(dx) * 0.7) return;
        const active = document.querySelector('.pane.active');
        const id = active?.id?.replace('pane-','');
        const idx = TAB_ORDER.indexOf(id);
        if (idx===-1) return;
        if (dx>0 && idx>0) showTab(TAB_ORDER[idx-1]);
        if (dx<0 && idx<TAB_ORDER.length-1) showTab(TAB_ORDER[idx+1]);
    }, {passive:true});
}

// ─── Pull-to-Refresh ───

function initPullToRefresh() {
    const content   = document.getElementById('mainContent');
    const indicator = document.getElementById('pullIndicator');
    const pullText  = document.getElementById('pullText');
    const THRESHOLD = 65;   // 놓을 때 새로고침 발동 기준 (px)
    const MAX_PULL  = 110;  // 최대 당김 거리 (px)

    let startY = 0;
    let pulling = false;
    let isRefreshing = false;
    let startScrollTop = 0;

    content.addEventListener('touchstart', e => {
        if (isRefreshing) return;
        startScrollTop = content.scrollTop;
        // 스크롤이 최상단일 때만 pull 시작
        if (startScrollTop > 2) return;
        startY = e.touches[0].clientY;
        pulling = false;
    }, { passive: true });

    content.addEventListener('touchmove', e => {
        if (isRefreshing) return;
        if (content.scrollTop > 2) return; // 스크롤 내려가 있으면 무시
        const dy = e.touches[0].clientY - startY;
        if (dy < 10) return; // 아래 방향 최소 이동

        pulling = true;

        const pull = Math.min(dy * 0.6, MAX_PULL); // 저항감 0.6배

        indicator.style.height = pull + 'px';
        indicator.classList.toggle('releasing', pull >= THRESHOLD);
        indicator.classList.remove('refreshing');

        if (pull >= THRESHOLD) {
            pullText.textContent = '놓으면 새로고침';
        } else {
            pullText.textContent = '당겨서 새로고침';
        }
    }, { passive: true });

    content.addEventListener('touchend', e => {
        if (!pulling || isRefreshing) { pulling = false; return; }
        pulling = false;
        const currentH = parseInt(indicator.style.height || '0');

        if (currentH >= THRESHOLD) {
            // 새로고침 발동
            isRefreshing = true;
            indicator.style.height = '52px';
            indicator.classList.remove('releasing');
            indicator.classList.add('refreshing', 'visible');
            pullText.textContent = '새로고침 중…';

            // 실제 새로고침 실행
            setTimeout(() => {
                try {
                    _fullRender();
                    // Firebase 연결 중이면 서버 최신 데이터 받아서 반영
                    if (isConnected && workspaceRef) {
                        // ★ v99 fix: 업로드 중(_syncGuard=true)이면 서버 덮어쓰기 차단
                        // _fbValueHandler 경유 → CRM·공유납품 보호 로직 + hash 비교 적용
                        if (_syncGuard) return;
                        _withTimeout(workspaceRef.get(), 8000, 'pullRefresh.get').then(snap => {
                            if (!snap.val()) return;
                            _fbValueHandler(snap);
                        }).catch(()=>{}); // 새로고침 한 번 실패해도 다음 당겨서새로고침 시 재시도되므로 별도 로그 생략
                    }
                } catch(e) { console.warn('pull-to-refresh 오류', e); }

                // 인디케이터 숨기기
                setTimeout(() => {
                    indicator.style.height = '0';
                    indicator.classList.remove('refreshing', 'visible', 'releasing');
                    pullText.textContent = '당겨서 새로고침';
                    isRefreshing = false;
                }, 600);
            }, 300);
        } else {
            // 미달 → 원위치
            indicator.style.transition = 'height 0.25s ease';
            indicator.style.height = '0';
            indicator.classList.remove('releasing', 'visible');
            setTimeout(() => { indicator.style.transition = ''; }, 250);
        }
    }, { passive: true });
}

// ─── 변경 이력 접기/펼치기 ───

function toggleOldChangelog() {
    const items = document.getElementById('oldChangelogItems');
    const icon  = document.getElementById('changelogToggleIcon');
    const label = document.getElementById('changelogToggleLabel');
    const isOpen = items.style.display === 'flex';
    // 첫 번째 이전 이력 버전명을 DOM에서 동적으로 읽어 레이블 구성
    const firstOldVer = items.querySelector('.changelog-ver')?.textContent?.trim() || '';
    const lastOldVer  = [...items.querySelectorAll('.changelog-ver')].pop()?.textContent?.trim() || '';
    const rangeLabel  = firstOldVer && lastOldVer ? `(${firstOldVer} ~ ${lastOldVer})` : '';
    if (isOpen) {
        items.style.display = 'none';
        icon.textContent  = '▼';
        label.textContent = `이전 이력 보기 ${rangeLabel}`;
    } else {
        items.style.display = 'flex';
        icon.textContent  = '▲';
        label.textContent = `이전 이력 접기 ${rangeLabel}`;
    }
}

// ─── 전체 렌더 ───

function _fullRender() {
    invalidateOrdersCache();
    // 캐시 사전 빌드 (첫 입력 시 딜레이 제거)
    _buildRecentPricesCache();
    // 모든 탭 더티 마킹 → 탭 진입 시 각자 렌더링
    _markDirty();
    // 거래처 목록 display 상태 보장
    const cl = document.getElementById('clientList');
    const tb = document.getElementById('clientToggleBtn');
    if (cl) cl.style.display = clientListVisible ? 'block' : 'none';
    if (tb) tb.textContent   = clientListVisible ? '숨기기' : '보이기';
    // 납품 autocomplete 갱신 (탭 무관)
    updateItemDatalist('');
    // 탭 무관 항상 갱신 (원본 동작 보존)
    updateInfoCounts();
    renderDashboard();
    // 배지 갱신
    updateNavBadges();
    // 현재 활성 탭만 즉시 렌더링 (dashboard는 이미 위에서 갱신됐으므로 dirty 해제)
    _dirty['dashboard'] = false;
    _renderActiveIfDirty();
}

// ─── 드롭다운 외부 클릭 닫기: 위 통합 document click 핸들러에서 처리 ───

// ─── 더블탭 전체선택 (모바일 터치 지원) ───
// PC: ondblclick="this.select()" 으로 처리
// 모바일: 300ms 이내 두 번 터치 → select() 전체 선택
function _initDoubleTapSelect(el) {
    if (!el) return;
    let _lastTap = 0;
    el.addEventListener('touchend', e => {
        const now = Date.now();
        if (now - _lastTap < 300) {
            e.preventDefault();
            el.select();
        }
        _lastTap = now;
    }, { passive: false });
}

// ─── Escape 키로 열린 모달 닫기 ───
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const mp = document.getElementById('memoPopup');
    if (mp && mp.classList.contains('open')) { closeMemoPopup(); return; }
    const qp = document.getElementById('quickPayPopup');
    if (qp && qp.classList.contains('open')) { closeQuickPay(); return; }
    const bp = document.getElementById('bulkPayPopup');
    if (bp && bp.classList.contains('open')) { closeBulkPayPopup(); return; }
    const modals = [
        'firebaseModal','detailModal','statementModal','partialPayModal','payEditModal',
        'clientEditModal','orderEditModal','stockEditModal','stockAdjModal','stockLogModal'
    ];
    for (const id of modals) {
        const el = document.getElementById(id);
        if (el && el.classList.contains('open')) { closeModal(id); break; }
    }
});

// ─── Enter 키 포커스 체인 ───

function focusNext(nextId, action) {
    if (action) { action(); return; }
    const el = document.getElementById(nextId);
    if (!el) return;
    el.focus();
    setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
}

function bindEnter(id, nextId, action) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        // textarea: Enter는 줄바꿈, Ctrl+Enter로 다음 이동
        if (el.tagName === 'TEXTAREA') {
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); focusNext(nextId, action); }
            return;
        }
        e.preventDefault();
        focusNext(nextId, action);
    });
}

function initKeyHandlers() {
    // ── 거래처 탭 ──
    bindEnter('clientName',    'clientPhone');
    bindEnter('clientPhone',   'clientAddress');
    bindEnter('clientAddress', 'clientNote');
    bindEnter('clientNote',    null, saveClient);   // Ctrl+Enter → 등록

    // ── 납품 탭 ──
    bindEnter('deliveryClient', 'deliveryDate');
    bindEnter('deliveryDate',   'itemName');
    bindEnter('itemName',       'itemQty');
    bindEnter('itemQty',        'itemPrice');
    bindEnter('itemPrice',      null, addItemToGroup);

    // ── Firebase 모달 ──
    bindEnter('workspaceId', null, () => connectWorkspace(false));

    // ── 백업 탭 ──
    bindEnter('schedDay1', 'schedDay2');
    bindEnter('schedDay2', null, saveBackupSchedule);

    // ★ v114: 수금 모달 — Enter 키로 다음 필드 이동
    bindEnter('ppAmount',      'ppNote');       // 단일결제: 금액 → 메모
    bindEnter('ppTransferAmt', 'ppCashAmt');    // 혼합결제: 이체 → 현금
    bindEnter('ppCashAmt',     'ppNote');       // 혼합결제: 현금 → 메모
    bindEnter('ppNote',   null, () => { if (typeof confirmPartialPay === 'function') confirmPartialPay(); });

    // ★ v114: 결제 수정 모달
    bindEnter('peAmount', 'peNote');
    bindEnter('peNote',   null, () => { if (typeof confirmPayEdit === 'function') confirmPayEdit(); });

    // ★ v114: 공유 워크스페이스 입력
    bindEnter('sharedWsInput', null, addSharedWs);
}

// ─── 달걀 품목 초기 등록 ───

// ─── 초기화 ───
window.addEventListener('DOMContentLoaded', () => {
    // 테마
    applyTheme();
    // 날짜 기본값
    const today = todayKST();
    document.getElementById('deliveryDate').value = today;
    document.getElementById('settlementMonth').value = today.slice(0,7);
    document.getElementById('settlementDateDaily').value = today;
    document.getElementById('settlementYear').value = today.slice(0,4);
    initHistPeriod();
    // 탭 & 스와이프
    initTabs();
    _initAllMoneyInputs(); // 금액 입력 필드 콤마 포매터 초기화
    initSwipeGestures();
    initPullToRefresh();
    initKeyHandlers();
    // 검색 입력창 더블탭 전체선택 (모바일)
    // 검색 input별 결과 목록 ID 매핑
    const searchScrollMap = {
        'clientSearch':   'clientList',
        'deliveryClient': 'clientDropdown',
        'histSearch':     'orderList',
        'settleSearch':   'settlementTable',
    };
    // deliveryClient는 bindEnter에서 처리하므로 여기선 더블탭만 초기화
    _initDoubleTapSelect(document.getElementById('deliveryClient'));
    ['clientSearch','histSearch','settleSearch'].forEach(id => {
        _initDoubleTapSelect(document.getElementById(id));
        // 모바일: Enter(이동) 키 입력 시 키보드 닫기 + 결과 목록으로 스크롤
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.keyCode === 13) {
                    e.preventDefault();
                    el.blur(); // 키보드 닫기
                    // 키보드가 닫히고 나서 스크롤 (300ms 대기)
                    setTimeout(() => {
                        const targetId = searchScrollMap[id];
                        const target = targetId ? document.getElementById(targetId) : null;
                        // 거래처 목록이 숨겨져 있으면 자동 펼치기
                        if (id === 'clientSearch' && !clientListVisible) {
                            clientListVisible = true;
                            if (target) target.style.display = 'block';
                            const tb = document.getElementById('clientToggleBtn');
                            if (tb) tb.textContent = '숨기기';
                            renderClients();
                        }
                        // 정산 목록이 숨겨져 있으면 자동 펼치기
                        if (id === 'settleSearch' && !settleListVisible) {
                            settleListVisible = true;
                            if (target) target.style.display = 'block';
                            const sb = document.getElementById('settleToggleBtn');
                            if (sb) sb.textContent = '숨기기';
                        }
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }, 300);
                }
            });
        }
    });
    // 거래처 목록 초기 display 상태 동기화 (clientListVisible 기본값 false에 맞춤)
    const clInit = document.getElementById('clientList');
    const tbInit = document.getElementById('clientToggleBtn');
    if (clInit) clInit.style.display = clientListVisible ? 'block' : 'none';
    if (tbInit) tbInit.textContent = clientListVisible ? '숨기기' : '보이기';
    // 초기 렌더
    renderDashboard();
    updateInfoCounts();
    updateItemDatalist();
    // 워크스페이스 ID 복원 및 잠금 UI 적용
    const savedWs  = localStorage.getItem('workspaceId');
    const isLocked = localStorage.getItem('wsLocked') === '1';
    // 잠금 상태면 input 값을 localStorage에서 복원 (applyWsLockUI 내부에서도 처리하지만 안전망)
    if (savedWs) {
        document.getElementById('workspaceId').value = savedWs;
    }
    applyWsLockUI(); // 잠금 여부와 무관하게 항상 UI 동기화
    // 자동 재연결: workspaceId가 저장돼 있으면 연결 시도
    if (savedWs) {
        waitFirebase(() => {
            _doConnect(savedWs, true);
            // 공유 워크스페이스 거래처 캐시 로드
            _loadSharedClientsFromWs();
            // 내 sharedClients를 Firebase에 즉시 반영 (앱 시작 시 동기화)
            // _normalizeMySharedClients: 혹시 남아있는 객체 구조를 string[]으로 정규화
            const myShared = _normalizeMySharedClients(_getMySharedClients());
            if (myShared.length) localStorage.setItem('mySharedClients', JSON.stringify(myShared));
            firebase.database().ref(`workspaces/${savedWs}/sharedClients`)
                .set(myShared.length ? myShared : []).catch(() => {});
        });
    }
    // 자동 백업 체크
    setTimeout(checkAutoBackup, 2000);
    // ★ v114: 앱 시작 시 오프라인 큐 배지 복원
    if (typeof _updateSharedQueueBadge === 'function') _updateSharedQueueBadge();
    if (typeof _updateDeadQueueBadge   === 'function') _updateDeadQueueBadge();
    // 백업 저장 위치 복원
    loadBackupDir();
    // 네트워크 끊김/복구 감지
    // ※ .info/connected 리스너가 Firebase 소켓 수준 감지를 담당
    //   window.online/offline은 .info/connected가 미동작하는 엣지 케이스 보완용으로 유지
    window.addEventListener('online', () => {
        diagLog('🌐 브라우저 온라인 감지');
        const sid = localStorage.getItem('workspaceId');
        if (workspaceRef) {
            // ★ v99 fix: window.online은 .info/connected의 보완 역할
            // 실제 로컬↔서버 판단은 .info/connected 핸들러가 담당하므로
            // 여기서는 isConnected 상태만 확인 후 debouncedSync에 위임
            // (직접 update()로 전체 map을 올리면 delta 로직·version 필드가 무력화됨)
            if (!isConnected) {
                // .info/connected 리스너가 아직 반응 전인 경우만 보완 처리
                _withTimeout(workspaceRef.get(), 10000, 'online.get').then(snap => {
                    const d = snap.val();
                    isConnected = true;
                    setSyncStatus('online');
                    const serverTime = d?.lastUpdated ? new Date(d.lastUpdated).getTime() : 0;
                    const lastLocalMs = (() => {
                        const s = localStorage.getItem('lastLocalUpdated');
                        return s ? new Date(s).getTime() : 0;
                    })();
                    const localTime = Math.max(_localWriteTime, lastLocalMs);
                    if (localTime > serverTime) {
                        // 로컬이 최신 → debouncedSync에 위임 (delta + version 포함)
                        debouncedSync();
                    } else if (d) {
                        // 서버가 최신 → _fbValueHandler 경유 (CRM·공유납품 보호 로직 포함)
                        _fbValueHandler(snap);
                    }
                }).catch(e => { diagLog('⚠️ online 핸들러 조회 실패', String(e && e.message || e)); debouncedSync(); });
            }
        } else {
            if (sid) {
                document.getElementById('workspaceId').value = sid;
                waitFirebase(() => _doConnect(sid, true));
            }
        }
    });
    window.addEventListener('offline', () => {
        diagLog('📴 브라우저 오프라인 감지');
        // .info/connected 리스너가 주 처리 담당 — 여기서는 즉각 UI 반영만
        if (isConnected) {
            isConnected = false;
            debouncedSync.cancel();
            setSyncStatus('error');
        }
    });
    applyAutoDeductUI();
    // 재고 탭 날짜 인풋 초기값 설정
    const sdInit = document.getElementById('stockViewDate');
    if (sdInit) sdInit.value = todayKST();
    initSystemTheme();
    updateNavBadges();

    // ─── PWA 설치 프롬프트 ───
    let _pwaInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        _pwaInstallPrompt = e;
        // 설치 안내 배너 표시
        const banner = document.createElement('div');
        banner.id = 'pwaBanner';
        banner.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
            'width:calc(100% - 32px);max-width:488px;' +
            'background:linear-gradient(135deg,#4e54c8,#6c63ff);color:#fff;' +
            'border-radius:14px;padding:13px 16px;display:flex;align-items:center;' +
            'justify-content:space-between;gap:10px;z-index:9999;' +
            'box-shadow:0 4px 20px rgba(108,99,255,.5);font-size:13px;font-weight:700;';
        banner.innerHTML =
            '<span>📲 홈화면에 앱으로 추가할 수 있습니다</span>' +
            '<div style="display:flex;gap:8px;flex-shrink:0;">' +
            '<button onclick="installPWA()" style="background:#fff;color:#6c63ff;border:none;border-radius:8px;padding:7px 14px;font-weight:900;font-size:12px;cursor:pointer;">설치</button>' +
            '<button onclick="document.getElementById(\'pwaBanner\').remove()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:7px 10px;font-size:12px;cursor:pointer;">✕</button>' +
            '</div>';
        document.body.appendChild(banner);
        // 10초 후 자동 숨김
        setTimeout(() => banner?.remove(), 10000);
    });

    window.installPWA = async function() {
        if (!_pwaInstallPrompt) return;
        _pwaInstallPrompt.prompt();
        const { outcome } = await _pwaInstallPrompt.userChoice;
        _pwaInstallPrompt = null;
        document.getElementById('pwaBanner')?.remove();
        if (outcome === 'accepted') toast('✅ 홈화면에 추가되었습니다!', 'var(--green)');
    };

    // 이미 설치된 경우 (standalone 모드)
    if (window.matchMedia('(display-mode: standalone)').matches) {
        console.log('PWA 모드로 실행 중');
    }
});

// ═══════════════════════════════════════
// ── 메모 모아보기 ─────────────────────────────────────────────
// ═══════════════════════════════════════
let _memoViewUnit   = 'cycle'; // 'cycle' | 'week' | 'month'
let _memoViewOffset = 0;       // 오늘 기준 n주/월 전후
let _memoDetailClient = '';    // 상세 팝업에 표시 중인 거래처명

function openMemoView() {
    _memoViewOffset = 0;
    document.getElementById('memoViewPopup').classList.add('open');
    if (!_modalHistoryPushed) { history.pushState({ modalOpen: true }, ''); _modalHistoryPushed = true; }
    renderMemoView();
}
function closeMemoView() {
    document.getElementById('memoViewPopup').classList.remove('open');
}

function setMemoUnit(unit, btn) {
    _memoViewUnit   = unit;
    _memoViewOffset = 0;
    document.querySelectorAll('.memo-unit-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderMemoView();
}

function moveMemoViewPeriod(dir) {
    _memoViewOffset += dir;
    renderMemoView();
}

function _getMemoViewRange() {
    const fmt = d => {
        const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
        return `${y}-${m}-${dd}`;
    };
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
    // todayKST()로 정확한 KST 날짜 구함 (기기 시간대 무관)
    const todayStr = todayKST();
    const today = new Date(todayStr + 'T00:00:00');

    if (_memoViewUnit === 'month') {
        const d    = new Date(today.getFullYear(), today.getMonth() + _memoViewOffset, 1);
        const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const pad  = n => String(n).padStart(2,'0');
        const start = `${d.getFullYear()}-${pad(d.getMonth()+1)}-01`;
        const end   = `${endD.getFullYear()}-${pad(endD.getMonth()+1)}-${pad(endD.getDate())}`;
        const label = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
        return { start, end, label };

    } else if (_memoViewUnit === 'cycle') {
        // 납품 주기: 오늘(+offset일) 기준 두 날짜 반환
        // 월/화/수 → D-7, D-4 / 목/금/토 → D-7, D-3
        const base = addDays(today, _memoViewOffset);
        const dow  = base.getDay(); // 0=일,1=월...6=토
        const gap  = (dow >= 4 && dow <= 6) ? 3 : 4; // 목·금·토=3, 나머지=4
        const d1   = addDays(base, -7);
        const d2   = addDays(base, -gap);
        const dayNames = ['일','월','화','수','목','금','토'];
        const shortFmt = d => `${d.getMonth()+1}/${d.getDate()}(${dayNames[d.getDay()]})`;
        const label = `${shortFmt(d1)}, ${shortFmt(d2)} 메모`;
        return { dates: [fmt(d1), fmt(d2)], label, base: fmt(base) };

    } else {
        // 주단위: 월요일 기준
        const day    = today.getDay();
        const monday = new Date(today);
        monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + _memoViewOffset * 7);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const label = `${monday.getMonth()+1}/${monday.getDate()}(월) ~ ${sunday.getMonth()+1}/${sunday.getDate()}(일)`;
        return { start: fmt(monday), end: fmt(sunday), label };
    }
}

async function deleteAllMemoInView() {
    const range = _getMemoViewRange();
    const targets = (orders || []).filter(o => {
        if (!o.note || !o.note.trim()) return false;
        if (range.dates) return range.dates.includes(o.date);
        return o.date >= range.start && o.date <= range.end;
    });
    if (!targets.length) return toast('삭제할 메모가 없습니다', 'var(--text3)');
    const clientNames = [...new Set(targets.map(o => o.clientName))].join(', ');
    if (!await customConfirm(`📋 현재 기간의 메모 ${targets.length}건을 모두 삭제할까요?\n\n대상: ${clientNames}`)) return;
    const now = new Date().toISOString();
    targets.forEach(o => { o.note = ''; o.notePriority = 2; o.updatedAt = now; });
    _saveAndFlush();
    renderMemoView();
    renderOrders();
    toast(`🗑️ 메모 ${targets.length}건 삭제됨`, 'var(--text3)');
}

function renderMemoView() {
    const range = _getMemoViewRange();
    document.getElementById('memoViewPeriodLabel').textContent = range.label;

    // cycle 모드: 두 날짜 / 그 외: start~end 범위
    const filtered = (orders || []).filter(o => {
        if (!o.note || !o.note.trim()) return false;
        if (range.dates) return range.dates.includes(o.date);
        return o.date >= range.start && o.date <= range.end;
    });

    const groups = {};
    filtered.forEach(o => {
        if (!groups[o.clientName]) groups[o.clientName] = [];
        groups[o.clientName].push(o);
    });

    const list = document.getElementById('memoViewClientList');
    if (!Object.keys(groups).length) {
        list.innerHTML = `<div style="text-align:center;padding:36px 0;color:var(--text3);font-size:14px;">📭 이 기간에 메모가 없습니다</div>`;
        return;
    }

    list.innerHTML = Object.entries(groups)
        .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
        .map(([name, ords]) => {
            const cnt     = ords.length;
            const preview = ords[0].note.length > 24 ? ords[0].note.slice(0, 24) + '…' : ords[0].note;
            const safeNameHtml = escapeHtml(name);
            const safeNameAttr = escapeAttr(name);
            return `<div class="memo-view-client-card priority-${memoPriorityLevel(ords[0])}" onclick="openMemoDetail('${safeNameAttr}')">
                <div class="memo-view-client-name">${safeNameHtml} <span class="memo-count-badge">${cnt}건</span></div>
                <div class="memo-view-preview">${escapeHtml(preview)}</div>
            </div>`;
        }).join('');
}

function openMemoDetail(clientName) {
    const range = _getMemoViewRange();
    _memoDetailClient = clientName;

    const ords = (orders || [])
        .filter(o => {
            if (o.clientName !== clientName || !o.note || !o.note.trim()) return false;
            if (range.dates) return range.dates.includes(o.date);
            return o.date >= range.start && o.date <= range.end;
        })
        .sort((a, b) => (b.date||"").localeCompare(a.date||""));

    document.getElementById('memoDetailTitle').textContent = `📋 ${clientName}`;
    document.getElementById('memoDetailPeriodLabel').textContent = range.label;

    document.getElementById('memoDetailList').innerHTML = ords.length
        ? ords.map(o => {
            const paidBadge = o.isPaid ? '✅ 완납' : '🔴 미수';
            const amount    = o.total ? `${o.total.toLocaleString()}원 · ${paidBadge}` : '';
            return `<div class="memo-detail-item priority-${memoPriorityLevel(o)}" id="mdi-${o.id}">
                <div class="memo-detail-header">
                    <div class="memo-detail-date">📅 ${o.date}</div>
                    <button class="memo-delete-btn" onclick="deleteMemoById('${o.id}')" title="메모 삭제">🗑️</button>
                </div>
                <div class="memo-detail-text">${escapeHtml(o.note)}</div>
                ${amount ? `<div class="memo-detail-amount">${amount}</div>` : ''}
            </div>`;
        }).join('')
        : `<div style="text-align:center;padding:36px 0;color:var(--text3);font-size:14px;">📭 메모가 없습니다</div>`;

    document.getElementById('memoDetailPopup').classList.add('open');
    if (!_modalHistoryPushed) { history.pushState({ modalOpen: true }, ''); _modalHistoryPushed = true; }
}

async function deletePrevMemo(orderId) {
    const o = orders.find(x => x.id === orderId);
    if (!o || !o.note) return;
    if (!await customConfirm(`📅 ${o.date} 이전 메모를 삭제할까요?\n\n"${o.note}"`)) return;
    o.note = '';
    o.notePriority = 2;
    o.updatedAt = new Date().toISOString();
    _markDirtyOrder(o.id);
    _saveAndFlush();
    renderOrders();
    toast('🗑️ 이전 메모 삭제됨', 'var(--text3)');
}

async function deleteMemoById(orderId) {
    const o = orders.find(x => x.id === orderId);
    if (!o) return;
    if (!await customConfirm(`📅 ${o.date} 메모를 삭제할까요?\n\n"${o.note}"`)) return;

    o.note = '';
    o.notePriority = 2;
    o.updatedAt = new Date().toISOString();
    _markDirtyOrder(o.id);
    _saveAndFlush();
    toast('🗑️ 메모 삭제됨', 'var(--text3)');

    // 현재 항목 제거 (애니메이션)
    const el = document.getElementById(`mdi-${orderId}`);
    if (el) {
        el.style.transition = 'opacity .25s, max-height .3s';
        el.style.opacity = '0';
        el.style.overflow = 'hidden';
        el.style.maxHeight = el.offsetHeight + 'px';
        setTimeout(() => { el.style.maxHeight = '0'; el.style.marginBottom = '0'; }, 10);
        setTimeout(() => {
            el.remove();
            // 남은 항목 없으면 목록 탭에도 반영
            const list = document.getElementById('memoDetailList');
            if (!list.querySelector('.memo-detail-item')) {
                list.innerHTML = `<div style="text-align:center;padding:36px 0;color:var(--text3);font-size:14px;">📭 메모가 없습니다</div>`;
                // 메모 목록 뷰도 갱신
                renderMemoView();
            }
        }, 320);
    }

    // 납품 내역 카드 메모 버튼도 갱신
    renderOrders();
}

function closeMemoDetail() {
    document.getElementById('memoDetailPopup').classList.remove('open');
}

// 메모 팝업
// ═══════════════════════════════════════
let _memoTargetId = null;
let _memoPriority = 2; // 1=낮음 2=보통(기본) 3=높음

function openMemoPopup(orderId) {
    const foundMemo = _findOrderAnywhere(orderId);
    if (!foundMemo) return;
    const o = foundMemo.order;
    _memoTargetId = orderId;
    document.getElementById('memoPopupClient').textContent = o.clientName || '';
    document.getElementById('memoTextarea').value = o.note || '';
    _memoPriority = memoPriorityLevel(o);
    _renderMemoPriorityButtons();
    document.getElementById('memoPopup').classList.add('open');
    setTimeout(() => document.getElementById('memoTextarea').focus(), 120);
}
function setMemoPriority(level) {
    _memoPriority = level;
    _renderMemoPriorityButtons();
}
function _renderMemoPriorityButtons() {
    const row = document.getElementById('memoPriorityRow');
    if (!row) return;
    row.querySelectorAll('.memo-priority-btn').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.level) === _memoPriority);
    });
}
function closeMemoPopup() {
    document.getElementById('memoPopup').classList.remove('open');
    _memoTargetId = null;
}
async function saveMemoPopup() {
    if (!_memoTargetId) return;
    const foundMemoSave = _findOrderAnywhere(_memoTargetId);
    if (!foundMemoSave) return;
    const o = foundMemoSave.order;
    const text = document.getElementById('memoTextarea').value.trim();
    const priority = _memoPriority || 2;
    if (foundMemoSave.isShared) {
        const ok = await _patchSharedOrder(foundMemoSave.sharedWsId, _memoTargetId, { note: text, notePriority: priority });
        if (ok) {
            closeMemoPopup();
            renderOrders();
            toast(text ? '📝 메모 저장됨' : '🗑️ 메모 삭제됨', 'var(--accent)');
        }
    } else {
        o.note = text;
        o.notePriority = priority;
        o.updatedAt = new Date().toISOString();
        _markDirtyOrder(o.id);
        _saveAndFlush();
        closeMemoPopup();
        renderOrders();
        renderDashboard();
        updateInfoCounts();
        updateNavBadges();
        _refreshUnpaidIfActive();
        toast(text ? '📝 메모 저장됨' : '🗑️ 메모 삭제됨', 'var(--accent)');
    }
}

// ═══ 거래처 카드 툴팁 토글 ═══
function toggleClientTooltip(e, card) {
    // 버튼(수정/삭제/전화/납품) 클릭 시 툴팁 무시
    if (e.target.closest('button,a')) return;
    const tooltip = card.querySelector('.client-tooltip');
    if (!tooltip) return;
    // 다른 열린 툴팁 먼저 닫기
    document.querySelectorAll('.client-card.show-tooltip').forEach(el => {
        if (el !== card) el.classList.remove('show-tooltip');
    });
    card.classList.toggle('show-tooltip');
    e.stopPropagation();
}
// 외부 클릭 시 툴팁 닫기

// ─── 핀치줌 / 더블탭 줌 완전 차단 ───
// (Android Chrome은 viewport user-scalable=no를 무시하므로 JS로 강제 차단)
// ★ v109 fix: CSS touch-action을 manipulation → pan-x pan-y로 변경(style.css)해
//   더블탭줌·핀치줌 모두 1차로 CSS 레벨에서 차단. 아래 JS는 보조 안전장치.
//   (manipulation은 핀치줌을 허용하는 값이라 단독으로는 간헐적 확대가 새어나갈 수 있었음)
(function preventZoom() {
    // 핀치줌 차단 (멀티터치)
    document.addEventListener('touchstart', e => {
        if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // gesturestart 차단 (iOS Safari 핀치줌)
    document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });

    // Ctrl+휠 줌 차단 (데스크탑/키보드 연결 시)
    document.addEventListener('wheel', e => {
        if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
})();

// ─── 정산 테이블 헤더 고정 스크롤 감지 ───
// 첫 번째 데이터 행이 화면 상단에 닿으면 thead sticky 활성화
// 위로 스크롤해서 테이블 위 영역이 보이면 sticky 해제 → 검색창 접근 가능
(function initSettleTablePin() {
    const mainContent = document.getElementById('mainContent');
    if (!mainContent) return;
    mainContent.addEventListener('scroll', () => {
        const st = document.getElementById('settlementTable');
        if (!st || st.style.display === 'none') return;
        const wrap = st.querySelector('.settle-table-wrap');
        const tbody = st.querySelector('tbody');
        const firstRow = tbody ? tbody.querySelector('tr') : null;
        if (!wrap || !firstRow) { st.classList.remove('thead-pinned'); return; }
        // 첫 번째 데이터 행의 상단이 화면 상단(0)보다 위로 올라가면 헤더 고정
        const firstRowTop = firstRow.getBoundingClientRect().top;
        if (firstRowTop <= 0) {
            st.classList.add('thead-pinned');
        } else {
            st.classList.remove('thead-pinned');
        }
    }, { passive: true });
})();
// 자주 껐다 켜는 환경에서 debounce 대기 중 종료로 인한 데이터 유실 방지
let _flushSyncInProgress = false; // ★ v113: 중복 실행 방지

async function _flushSync() {
    if (!workspaceRef || !isConnected) { diagLog('⏭ flushSync 스킵', `workspaceRef=${!!workspaceRef}, isConnected=${isConnected}`); return; }
    // ★ v99 fix: debouncedSync 업로드 진행 중이면 충돌 방지를 위해 건너뜀
    // (visibilitychange hidden 시 debouncedSync와 동시 실행 race condition 차단)
    if (_syncGuard) { diagLog('⏭ flushSync 스킵', '_syncGuard 진행 중'); return; }
    // ★ v113 fix: flushSync 이미 진행 중이면 중복 실행 방지
    if (_flushSyncInProgress) { diagLog('⏭ flushSync 스킵', '이미 진행 중'); return; }
    // ★ v122 fix: CRM 조회를 위해 await가 생기면서, 아래 가드 세팅이 늦어지면 그 사이(await 중)
    // flushSync가 다시 호출됐을 때 위 가드를 통과해버려 중복 실행될 수 있었음(v113 fix가 무력화됨).
    // → 어떤 await보다 먼저, 동기 구간에서 즉시 선점한다.
    _flushSyncInProgress = true;
    // ★ v123 fix: 가드 선점 이후 ~ 업로드 시작 전까지(동기 계산 + CRM await) 구간에서
    // 예기치 못한 예외가 발생하면 아래 finally 없이는 _flushSyncInProgress가 영구히 true로 남아
    // 이후 모든 flushSync가 계속 스킵되는 위험이 있었음(가드를 최상단으로 당기며 새로 생긴 여지).
    // → try/catch로 감싸 어떤 경로로 실패하든 가드를 반드시 해제하도록 보강.
    try {
    const ch = dataHash(clients);
    const oh = dataHash(orders);
    const ph = dataHash(prices);
    const sh = dataHash(stockItems);
    let changed = false;
    let ordersChanged = false; // ★ v122: orders는 orders/{id} 경로별 키로 기록되므로 별도 플래그로 추적
    const updates = {};
    if (ch !== lastHash.clients) { updates.clients    = clients.map(_minifyClient); changed = true; }
    if (oh !== lastHash.orders)  {
        // ★ v122 fix: orders 노드 전체 덮어쓰기(updates.orders = {...}) 대신 건별 경로 병합으로 변경.
        // 기존엔 내 로컬 orders 스냅샷으로 서버의 orders 노드 전체를 교체했기 때문에,
        // 공유거래처 대납으로 상대방이 내 워크스페이스에 직접 써넣은 전표가
        // 아직 내 로컬에 실시간 반영되지 않은 타이밍에 이 저장이 실행되면 통째로 삭제됐음.
        // 경로별(orders/{id}) 업데이트는 언급되지 않은 항목(=아직 못 받은 대납 전표 등)을 건드리지 않는다.
        //
        // ★ v122 fix2: CRM 결제 필드 보존 — debouncedSync와 달리 flushSync는 서버 값을 조회하지 않고
        // 로컬 스냅샷을 그대로 올려서, CRM이 방금 기록한 결제 정보(crmControlled)가 아직 내 로컬에
        // 반영되기 전 타이밍에 이 저장이 실행되면 CRM 값이 로컬의 stale 값으로 덮여버렸음(설계 원칙 위반).
        // → 짧은 타임아웃으로 서버 orders를 조회해 병합, 조회 실패 시엔 병합 없이 진행(속도 우선, 기존 동작 유지).
        let serverOrdersForCrm = null;
        try {
            const snap = await _withTimeout(workspaceRef.child('orders').once('value'), 3000, 'flushSync.orders.once(crm)');
            serverOrdersForCrm = snap ? snap.val() : null;
        } catch (e) {
            diagLog('⚠️ flushSync CRM 조회 실패(병합 없이 진행)', String(e && e.message || e));
        }
        // ★ await 중 isConnected가 끊겼으면 여기서 중단 (가드 해제 후 재시도는 다음 트리거에서)
        if (!isConnected) { diagLog('⚡ flushSync 중단', 'CRM 조회 중 연결 끊김'); _flushSyncInProgress = false; return; }
        orders.forEach(o => {
            const m = _minifyOrder(o);
            if (serverOrdersForCrm && serverOrdersForCrm[o.id]) _mergeCrmPaymentFields(m, serverOrdersForCrm[o.id]);
            updates['orders/' + o.id] = m;
        });
        _deletedOrders.forEach(id => { updates['orders/' + id] = null; });
        _clearOrderDelta();
        changed = true;
        ordersChanged = true;
    }
    if (ph !== lastHash.prices)  { updates.prices     = prices;     changed = true; }
    if (sh !== lastHash.stock)   { updates.stockItems = _getLightStock(); changed = true; }
    if (!changed) { diagLog('⏭ flushSync 스킵', '변경사항 없음'); _flushSyncInProgress = false; return; }
    const nowIso = new Date().toISOString();
    updates.lastUpdated = nowIso;
    updates.writtenBy   = SESSION_ID;
    // ★ v99 fix: version 필드 포함 — _fbValueHandler의 stale 감지가 flushSync echo도 올바르게 처리
    updates.version = Date.now();
    localStorage.setItem('ws_version', String(updates.version));
    if (updates.clients)    lastHash.clients = ch;
    if (ordersChanged)      lastHash.orders  = oh;
    if (updates.prices)     lastHash.prices  = ph;
    if (updates.stockItems) lastHash.stock   = sh;
    debouncedSync.cancel(); // 대기 중인 debounce 취소 (중복 방지)
    diagLog('🔵 flushSync 시작', '백그라운드 진입 직전 비상 저장');
    // ★ v117: isConnected 끊김 감지 시 즉시 abort — 5초 대기 없이 hash 롤백 후 복귀 시 재시도
    const _flushAbortCheck = setInterval(() => {
        if (!isConnected && _flushSyncInProgress) {
            clearInterval(_flushAbortCheck);
            _flushSyncInProgress = false;
            diagLog('⚡ flushSync 조기 중단', 'isConnected=false 감지 → hash 롤백');
            if (updates.clients)    lastHash.clients = '';
            if (ordersChanged)      lastHash.orders  = '';
            if (updates.prices)     lastHash.prices  = '';
            if (updates.stockItems) lastHash.stock   = '';
        }
    }, 300);
    _withTimeout(workspaceRef.update(updates), 5000, 'flushSync.update').then(() => {
        clearInterval(_flushAbortCheck);
        _flushSyncInProgress = false;
        diagLog('✅ flushSync 성공');
        localStorage.setItem('lastLocalUpdated', nowIso);
    }).catch(e => {
        clearInterval(_flushAbortCheck);
        _flushSyncInProgress = false;
        diagLog('❌ flushSync 실패', String(e && e.message || e));
        // 롤백 — 다음 실행 시 재시도
        if (updates.clients)    lastHash.clients = '';
        if (ordersChanged)      lastHash.orders  = '';
        if (updates.prices)     lastHash.prices  = '';
        if (updates.stockItems) lastHash.stock   = '';
    });
    } catch (e) {
        // ★ v123 fix: 업로드 시작 전 동기/await 계산 구간에서 예기치 못한 예외 발생 시 가드 해제
        _flushSyncInProgress = false;
        diagLog('❌ flushSync 예외', String(e && e.message || e));
    }
}

// 화면 꺼짐 / 다른 앱으로 전환 시
let _bgHiddenAt = 0; // ★ v106 fix: 백그라운드 진입 시각 (장시간 백그라운드 판단용)

// ★ v106 fix: Firebase 소켓 강제 새로고침
// 백그라운드 중 OS가 웹소켓을 조용히 끊어버려도 JS는 isConnected=true로 착각하는
// "좀비 연결" 상태를 해소하기 위해 의도적으로 끊었다 재연결시킴
function _refreshSocket() {
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length || !workspaceRef) return;
    diagLog('🔄 소켓 강제 새로고침 시작', 'goOffline → goOnline');
    _intentionalDisconnect = true; // ★ v110: 이 직후 발생할 끊김은 "오류"가 아니라 자가진단임을 표시
    try {
        firebase.database().goOffline();
        setTimeout(() => {
            firebase.database().goOnline();
            // ★ v117: 소켓 복구 후 2초 대기 — 안정화 후 write (600ms는 너무 빨라 타임아웃 빈발)
            setTimeout(() => { if (isConnected) debouncedSync(); }, 2000);
            // ★ v110: 일정 시간 후 플래그 해제. 그때까지도 재연결 안 됐다면 진짜 문제이므로
            // 정상적으로 오류 상태를 표시 (자가진단 뒤에 숨겨 영영 안 보이는 일 방지)
            setTimeout(() => {
                if (_intentionalDisconnect) {
                    _intentionalDisconnect = false;
                    if (!isConnected) setSyncStatus('error');
                }
            }, 3000);
        }, 300);
    } catch(e) {
        diagLog('⚠️ 소켓 새로고침 실패', String(e && e.message || e));
        _intentionalDisconnect = false;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        _bgHiddenAt = Date.now();
        diagLog('🙈 백그라운드 진입', `isConnected=${isConnected}, _syncGuard=${_syncGuard}`);
        _flushSync();
    } else {
        const wasHiddenMs = _bgHiddenAt ? (Date.now() - _bgHiddenAt) : 0;
        _bgHiddenAt = 0;
        diagLog('👀 포그라운드 복귀', `백그라운드 ${Math.round(wasHiddenMs/1000)}초, isConnected=${isConnected}, _syncGuard=${_syncGuard}, navigator.onLine=${navigator.onLine}`);
        // ★ v106 fix: 백그라운드 중 죽은 소켓 때문에 _syncGuard가 박제된 경우 강제 해제
        const guardStuck = _syncGuard && _syncGuardSetAt && (Date.now() - _syncGuardSetAt > 15000);
        if (guardStuck) {
            console.warn('[동기화 워치독] _syncGuard 박제 감지 → 강제 해제');
            diagLog('🚨 워치독: _syncGuard 박제 감지 → 강제 해제', `${Math.round((Date.now()-_syncGuardSetAt)/1000)}초간 멈춰있었음`);
            _syncGuard = false;
            setSyncStatus(isConnected ? 'online' : 'error');
        }
        // ★ v106 fix: 10초 이상 백그라운드에 있었거나 가드가 박제됐던 경우
        // isConnected 상태와 무관하게 선제적으로 소켓을 새로고침 (좀비 연결 대비)
        if (wasHiddenMs > 10000 || guardStuck) {
            _refreshSocket();
        }
        // 탭 복귀 시: 실시간 리스너가 살아 있으면 자동 갱신됨 (별도 작업 불필요)
        // 리스너가 없는 경우(오프라인 복귀, 첫 연결 전 등)에만 수동 갱신
        try {
            const listeners = typeof _sharedOrdersListeners !== 'undefined'
                ? _sharedOrdersListeners : {};
            if (isConnected && Object.keys(listeners).length === 0
                && typeof _getSharedWs === 'function' && _getSharedWs().length > 0) {
                _loadSharedClientsFromWs().catch(() => {});
            }
        } catch(e) { /* 초기화 전 호출 무시 */ }
    }
});

// 브라우저 탭 닫기 / PWA 종료 시
window.addEventListener('pagehide', _flushSync);

// ★ v113 fix: 모바일 키보드 올라올 때 포커스된 입력 필드가 가려지는 문제 수정
// visualViewport API를 이용해 키보드가 올라오면 active element를 화면에 보이도록 스크롤
(function() {
    if (!window.visualViewport) return;
    let _vvResizeTimer = null;
    window.visualViewport.addEventListener('resize', () => {
        clearTimeout(_vvResizeTimer);
        _vvResizeTimer = setTimeout(() => {
            const el = document.activeElement;
            if (!el) return;
            const tag = el.tagName;
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
            // 모달 내 필드: 모달 시트 스크롤
            const sheet = el.closest('.modal-sheet');
            if (sheet) {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }
            // 일반 컨텐츠 영역
            const content = el.closest('.content') || el.closest('.pane');
            if (content) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 80);
    });
})();
