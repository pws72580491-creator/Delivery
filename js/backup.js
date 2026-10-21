// ╔══════════════════════════════════════════════════════════════╗
// ║  § 12  백업 & 복원                                                ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── 백업 & 복원 ───
// ─── 백업 저장 위치 (File System Access API + IndexedDB) ───
const _IDB_NAME = 'deliveryProDB';
const _IDB_STORE = 'settings';

function _idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(_IDB_NAME, 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(_IDB_STORE))
                db.createObjectStore(_IDB_STORE);
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

async function _idbPut(key, value) {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(_IDB_STORE, 'readwrite');
        tx.objectStore(_IDB_STORE).put(value, key);
        tx.oncomplete = resolve; tx.onerror = e => reject(e.target.error);
    });
}

async function _idbGet(key) {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(_IDB_STORE, 'readonly');
        const req = tx.objectStore(_IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = e => reject(e.target.error);
    });
}

async function _idbDel(key) {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(_IDB_STORE, 'readwrite');
        tx.objectStore(_IDB_STORE).delete(key);
        tx.oncomplete = resolve; tx.onerror = e => reject(e.target.error);
    });
}

async function loadBackupDir() {
    try {
        const handle = await _idbGet('backupDirHandle');
        if (!handle) return;
        // 읽기 권한 확인 (조용히)
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        backupDirHandle = handle;
        updateBackupDirUI(handle.name, perm === 'granted');
    } catch(e) { /* IndexedDB 미지원 또는 핸들 만료 */ }
}

async function pickBackupDir() {
    if (!('showDirectoryPicker' in window)) {
        toast('❗ 이 브라우저는 폴더 선택을 지원하지 않습니다 (Chrome·Edge 데스크톱 권장)');
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
        backupDirHandle = handle;
        await _idbPut('backupDirHandle', handle);
        updateBackupDirUI(handle.name, true);
        showBackupBanner('✅ 저장 위치 설정 완료: ' + handle.name, 'success');
    } catch(e) {
        if (e.name !== 'AbortError') showBackupBanner('❌ 폴더 선택 실패: ' + e.message, 'error');
    }
}

async function clearBackupDir() {
    backupDirHandle = null;
    try { await _idbDel('backupDirHandle'); } catch(e) {}
    updateBackupDirUI(null, false);
    showBackupBanner('📂 저장 위치가 기본 다운로드 폴더로 초기화되었습니다.', 'success');
}

function updateBackupDirUI(name, granted) {
    const info    = document.getElementById('backupDirInfo');
    const clearBtn= document.getElementById('clearDirBtn');
    const pickBtn = document.getElementById('pickDirBtn');
    if (!info) return;
    if (name) {
        info.innerHTML = `<span style="color:var(--accent);font-weight:700;">📂 ${escapeHtml(name)}</span>`
                       + (granted ? '' : ' <span style="color:var(--orange);font-size:11px;">(권한 재확인 필요)</span>');
        if (clearBtn) clearBtn.style.display = 'inline-flex';
        if (pickBtn)  pickBtn.textContent = '📁 폴더 변경';
    } else {
        info.innerHTML = '<span style="color:var(--text2);">📂 기본 다운로드 폴더</span>';
        if (clearBtn) clearBtn.style.display = 'none';
        if (pickBtn)  pickBtn.textContent = '📁 폴더 선택';
    }
}

async function _writeToDir(handle, filename, jsonStr) {
    // 권한 확인 → 필요 시 재요청
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) !== 'granted') {
        const res = await handle.requestPermission(opts);
        if (res !== 'granted') throw new Error('폴더 쓰기 권한이 거부되었습니다.');
    }
    // Blob을 파일 생성 전에 미리 준비
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    let writable = null;
    try {
        // createWritable()도 try 안에 포함: 실패해도 0 byte 파일 cleanup 가능
        writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        writable = null; // close 성공 표시
        // 쓰기 검증: 실제 파일 크기 확인 (0 byte이면 실패로 처리)
        const written = await fileHandle.getFile();
        if (written.size === 0) throw new Error('파일이 0 byte로 저장됨 — 다운로드로 전환');
    } catch(e) {
        if (writable) { try { await writable.abort(); } catch(_) {} }
        // 0 byte 파일 정리 시도 (Chrome/Edge 지원)
        try { await fileHandle.remove(); } catch(_) {}
        throw e; // 상위에서 다운로드 폴백 처리
    }
}

