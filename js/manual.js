// ╔══════════════════════════════════════════════════════════════╗
// ║  § 16  사용설명서                                                   ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── 경량 Markdown → HTML 렌더러 ───
function _md2html(md) {
    // 코드 블록 보호
    const blocks = [];
    let s = md
        .replace(/```([\s\S]*?)```/g, (_, c) => { blocks.push(c); return `\x02CODE${blocks.length-1}\x02`; })
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 제목
    s = s.replace(/^######\s(.+)$/gm, '<h6>$1</h6>');
    s = s.replace(/^#####\s(.+)$/gm,  '<h5>$1</h5>');
    s = s.replace(/^####\s(.+)$/gm,   '<h4>$1</h4>');
    s = s.replace(/^###\s(.+)$/gm,    '<h3>$1</h3>');
    s = s.replace(/^##\s(.+)$/gm,     '<h2>$2</h2>'.replace('$2','$1'));
    s = s.replace(/^#\s(.+)$/gm,      '<h1>$1</h1>');

    // 테이블
    s = s.replace(/(^\|.+\|\n)+/gm, t => {
        const rows = t.trim().split('\n').filter(r => !/^\|[-| :]+\|$/.test(r.trim()));
        const header = rows.shift();
        const ths = header.split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>`<th>${c.trim()}</th>`).join('');
        const trs = rows.map(r => '<tr>' + r.split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>`<td>${c.trim()}</td>`).join('') + '</tr>').join('');
        return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    });

    // 인용
    s = s.replace(/^&gt;\s(.+)$/gm, '<blockquote>$1</blockquote>');

    // 구분선
    s = s.replace(/^---$/gm, '<hr>');

    // 체크박스
    s = s.replace(/^- \[x\] (.+)$/gm, '<li class="chk done">$1</li>');
    s = s.replace(/^- \[ \] (.+)$/gm, '<li class="chk">$1</li>');

    // 리스트
    s = s.replace(/(^- .+\n?)+/gm, m => '<ul>' + m.replace(/^- (.+)$/gm,'<li>$1</li>') + '</ul>');
    s = s.replace(/(^\d+\.\s.+\n?)+/gm, m => '<ol>' + m.replace(/^\d+\.\s(.+)$/gm,'<li>$1</li>') + '</ol>');

    // 인라인
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g,         '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g,         '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 단락
    s = s.split('\n\n').map(chunk => {
        chunk = chunk.trim();
        if (!chunk) return '';
        if (/^<(h[1-6]|ul|ol|table|blockquote|hr|pre)/.test(chunk)) return chunk;
        return `<p>${chunk.replace(/\n/g,'<br>')}</p>`;
    }).join('\n');

    // 코드 블록 복원
    s = s.replace(/\x02CODE(\d+)\x02/g, (_, i) => {
        const lines = blocks[+i].split('\n');
        const lang = lines[0].trim();
        const code = lines.slice(1).join('\n');
        return `<pre><code${lang ? ` class="lang-${lang}"` : ''}>${code}</code></pre>`;
    });

    return s;
}

// ─── 앱 내 변경이력 추출 (changelog-item 파싱) ───
function _extractChangelog() {
    let md = '\n## 변경이력\n\n';
    // ★ v122 fix: #oldChangelogItems는 #changelogList의 하위요소라 querySelectorAll('#changelogList .changelog-item')만으로
    // 이미 전체(현재 버전 + 접힌 이전 이력)를 포함함. 예전엔 oldChangelogItems를 별도로 한 번 더 순회해서
    // 접힌 이전 버전들이 설명서에 중복으로 나오는 버그가 있었음.
    document.querySelectorAll('#changelogList .changelog-item').forEach(el => {
        const ver  = el.querySelector('.changelog-ver')?.textContent?.trim() || '';
        const desc = el.querySelector('.changelog-desc')?.textContent?.trim() || '';
        if (ver && desc) md += `### ${ver}\n\n${desc}\n\n`;
    });
    return md;
}

// ─── 설명서 모달 열기 ───
async function openManual() {
    const modal   = document.getElementById('manualModal');
    const content = document.getElementById('manualContent');
    const tocEl   = document.getElementById('manualToc');
    const titleEl = document.getElementById('manualTitle');
    if (!modal) return;

    modal.style.display = 'flex';
    titleEl.textContent = '사용설명서 불러오는 중...';
    content.innerHTML   = '<div style="text-align:center;padding:60px 0;color:var(--text3);"><div class="spin" style="width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px;"></div>불러오는 중...</div>';
    tocEl.innerHTML = '';

    let raw = '';
    try {
        const res = await fetch(MANUAL_URL + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        raw = await res.text();
    } catch(e) {
        // GitHub 접근 실패 시 안내 메시지
        content.innerHTML = `
            <div style="padding:24px;text-align:center;color:var(--text2);">
                <div style="font-size:32px;margin-bottom:12px;">📡</div>
                <div style="font-weight:700;margin-bottom:8px;">설명서를 불러올 수 없습니다</div>
                <div style="font-size:13px;margin-bottom:16px;">GitHub에 manual.md가 업로드되지 않았거나 네트워크 문제입니다.</div>
                <code style="font-size:11px;background:var(--surf3);padding:4px 8px;border-radius:4px;word-break:break-all;">${MANUAL_URL}</code>
                <div style="margin-top:20px;font-size:12px;color:var(--text3);">
                    app.js 상단의 <strong>MANUAL_URL</strong>을 GitHub raw 주소로 수정하세요.
                </div>
            </div>`;
        titleEl.textContent = '사용설명서';
        return;
    }

    // <!-- CHANGELOG_AUTO --> 자리에 앱 내 변경이력 주입
    raw = raw.replace('<!-- CHANGELOG_AUTO -->', _extractChangelog());

    const html = _md2html(raw);

    // 현재 버전 표시 — md2html 변환 후 h1 태그 뒤에 직접 삽입 (이스케이프 문제 방지)
    const curVer = document.querySelector('.changelog-ver[style*="green"]')?.textContent || 'v95';
    const htmlWithVer = html.replace(
        /<h1>([^<]*납품 관리 Pro[^<]*)<\/h1>/,
        `<h1>$1</h1><div style="font-size:12px;color:var(--text3);margin-top:-10px;margin-bottom:6px;">현재 버전: ${curVer}</div>`
    );
    content.innerHTML = `<div class="manual-body">${htmlWithVer}</div>`;

    // ★ PWA 재실행 방지: 앵커 클릭 가로채기 → scrollIntoView로 교체
    content.addEventListener('click', e => {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href || !href.startsWith('#')) return;
        e.preventDefault();
        e.stopPropagation();

        const id = href.slice(1); // '#시작하기' → '시작하기'

        // 1순위: 동적으로 부여된 mh-N id로 직접 탐색
        let target = document.getElementById(id);

        // 2순위: 헤딩 텍스트와 매칭 (한글 앵커)
        if (!target) {
            const normalize = s => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '');
            const needle = normalize(id);
            target = [...content.querySelectorAll('h1,h2,h3,h4,h5,h6')]
                .find(h => h.dataset.slug === needle ||
                           normalize(h.textContent) === needle ||
                           normalize(h.textContent) === id.replace(/-/g, ' '));
        }

        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, true); // capture phase — a 태그보다 먼저 처리

    // 목차 자동 생성 + 헤딩에 한글 슬러그 id 부여
    const headings = content.querySelectorAll('h2, h3');
    if (headings.length) {
        const normalize = s => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '');
        let tocHtml = '<div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px;">목차</div>';
        headings.forEach((h, idx) => {
            h.id = 'mh-' + idx;
            // 한글 앵커 id도 data 속성으로 추가 (클릭 매칭용)
            h.dataset.slug = normalize(h.textContent);
            const indent = h.tagName === 'H3' ? 'padding-left:12px;font-size:12px;color:var(--text3);' : 'font-size:13px;font-weight:700;';
            tocHtml += `<div style="${indent}margin:4px 0;cursor:pointer;" onclick="document.getElementById('mh-${idx}').scrollIntoView({behavior:'smooth'})">${h.textContent.trim()}</div>`;
        });
        tocEl.innerHTML = tocHtml;
    }

    titleEl.textContent = '사용설명서';
}

function closeManual() {
    const modal = document.getElementById('manualModal');
    if (modal) modal.style.display = 'none';
}

