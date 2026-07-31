/* 문제은행 (관리자 전용)

   기출 원문을 다루므로 저작권 통제가 이 화면의 전제다.
     · problems 는 RLS 로 관리자만 읽힌다(0009). 학생 메뉴에 라우트를 넣지 않는다.
     · 문제 이미지는 private 버킷이라 서명 URL 로만 표시한다.
     · 카드에 출처(source_citation)를 항상 노출하고, 내부 전용 문항은 배지로 표시한다.

   수백 문항 규모라 필터는 전부 클라이언트에서 처리한다(조회는 1회). */
import { COGNITIONS, UNITS, WRONG_REASONS } from '../config.js';
import { db, loadContext } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { hydrateSignedPhotos } from '../ui.js';
import { $, esc, r1 } from '../util.js';

const ORIGINS = ['기출', '자체', '변형'];
const STATUSES = ['draft', 'review', 'published', 'retired'];
const STATUS_LABEL = { draft: '작성 중', review: '검토', published: '공개', retired: '보관' };
const STATUS_CLS = { draft: 'gray', review: 'amber', published: 'green', retired: 'gray' };
const BODY_FORMATS = ['latex', 'image', 'mixed'];

// 화면 안에서만 쓰는 필터 상태(탭을 벗어나면 초기화된다)
let pbFilter = { unit: '', cognition: '', difficulty: '', origin: '', status: '', uni: '', q: '' };
let pbEditId = null;   // 수정 중인 문항 id, 'new' 면 신규

/* KaTeX 는 CDN 으로만 들어온다. 없으면 원문을 그대로 보여준다(기능은 계속 동작). */
function renderMath(root){
  if(typeof renderMathInElement !== 'function') return;
  try{
    renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
      ],
      throwOnError: false,
    });
  }catch(e){ console.warn('KaTeX 렌더 실패', e); }
}

/* 문항별 누적 실적: questions.problem_id ↔ scores 로 응시 수·평균 득점률·최다 감점 태그 */
function buildStats(ctx, allScores){
  const qByProblem = {};
  (ctx.questions || []).forEach(q => {
    if(!q.problem_id) return;
    (qByProblem[q.problem_id] = qByProblem[q.problem_id] || []).push(q);
  });
  const qById = {};
  (ctx.questions || []).forEach(q => qById[q.id] = q);

  const out = {};
  Object.keys(qByProblem).forEach(pid => {
    const qids = new Set(qByProblem[pid].map(q => q.id));
    const rows = (allScores || []).filter(s => qids.has(s.question_id));
    if(!rows.length){ out[pid] = { n: 0, rate: null, topTag: null }; return; }
    let earned = 0, pts = 0;
    const tagCount = {};
    rows.forEach(s => {
      const q = qById[s.question_id];
      earned += Number(s.earned) || 0;
      pts += Number(q && q.points) || 0;
      if(s.wrong_reason) tagCount[s.wrong_reason] = (tagCount[s.wrong_reason] || 0) + 1;
    });
    const top = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0];
    out[pid] = { n: rows.length, rate: pts > 0 ? earned / pts * 100 : null, topTag: top ? top[0] : null };
  });
  return out;
}