function loadBackupSchedule() {
    return { day1:parseInt(localStorage.getItem('backupDay1')||'1'), day2:parseInt(localStorage.getItem('backupDay2')||'15') };
}

function saveBackupSchedule() {
    const d1=Math.min(28,Math.max(1,parseInt(document.getElementById('schedDay1').value)||1));
    const d2=Math.min(28,Math.max(1,parseInt(document.getElementById('schedDay2').value)||15));
    localStorage.setItem('backupDay1',d1); localStorage.setItem('backupDay2',d2);
    document.getElementById('schedDay1').value=d1; document.getElementById('schedDay2').value=d2;
    showBackupBanner('✅ 자동 백업 일정 저장 완료 (매월 '+d1+'일 · '+d2+'일)','success');
}

// 가져오기 전 안전 백업: 파일 다운로드 없이 클라우드에만 저장

async function runBackupCloudOnly(label='가져오기전') {
    if (!isConnected || !workspaceRef) return;
    const { dateStr, key } = nowKST();
    const payload= { label, backupDate:dateStr, autoTrigger:false, clients, orders, prices, stockItems,
                     clientsCount:clients.length, ordersCount:orders.length,
                     writtenBy: SESSION_ID };
    await workspaceRef.child('backups').child(key).set(payload);
    const snap=await workspaceRef.child('backups').orderByKey().once('value');
    const keys=Object.keys(snap.val()||{}).sort();
    if (keys.length>10) {
        const del={}; keys.slice(0,keys.length-10).forEach(k=>del[k]=null);
        await workspaceRef.child('backups').update(del);
    }
}

// ★ v164: 백업은 실시간 리스너 범위(workspaces/{id}) 밖인 workspaces/{id}__backups 에 저장한다.
//   예전 위치(workspaces/{id}/backups)에 두면 리스너가 연결·재연결 때마다 백업(최대 10개)까지 함께 내려받아
//   초기 .get() 타임아웃과 느린 재연결의 원인이 될 수 있었다. 새 경로에 쓸 수 없으면 기존 위치로 폴백한다.
function _newBackupRef() {
    const id = localStorage.getItem('workspaceId');
    return id ? firebase.database().ref('workspaces/' + id + BACKUP_NODE_SUFFIX) : null;
}
async function _backupWrite(key, payload) {
    const nref = _newBackupRef();
    if (nref) {
        try { await nref.child(key).set(payload); return nref; }
        catch (e) { console.warn('백업 새 경로 쓰기 실패 → 기존 위치로 폴백:', e && e.message); }
    }
    await workspaceRef.child('backups').child(key).set(payload);
    return workspaceRef.child('backups');
}
// 새 위치 + 기존 위치(아직 이전 전)의 백업을 합쳐서 읽는다 (같은 key면 새 위치 우선)
async function _backupReadAll() {
    const out = {};
    try { const s = await workspaceRef.child('backups').once('value'); Object.assign(out, s.val() || {}); } catch(e) {}
    const nref = _newBackupRef();
    if (nref) { try { const s = await nref.orderByKey().once('value'); Object.assign(out, s.val() || {}); } catch(e) {} }
    return out;
}

async function runBackup(label='수동', autoTrigger=false) {
    const { dateStr, key } = nowKST();
    const payload= { label, backupDate:dateStr, autoTrigger, clients, orders, prices, stockItems,
                     clientsCount:clients.length, ordersCount:orders.length,
                     writtenBy: SESSION_ID };
    // 파일 저장 (지정 폴더 우선 → 다운로드 폴백)
    const filename = `backup_${label}_${key}.json`;
    const jsonStr  = JSON.stringify(payload, null, 2);
    let savedToDir = false;
    if (backupDirHandle) {
        try {
            await _writeToDir(backupDirHandle, filename, jsonStr);
            savedToDir = true;
        } catch(e) {
            console.warn('지정 폴더 저장 실패, 다운로드로 전환:', e.message);
            updateBackupDirUI(backupDirHandle?.name, false);
        }
    }
    if (!savedToDir) {
        try {
            const blob = new Blob([jsonStr], { type:'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a'); a.href=url; a.download=filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch(e) { console.warn('파일 저장 실패(모바일 환경일 수 있음)'); }
    }
    // 클라우드 저장
    if (isConnected && workspaceRef) {
        try {
            const bref = await _backupWrite(key, payload);
            const snap=await bref.orderByKey().once('value');
            const keys=Object.keys(snap.val()||{}).sort();
            if (keys.length>10) {
                const del={}; keys.slice(0,keys.length-10).forEach(k=>del[k]=null);
                await bref.update(del);
            }
        } catch(e) { console.error('클라우드 백업 실패',e); }
    }
    if (autoTrigger) localStorage.setItem('lastAutoBackupDate', todayKST());
    localStorage.setItem('lastBackupDate', dateStr);
    return dateStr;
}

async function runManualBackup() {
    const btn = document.getElementById('manualBackupBtn');
    btn.textContent='⏳ 백업 중...'; btn.disabled=true;
    try {
        const dateStr = await runBackup('수동',false);
        showBackupBanner('✅ 백업 완료! ('+dateStr+')','success');
        if (isConnected) renderBackupTab();
    } catch(e) { showBackupBanner('❌ 백업 실패: '+e.message,'error'); }
    btn.textContent='📦 지금 백업 실행'; btn.disabled=false;
}

async function checkAutoBackup() {
    const todayStr = todayKST();
    const todayDate = new Date(todayStr + 'T12:00:00+09:00');
    const { day1, day2 } = loadBackupSchedule();
    if (todayDate.getDate()!==day1 && todayDate.getDate()!==day2) return;
    const last = localStorage.getItem('lastAutoBackupDate')||'';
    if (last===todayStr) return;
    if (!clients.length && !orders.length) return;
    try { const d=await runBackup('자동',true); showBackupBanner('⏰ 자동 백업 완료! ('+d+')','success'); }
    catch(e) { showBackupBanner('⚠️ 자동 백업 실패 — 수동 백업을 실행하세요','error'); }
}

async function renderBackupTab() {
    const {day1,day2}=loadBackupSchedule();
    document.getElementById('schedDay1').value=day1;
    document.getElementById('schedDay2').value=day2;
    document.getElementById('lastAutoBackup').textContent=localStorage.getItem('lastAutoBackupDate')||'없음';
    if (!isConnected) return;
    const el=document.getElementById('backupList');
    el.innerHTML='<div class="empty"><div class="empty-text">⏳ 로딩 중...</div></div>';
    try {
        const data=await _backupReadAll();
        if (!data||!Object.keys(data).length) { el.innerHTML='<div class="empty"><div class="empty-icon">☁️</div><div class="empty-text">저장된 백업이 없습니다</div></div>'; return; }
        el.innerHTML = Object.entries(data).sort((a,b)=>b[0].localeCompare(a[0])).map(([key,b])=>`
            <div class="backup-item">
                <div>
                    <div class="backup-item-label">${escapeHtml(b.backupDate)}${b.autoTrigger?'<span class="auto-badge">자동</span>':''}${b.label?` <span style="font-size:10px;color:var(--text2);">[${escapeHtml(b.label)}]</span>`:''}</div>
                    <div class="backup-item-meta">거래처 ${b.clientsCount}개 · 전표 ${b.ordersCount}건</div>
                </div>
                <div class="backup-item-actions">
                    <button class="btn-restore" onclick="restoreBackup('${key}')">복원</button>
                    <button class="btn-del-backup" onclick="deleteBackup('${key}')">✕</button>
                </div>
            </div>`).join('');
    } catch(e) { el.innerHTML='<div class="empty"><div class="empty-text">목록 로드 실패</div></div>'; }
}

async function restoreBackup(key) {
    if (!isConnected||!workspaceRef) return toast('❗ Firebase 연결 후 복원 가능합니다');
    if (!await customConfirm('이 백업으로 복원하면 현재 데이터가 덮어씌워집니다. 계속하시겠습니까?')) return;
    try {
        let data = null;
        const _nref = _newBackupRef();
        if (_nref) { try { data = (await _nref.child(key).once('value')).val(); } catch(e) {} }
        if (!data) data = (await workspaceRef.child('backups').child(key).once('value')).val(); // 이전 전 백업
        if (!data) return toast('❗ 백업 데이터를 찾을 수 없습니다');

        // 복원 전 현재 데이터 클라우드 백업 (파일 다운로드 없이 클라우드만)
        try {
            const { dateStr: bDateStr, key: bKey } = nowKST();
            const bPayload={ label:'복원전_자동', backupDate: bDateStr,
                autoTrigger:false, clients, orders, prices, stockItems,
                clientsCount:clients.length, ordersCount:orders.length };
            await _backupWrite(bKey, bPayload);
        } catch(be) { console.warn('복원 전 백업 실패(무시):', be); }

        // ── 리스너 일시 중단 → 복원 데이터가 리스너로 덮어쓰이는 것 방지 ──
        // ★ v120: _workspaceHandler 참조로 정확히 해제 (_connectedRef 리스너는 유지)
        if (typeof _workspaceHandler !== 'undefined' && _workspaceHandler)
            workspaceRef.off('value', _workspaceHandler);
        else workspaceRef.off('value');

        // ── 공통 정규화 함수로 복원 데이터 처리 ──
        const normalized = normalizeBackupData(data);
        const prevOrderIds = orders.map(o => String(o.id)); // ★ v164: 복원 후 사라질 전표를 서버에서도 지우기 위해 보관
        clients    = normalized.clients;
        orders     = normalized.orders;
        if (data.prices)               prices     = data.prices;
        if (normalized.stockItems?.length) stockItems = normalized.stockItems;

        // lastHash 초기화 후 Firebase에 복원 데이터 업로드
        lastHash={clients:'',orders:'',prices:'',stock:''};
        // ★ v114: 복원 시 오프라인 큐 초기화 (구 데이터 잔류 방지)
        ['_sharedOrderQueue','_sharedOrderDeadQueue','_crmPatchFailQueue'].forEach(k => localStorage.removeItem(k));
        if (typeof _updateSharedQueueBadge === 'function') _updateSharedQueueBadge();
        if (typeof _updateDeadQueueBadge   === 'function') _updateDeadQueueBadge();
        saveToLocal();

        // Firebase 즉시 업로드 (debounce 없이)
        const ch=dataHash(clients), oh=dataHash(orders), ph=dataHash(prices), sh=dataHash(stockItems);
        // ★ v164: orders를 배열째 올리면 서버에 0..n 인덱스 키로 저장돼 orders/{id} 방식과 섞이고,
        //   이후 삭제(orders/{id}=null)가 먹지 않거나 같은 전표가 중복되는 문제가 있었음.
        //   → 다른 경로와 동일하게 orders/{id} 로 올리고, 복원으로 사라질 내 전표는 서버에서도 삭제한다.
        //   (서버에만 있는 전표, 예: 공유거래처 대납으로 상대가 써넣은 것은 건드리지 않음)
        const _restoreVersion = Date.now();
        const upd = {
            clients: clients.map(_minifyClient), prices, stockItems,
            lastUpdated: new Date().toISOString(),
            writtenBy: SESSION_ID,
            version: _restoreVersion
        };
        const _newIdSet = new Set(orders.map(o => String(o.id)));
        orders.forEach(o => { _putOrderUpdate(upd, o, _minifyOrder(o)); });
        prevOrderIds.forEach(id => { if (!_newIdSet.has(id)) upd['orders/' + id] = null; });
        await workspaceRef.update(upd);
        localStorage.setItem('ws_version', String(_restoreVersion));
        _clearOrderDelta(); // 복원으로 전체가 서버와 일치 → 이전 추적 정보 폐기
        lastHash={clients:ch, orders:oh, prices:ph, stock:sh};

        // 리스너 재등록 — 공용 _fbValueHandler 사용
        // ★ v120: _workspaceHandler 참조 갱신 후 등록 (중복 방지)
        if (typeof _workspaceHandler !== 'undefined') {
            if (_workspaceHandler) workspaceRef.off('value', _workspaceHandler);
            _workspaceHandler = _fbValueHandler;
        } else {
            workspaceRef.off('value');
        }
        workspaceRef.on('value', _fbValueHandler);

        _fullRender();
        showBackupBanner('✅ 복원 완료! ('+data.backupDate+' 시점)','success');
        renderBackupTab();
        toast('✅ 복원 완료', 'var(--green)');
    } catch(e) { showBackupBanner('❌ 복원 실패: '+e.message,'error'); }
}

async function deleteBackup(key) {
    if (!await customConfirm('이 백업을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.')) return;
    try {
        await workspaceRef.child('backups').child(key).remove(); // 이전 위치
        const _nref = _newBackupRef(); if (_nref) await _nref.child(key).remove(); // 새 위치
        showBackupBanner('🗑️ 삭제 완료','success'); renderBackupTab();
    }
    catch(e) { showBackupBanner('❌ 삭제 실패: '+e.message,'error'); }
}

function showBackupBanner(msg,type) {
    const el=document.getElementById('backupBanner');
    if(!el)return;
    el.textContent=msg; el.className='status-banner '+type;
    clearTimeout(el._t); el._t=setTimeout(()=>{el.className='status-banner';},5000);
}