function matches(p){
  const f = pbFilter;
  if(f.unit && p.unit !== f.unit) return false;
  if(f.cognition && p.cognition !== f.cognition) return false;
  if(f.difficulty && String(p.difficulty || '') !== f.difficulty) return false;
  if(f.origin && p.origin !== f.origin) return false;
  if(f.status && p.status !== f.status) return false;
  if(f.uni && String(p.university_id || '') !== f.uni) return false;
  if(f.q){
    const hay = [p.source_citation, p.body_latex, p.answer_latex, (p.tags || []).join(' '), p.exam_round]
      .filter(Boolean).join(' ').toLowerCase();
    if(!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

async function renderProblems(c){
  if(app.cur.role !== 'admin'){ c.innerHTML = '<p class="muted">권한이 없습니다.</p>'; return; }
  c.innerHTML = '<p class="muted">불러오는 중...</p>';

  const [problems, ctx, allScores] = await Promise.all([
    db.listProblems(), loadContext(), db.listAllScores(),
  ]);
  const stats = buildStats(ctx, allScores);
  const uniById = {};
  ctx.universities.forEach(u => uniById[u.id] = u.name + (u.campus ? '(' + u.campus + ')' : ''));

  const shown = problems.filter(matches);
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label == null ? v : label)}</option>`;

  const filterCard = `<div class="card"><h3>${svg('grid')}필터 <span class="sub">${shown.length} / ${problems.length}문항</span></h3>
    <div class="field" style="margin-bottom:8px"><label>단원</label>
      <select id="pf_unit"><option value="">전체</option>${UNITS.map(u => opt(u, pbFilter.unit)).join('')}</select></div>
    <div class="field" style="margin-bottom:8px"><label>사고과정</label>
      <select id="pf_cog"><option value="">전체</option>${COGNITIONS.map(v => opt(v, pbFilter.cognition)).join('')}</select></div>
    <div class="field" style="margin-bottom:8px"><label>난이도</label>
      <select id="pf_diff"><option value="">전체</option>${[1,2,3,4,5].map(n => opt(n, pbFilter.difficulty, n + '단계')).join('')}</select></div>
    <div class="field" style="margin-bottom:8px"><label>출처 구분</label>
      <select id="pf_origin"><option value="">전체</option>${ORIGINS.map(v => opt(v, pbFilter.origin)).join('')}</select></div>
    <div class="field" style="margin-bottom:8px"><label>상태</label>
      <select id="pf_status"><option value="">전체</option>${STATUSES.map(v => opt(v, pbFilter.status, STATUS_LABEL[v])).join('')}</select></div>
    <div class="field" style="margin-bottom:8px"><label>대학 <span class="muted" style="font-size:11px">(저작권 대응: 대학별 전량 조회)</span></label>
      <select id="pf_uni"><option value="">전체</option>${ctx.universities.map(u => opt(u.id, pbFilter.uni, uniById[u.id])).join('')}</select></div>
    <div class="field" style="margin-bottom:8px"><label>검색 <span class="muted" style="font-size:11px">출처·본문·태그</span></label>
      <input id="pf_q" value="${esc(pbFilter.q)}" placeholder="예: 2024 가천대 / 도형"></div>
    <button class="btn line sm" id="pf_reset">필터 초기화</button>
  </div>`;

  const cards = shown.length ? shown.map(p => {
    const st = stats[p.id] || { n: 0, rate: null, topTag: null };
    const imgs = (p.body_image_paths || []).filter(Boolean);
    return `<div class="card" style="margin-bottom:10px" data-pid="${esc(p.id)}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <div>
          <span class="chip ${STATUS_CLS[p.status] || 'gray'}">${esc(STATUS_LABEL[p.status] || p.status)}</span>
          <span class="chip blue">${esc(p.origin)}</span>
          ${p.license_scope === 'internal' ? '<span class="chip red">내부 전용</span>' : '<span class="chip gray">자체 제작</span>'}
          ${p.parent_id ? '<span class="chip purple">변형</span>' : ''}
        </div>
        <div><button class="btn line sm pb_edit" data-pid="${esc(p.id)}">수정</button>
          ${p.status === 'published' ? `<button class="btn line sm pb_variant" data-pid="${esc(p.id)}">${svg('spark','xs')}변형 생성</button>` : ''}</div>
      </div>
      <div style="margin-top:8px;font-size:13px">
        <b>${esc(p.unit || '-')} · ${esc(p.cognition || '-')}</b>
        <span class="muted"> · 난이도 ${p.difficulty == null ? '-' : esc(p.difficulty)}단계 · 배점 ${p.points == null ? '-' : esc(p.points)}</span>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:2px">출처: ${esc(p.source_citation || '미기재')}${p.university_id && uniById[p.university_id] ? ' · ' + esc(uniById[p.university_id]) : ''}${p.exam_year ? ' · ' + esc(p.exam_year) : ''}${p.exam_round ? ' ' + esc(p.exam_round) : ''}</div>
      ${p.body_latex ? `<div class="pb-body" style="margin-top:8px;padding:8px;background:var(--bg);border-radius:8px;font-size:13px;white-space:pre-wrap">${esc(p.body_latex)}</div>` : ''}
      ${imgs.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${imgs.map(path => `<span data-photo-path="${esc(path)}" data-photo-bucket="problem-images" data-photo-height="90" class="muted" style="font-size:11px">이미지 불러오는 중...</span>`).join('')}</div>` : ''}
      ${(p.tags || []).length ? `<div style="margin-top:6px">${p.tags.map(t => `<span class="chip gray" style="margin-right:4px">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="divider"></div>
      <div class="muted" style="font-size:12px">누적 실적:
        ${st.n ? `응시 <b>${st.n}건</b> · 평균 득점률 <b>${st.rate == null ? '-' : r1(st.rate) + '%'}</b>${st.topTag ? ` · 최다 감점 <span class="chip amber">${esc(st.topTag)}</span>` : ''}`
          : '아직 출제되지 않았습니다.'}</div>
    </div>`;}).join('') : '<p class="muted">조건에 맞는 문항이 없습니다.</p>';

  // 변형 검수 큐(pending) — 승인 전 문항이라 목록 맨 위에 둔다.
  const pendingVariants = await db.listVariants('pending');
  const problemById = {};
  problems.forEach(p => problemById[p.id] = p);
  const reviewCard = pendingVariants.length
    ? `<div class="card" style="border-color:var(--purple)">
        <h3>${svg('spark')}변형 검수 대기 <span class="sub">${pendingVariants.length}건 · 승인해도 곧바로 공개되지 않습니다(검토 상태로 등록)</span></h3>
        ${pendingVariants.map(v => variantCardHTML(v, problemById[v.source_problem_id])).join('')}
      </div>`
    : '';

  c.innerHTML = `<div class="grid2" style="grid-template-columns:280px 1fr;align-items:start">
      <div>${filterCard}
        <button class="btn" id="pb_new" style="width:100%;margin-top:10px">${svg('plus','sm')}문항 등록</button></div>
      <div><div id="pbEdit"></div><div id="pbVariant"></div>${reviewCard}${cards}</div>
    </div>
    <div class="card note-blue">기출 원문은 내부 이용 범위에서만 사용합니다. 이 화면은 관리자 전용이며 학생·학부모 화면에는 노출되지 않습니다. 문항을 지우는 대신 [보관] 상태로 바꾸면 기록과 누적 실적이 보존됩니다.</div>`;

  // 필터 바인딩
  const bind = (id, key) => { const el = $(id); if(el) el.addEventListener('change', () => { pbFilter[key] = el.value; renderProblems(c); }); };
  bind('pf_unit', 'unit'); bind('pf_cog', 'cognition'); bind('pf_diff', 'difficulty');
  bind('pf_origin', 'origin'); bind('pf_status', 'status'); bind('pf_uni', 'uni');
  const q = $('pf_q');
  if(q) q.addEventListener('change', () => { pbFilter.q = q.value.trim(); renderProblems(c); });
  const reset = $('pf_reset');
  if(reset) reset.addEventListener('click', () => { pbFilter = { unit:'', cognition:'', difficulty:'', origin:'', status:'', uni:'', q:'' }; renderProblems(c); });

  c.querySelectorAll('.pb_edit').forEach(b => b.addEventListener('click', () => {
    pbEditId = b.dataset.pid; openEditor(c, problems.find(p => p.id === pbEditId), ctx);
  }));
  const nb = $('pb_new');
  if(nb) nb.addEventListener('click', () => { pbEditId = 'new'; openEditor(c, null, ctx); });

  c.querySelectorAll('.pb_variant').forEach(b => b.addEventListener('click',
    () => openVariantForm(c, problemById[b.dataset.pid])));
  bindVariantReview(c);

  hydrateSignedPhotos(c);
  c.querySelectorAll('.pb-body,.vr-math').forEach(el => renderMath(el));
  if(pbEditId) openEditor(c, pbEditId === 'new' ? null : problems.find(p => p.id === pbEditId), ctx);
}

/* 검수 카드 — 원본과 생성물을 나란히 놓고, 자동 검증 결과를 배지로 보여준다. */
function variantCardHTML(v, src){
  const r = v.raw_response || {};
  const sc = v.self_check || {};
  const checkChip = sc.matches === true
    ? '<span class="chip green">독립 재풀이 일치</span>'
    : sc.matches === false
      ? '<span class="chip red">독립 재풀이 불일치</span>'
      : '<span class="chip amber">독립 재풀이 미검증</span>';
  const methodChip = sc.method === 'code_execution'
    ? '<span class="chip blue">코드 실행 검산</span>'
    : sc.method === 'no_code_execution'
      ? '<span class="chip gray">코드 실행 불가 — 재풀이만</span>' : '';
  return `<div style="border:1px solid var(--line);border-radius:11px;padding:12px;margin-bottom:10px" data-vid="${esc(v.id)}">
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      ${checkChip}${methodChip}
      <span class="chip gray">${esc((v.variation_spec && v.variation_spec.mode) || '-')}</span>
      ${r.changed_summary ? `<span class="muted" style="font-size:11.5px">${esc(r.changed_summary)}</span>` : ''}
    </div>
    <div class="grid2">
      <div>
        <div class="muted" style="font-size:11.5px;font-weight:700;margin-bottom:4px">원본</div>
        <div class="vr-math" style="font-size:12.5px;white-space:pre-wrap;padding:8px;background:var(--bg);border-radius:8px">${esc((src && src.body_latex) || '(원본 없음)')}</div>
        ${src && src.answer_latex ? `<div class="muted" style="font-size:11.5px;margin-top:4px">정답: ${esc(src.answer_latex)}</div>` : ''}
      </div>
      <div>
        <div class="muted" style="font-size:11.5px;font-weight:700;margin-bottom:4px">생성된 변형</div>
        <div class="vr-math" style="font-size:12.5px;white-space:pre-wrap;padding:8px;background:#FBFAFF;border-radius:8px">${esc(r.stem_latex || '(본문 없음)')}</div>
        <div class="muted" style="font-size:11.5px;margin-top:4px">정답: ${esc(r.answer_closed || '-')}</div>
        ${sc.independent_answer ? `<div class="muted" style="font-size:11.5px">재풀이 답: ${esc(sc.independent_answer)}</div>` : ''}
      </div>
    </div>
    ${Array.isArray(r.solution_steps) && r.solution_steps.length
      ? `<details style="margin-top:8px"><summary style="font-size:12px;cursor:pointer">풀이 단계 보기</summary>
          <div class="vr-math" style="font-size:12.5px;white-space:pre-wrap;padding:8px;background:var(--bg);border-radius:8px;margin-top:6px">${esc(r.solution_steps.join('\n'))}</div></details>` : ''}
    ${sc.code_output ? `<details style="margin-top:6px"><summary style="font-size:12px;cursor:pointer">검산 코드·출력 보기</summary>
      <pre style="font-size:11px;white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:8px;margin-top:6px">${esc(String(sc.code_output).slice(0,2000))}</pre></details>` : ''}
    <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <input class="vr_note" placeholder="검수 메모(선택)" style="flex:1;min-width:160px;padding:6px 8px;border:1.5px solid var(--line);border-radius:8px;font-size:12px">
      <button class="btn sm vr_act" data-vid="${esc(v.id)}" data-act="approve">승인</button>
      <button class="btn line sm vr_act" data-vid="${esc(v.id)}" data-act="regenerate">재생성 필요</button>
      <button class="btn danger sm vr_act" data-vid="${esc(v.id)}" data-act="reject">거부</button>
    </div>
    <div class="vr_msg msg"></div>
  </div>`;
}

/* 변형 생성 폼. 키가 없으면 폼 대신 안내만 띄운다. */
async function openVariantForm(c, src){
  const wrap = $('pbVariant');
  if(!wrap || !src) return;
  wrap.innerHTML = '<div class="card"><p class="muted">확인 중...</p></div>';

  if(app.DEMO){
    wrap.innerHTML = '<div class="card"><span class="chip gray">데모 모드 — 변형 생성을 실행하지 않습니다</span></div>';
    return;
  }
  const status = await db.getAiStatus();
  if(!status || !status.configured){
    wrap.innerHTML = '<div class="card"><span class="chip amber">AI 미설정</span>'
      + '<p class="muted" style="font-size:12.5px;margin-top:6px">GEMINI_API_KEY 가 등록되지 않아 변형 생성을 사용할 수 없습니다. [설정] 화면의 AI 상태 카드를 참고하세요.</p>'
      + '<button class="btn line sm" id="vf_close">닫기</button></div>';
    $('vf_close')?.addEventListener('click', () => wrap.innerHTML = '');
    return;
  }

  wrap.innerHTML = `<div class="card" style="border-color:var(--purple)">
    <h3>${svg('spark')}변형 생성 <span class="sub">${esc(src.source_citation || '')}</span></h3>
    <div class="row">
      <div class="field"><label>변형 방식</label><select id="vf_mode">
        <option value="numbers">숫자만 변경(구조 유지)</option>
        <option value="condition">조건 변경</option>
        <option value="difficulty">난이도 조정</option></select></div>
      <div class="field"><label>난이도</label><select id="vf_dd">
        <option value="0">원본 유지</option><option value="1">+1 (어렵게)</option><option value="-1">-1 (쉽게)</option></select></div>
      <div class="field"><label>생성 개수</label><select id="vf_count">
        <option value="1">1개</option><option value="2">2개</option><option value="3">3개</option></select></div>
    </div>
    <div class="field" style="margin-top:8px"><label>조건 변경 설명 <span class="muted" style="font-size:11px">(조건 변경 선택 시)</span></label>
      <input id="vf_note" placeholder="예: 삼각형을 사각형으로 바꾸고 둘레 조건을 추가"></div>
    <div class="muted" style="font-size:11.5px;margin-top:8px">생성 후 정답을 두 번 계산해 비교하고, 별도로 한 번 더 풀어 검산합니다. 어긋나면 자동 폐기되어 검수 목록에 올라오지 않습니다. 통과한 것도 <b>강사 승인</b>이 있어야 문제은행에 들어갑니다.</div>
    <div style="margin-top:8px"><button class="btn" id="vf_go">생성</button> <button class="btn line" id="vf_cancel">닫기</button></div>
    <div id="vf_msg" class="msg"></div>
  </div>`;

  $('vf_cancel').addEventListener('click', () => wrap.innerHTML = '');
  $('vf_go').addEventListener('click', async () => {
    const m = $('vf_msg'); m.className = 'msg'; m.textContent = '';
    const btn = $('vf_go'); btn.disabled = true;
    m.textContent = '생성 중... 문항당 3~4회 호출이라 30초 이상 걸릴 수 있습니다.';
    try{
      const r = await db.generateVariant(src.id, {
        mode: $('vf_mode').value,
        note: $('vf_note').value.trim() || null,
        difficulty_delta: Number($('vf_dd').value) || 0,
      }, Number($('vf_count').value) || 1);
      const pend = r.pending || 0, disc = r.discarded || 0;
      m.className = 'msg ok';
      m.textContent = `검수 대기 ${pend}건` + (disc ? ` · 자동 폐기 ${disc}건(정답 검증 실패)` : '');
      if(pend) setTimeout(() => renderProblems(c), 900);
    }catch(e){ m.className = 'msg err'; m.textContent = '생성 실패: ' + (e?.message || '오류'); }
    finally{ btn.disabled = false; }
  });
}

function bindVariantReview(c){
  c.querySelectorAll('.vr_act').forEach(btn => btn.addEventListener('click', async () => {
    const card = btn.closest('[data-vid]');
    const m = card ? card.querySelector('.vr_msg') : null;
    const note = card ? (card.querySelector('.vr_note')?.value || '').trim() : '';
    if(m){ m.className = 'msg'; m.textContent = '처리 중...'; }
    try{
      const r = await db.reviewVariant(btn.dataset.vid, btn.dataset.act, note || null);
      if(m){
        m.className = 'msg ok';
        m.textContent = btn.dataset.act === 'approve'
          ? '승인되어 문제은행에 [검토] 상태로 등록되었습니다. 공개하려면 해당 카드에서 상태를 바꾸세요.'
          : '처리되었습니다.';
      }
      setTimeout(() => renderProblems(c), 900);
    }catch(e){ if(m){ m.className = 'msg err'; m.textContent = '실패: ' + (e?.message || '오류'); } }
  }));
}

/* 등록/수정 폼. rubric 편집은 Phase 4 감점 항목 UI 와 같은 패턴을 쓴다. */
function openEditor(c, p, ctx){
  const wrap = $('pbEdit');
  if(!wrap) return;
  const v = p || { origin: '기출', status: 'draft', license_scope: 'internal', body_format: 'latex', difficulty: 3 };
  const uniOpts = ctx.universities.map(u => `<option value="${esc(u.id)}" ${v.university_id === u.id ? 'selected' : ''}>${esc(u.name)}${u.campus ? '(' + esc(u.campus) + ')' : ''}</option>`).join('');

  wrap.innerHTML = `<div class="card" style="border-color:var(--purple)">
    <h3>${svg('pen')}${p ? '문항 수정' : '문항 등록'}</h3>
    <div class="row">
      <div class="field"><label>출처 구분</label><select id="pb_origin">${ORIGINS.map(o => `<option ${v.origin === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
      <div class="field"><label>상태</label><select id="pb_status">${STATUSES.map(s => `<option value="${esc(s)}" ${v.status === s ? 'selected' : ''}>${esc(STATUS_LABEL[s])}</option>`).join('')}</select></div>
      <div class="field"><label>이용 범위</label><select id="pb_license">
        <option value="internal" ${v.license_scope === 'internal' ? 'selected' : ''}>내부 전용</option>
        <option value="own" ${v.license_scope === 'own' ? 'selected' : ''}>자체 제작</option></select></div>
    </div>
    <div class="row" style="margin-top:8px">
      <div class="field"><label>단원</label><select id="pb_unit">${UNITS.map(u => `<option ${v.unit === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div>
      <div class="field"><label>사고과정</label><select id="pb_cog">${COGNITIONS.map(x => `<option ${v.cognition === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="field"><label>난이도</label><select id="pb_diff">${[1,2,3,4,5].map(n => `<option value="${n}" ${Number(v.difficulty) === n ? 'selected' : ''}>${n}단계</option>`).join('')}</select></div>
      <div class="field"><label>배점</label><input id="pb_points" type="number" min="0" step="0.5" value="${v.points != null ? esc(v.points) : ''}"></div>
    </div>
    <div class="row" style="margin-top:8px">
      <div class="field"><label>대학</label><select id="pb_uni"><option value="">미지정</option>${uniOpts}</select></div>
      <div class="field"><label>연도</label><input id="pb_year" type="number" value="${v.exam_year != null ? esc(v.exam_year) : ''}" placeholder="2025"></div>
      <div class="field"><label>회차/구분</label><input id="pb_round" value="${esc(v.exam_round || '')}" placeholder="예: 수시 1차"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>출처 표기 (필수) <span class="muted" style="font-size:11px">카드에 항상 노출됩니다</span></label>
      <input id="pb_cite" value="${esc(v.source_citation || '')}" placeholder="예: 2025학년도 가천대 논술 자연계 3번"></div>
    <div class="row" style="margin-top:8px">
      <div class="field"><label>본문 형식</label><select id="pb_format">${BODY_FORMATS.map(f => `<option value="${esc(f)}" ${v.body_format === f ? 'selected' : ''}>${f === 'latex' ? '수식(LaTeX)' : f === 'image' ? '이미지' : '혼합'}</option>`).join('')}</select></div>
      <div class="field" style="flex:2"><label>태그 <span class="muted" style="font-size:11px">쉼표로 구분</span></label>
        <input id="pb_tags" value="${esc((v.tags || []).join(', '))}" placeholder="도형, 최댓값"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>문제 본문 (LaTeX)</label>
      <textarea id="pb_body" rows="4" style="width:100%;padding:8px;border:1.5px solid var(--line);border-radius:8px;font-family:monospace;font-size:12.5px" placeholder="$f(x)=x^2$ 의 최솟값을 구하시오.">${esc(v.body_latex || '')}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <span class="muted" style="font-size:11.5px">$...$ 인라인, $$...$$ 블록 수식</span>
        <button type="button" class="btn line sm" id="pb_preview">미리보기</button></div>
      <div id="pb_preview_out" style="margin-top:6px;padding:8px;background:var(--bg);border-radius:8px;font-size:13px;min-height:20px"></div></div>
    <div class="row" style="margin-top:8px">
      <div class="field"><label>정답 (LaTeX)</label><textarea id="pb_answer" rows="2" style="width:100%;padding:8px;border:1.5px solid var(--line);border-radius:8px;font-family:monospace;font-size:12.5px">${esc(v.answer_latex || '')}</textarea></div>
      <div class="field"><label>해설 (LaTeX)</label><textarea id="pb_solution" rows="2" style="width:100%;padding:8px;border:1.5px solid var(--line);border-radius:8px;font-family:monospace;font-size:12.5px">${esc(v.solution_latex || '')}</textarea></div>
    </div>
    <div class="field" style="margin-top:8px"><label>문제 이미지 <span class="muted" style="font-size:11px">비공개 버킷에 저장되고 서명 URL로만 열람됩니다</span></label>
      <div id="pb_imgs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        ${(v.body_image_paths || []).map(path => `<span data-photo-path="${esc(path)}" data-photo-bucket="problem-images" data-photo-height="80" class="muted" style="font-size:11px">이미지 불러오는 중...</span>`).join('')}</div>
      <input type="file" id="pb_file" accept="image/*" style="font-size:12px"></div>
    <div class="divider"></div>
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">채점 기준(rubric) <span class="muted" style="font-weight:400">회차에 넣을 때 감점 항목으로 복사됩니다</span></div>
    <div id="pb_rubric"></div>
    <button type="button" class="btn line sm" id="pb_rubric_add" style="margin-top:6px">${svg('plus','xs')}기준 추가</button>
    <div class="divider"></div>
    <button class="btn" id="pb_save">${svg('check','sm')}저장</button>
    <button class="btn line" id="pb_cancel">닫기</button>
    ${p && p.status !== 'retired' ? '<button class="btn danger" id="pb_retire" style="float:right">보관 처리</button>' : ''}
    <div id="pb_msg" class="msg"></div>
  </div>`;

  // rubric 편집
  const rlist = $('pb_rubric');
  const addRubric = (r) => {
    const row = document.createElement('div');
    row.className = 'pb_rb';
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
    row.innerHTML = `<input class="rb_crit" value="${r && r.criterion ? esc(r.criterion) : ''}" placeholder="채점 기준(예: 조건 해석)" style="flex:2;padding:5px 7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px">
      <input class="rb_pts" type="number" min="0" step="0.5" value="${r && r.points != null ? esc(r.points) : 1}" style="width:64px;padding:5px 7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px">
      <select class="rb_tag" style="flex:1;padding:5px 7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px">
        <option value="">태그 없음</option>${WRONG_REASONS.map(x => `<option ${r && r.tag === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <button type="button" class="btn danger icon rb_del">${svg('trash','xs')}</button>`;
    row.querySelector('.rb_del').addEventListener('click', () => row.remove());
    rlist.appendChild(row);
  };
  (Array.isArray(v.rubric) ? v.rubric : []).forEach(addRubric);
  $('pb_rubric_add').addEventListener('click', () => addRubric(null));

  $('pb_preview').addEventListener('click', () => {
    const out = $('pb_preview_out');
    out.textContent = $('pb_body').value;
    renderMath(out);
  });
  $('pb_cancel').addEventListener('click', () => { pbEditId = null; wrap.innerHTML = ''; });

  const retire = $('pb_retire');
  if(retire) retire.addEventListener('click', async () => {
    const m = $('pb_msg'); m.className = 'msg';
    try{ await db.updateProblem(p.id, { status: 'retired' }); pbEditId = null; renderProblems(c); }
    catch(e){ m.className = 'msg err'; m.textContent = '실패: ' + (e?.message || '오류'); }
  });

  let uploaded = (v.body_image_paths || []).slice();
  $('pb_file').addEventListener('change', async () => {
    const m = $('pb_msg'); m.className = 'msg';
    const file = $('pb_file').files[0];
    if(!file) return;
    if(app.DEMO){ m.className = 'msg ok'; m.textContent = '데모 모드에서는 이미지가 저장되지 않습니다.'; return; }
    if(file.size > 5 * 1024 * 1024){ m.className = 'msg err'; m.textContent = '이미지는 5MB 이하만 첨부할 수 있습니다.'; return; }
    m.textContent = '업로드 중...';
    try{
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = 'p' + Date.now() + '_' + Math.random().toString(16).slice(2, 8) + '.' + ext;
      const up = await app.sb.storage.from('problem-images').upload(path, file);
      if(up.error) throw up.error;
      uploaded.push(path);
      m.className = 'msg ok'; m.textContent = '업로드됨 (' + uploaded.length + '장). 저장을 눌러야 반영됩니다.';
    }catch(e){ m.className = 'msg err'; m.textContent = '업로드 실패: ' + (e?.message || '오류'); }
  });

  $('pb_save').addEventListener('click', async () => {
    const m = $('pb_msg'); m.className = 'msg'; m.textContent = '';
    const cite = $('pb_cite').value.trim();
    if(!cite){ m.className = 'msg err'; m.textContent = '출처 표기는 필수입니다(저작권 관리).'; return; }
    const rubric = [...rlist.querySelectorAll('.pb_rb')].map(r => ({
      criterion: r.querySelector('.rb_crit').value.trim(),
      points: Number(r.querySelector('.rb_pts').value) || 0,
      tag: r.querySelector('.rb_tag').value || null,
    })).filter(x => x.criterion && x.points > 0);
    const payload = {
      origin: $('pb_origin').value,
      status: $('pb_status').value,
      license_scope: $('pb_license').value,
      unit: $('pb_unit').value,
      cognition: $('pb_cog').value,
      difficulty: Number($('pb_diff').value) || null,
      points: $('pb_points').value ? Number($('pb_points').value) : null,
      university_id: $('pb_uni').value || null,
      exam_year: $('pb_year').value ? Number($('pb_year').value) : null,
      exam_round: $('pb_round').value.trim() || null,
      source_citation: cite,
      body_format: $('pb_format').value,
      body_latex: $('pb_body').value.trim() || null,
      body_image_paths: uploaded.length ? uploaded : null,
      answer_latex: $('pb_answer').value.trim() || null,
      solution_latex: $('pb_solution').value.trim() || null,
      rubric: rubric.length ? rubric : null,
      tags: $('pb_tags').value.split(',').map(s => s.trim()).filter(Boolean),
    };
    try{
      if(p) await db.updateProblem(p.id, payload);
      else await db.insertProblem(payload);
      pbEditId = null;
      renderProblems(c);
    }catch(e){ m.className = 'msg err'; m.textContent = '저장 실패: ' + (e?.message || '오류'); }
  });

  hydrateSignedPhotos(wrap);
}

// openEditor 는 버튼 클릭으로만 열리는 경로라 테스트에서 직접 호출할 수 있게 함께 내보낸다.
export { renderProblems, openEditor, openVariantForm, variantCardHTML, ORIGINS, STATUS_LABEL, STATUS_CLS };
