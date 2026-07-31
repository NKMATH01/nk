/* 설정 + DB 마이그레이션 상태 배지 */
import { EXPECTED_MIGRATIONS } from '../config.js';
import { db } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { $, esc } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   9) 설정
   ═══════════════════════════════════════════════════════════════════ */
async function renderSettings(c){
  const accountsNote=app.DEMO?'<div class="note-blue">데모 모드에서는 계정 정보가 저장되지 않습니다.</div>':'';
  c.innerHTML=`
    <div class="card"><h3>${svg('settings')}내 비밀번호 변경</h3>
      <div class="row"><div class="field" style="flex:1"><label>새 비밀번호</label><input id="pw_new" type="password" placeholder="4자 이상"></div>
        <button class="btn" id="pw_save">변경</button></div><div id="pw_msg" class="msg"></div></div>
    <div class="card"><h3>${svg('users')}역할 안내</h3>
      <div class="kv"><span>관리자(admin)</span><span>전체 관리·입력·분석</span></div>
      <div class="kv"><span>학생(student)</span><span>내 리포트·진단·첨삭·목표 대학(읽기)</span></div>
      <div class="kv"><span>학부모(parent)</span><span>자녀 주간 리포트(모바일 단일 페이지)</span></div>
      <p class="muted" style="font-size:12px;margin-top:10px">학생·학부모 계정은 [학생 관리]의 각 학생 카드에서 생성합니다.</p>${accountsNote}</div>
    <div class="card"><h3>${svg('spark')}AI 자동채점 상태</h3>
      <div id="ai_box"><p class="muted" style="font-size:12.5px">확인 중...</p></div></div>
    <div class="card"><h3>${svg('clipboardCheck')}DB 마이그레이션 상태</h3>
      <div id="mig_box"><p class="muted" style="font-size:12.5px">확인 중...</p></div></div>
    <div class="card"><h3>${svg('file')}데이터 관리</h3>
      <p class="muted" style="font-size:12.5px">데이터는 Supabase에 저장됩니다. 백업은 Supabase 대시보드에서 관리하세요. 보안 한계는 README_설치가이드.md를 참고하세요.</p></div>`;
  fillMigrationStatus();
  fillAiStatus();
  $('pw_save').addEventListener('click',async()=>{const m=$('pw_msg');m.className='msg';m.textContent='';
    const np=$('pw_new').value;if(!np||np.length<4){m.className='msg err';m.textContent='4자 이상 입력하세요.';return;}
    if(app.DEMO){m.className='msg ok';m.textContent='데모 모드에서는 변경되지 않습니다.';return;}
    try{await db.changeMyPassword(np);
      m.className='msg ok';m.textContent='변경되었습니다.';$('pw_new').value='';}
    catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}});
}
// 설정 화면의 마이그레이션 카드만 비동기로 채운다(렌더 흐름을 막지 않음).
async function fillMigrationStatus(){
  const put=html=>{const b=$('mig_box');if(b)b.innerHTML=html;};
  if(app.DEMO){put('<span class="chip gray">데모 모드 — 확인 안 함</span>');return;}
  let applied;
  try{const {data,error}=await app.sb.from('schema_migrations').select('version');if(error)throw error;
    applied=(data||[]).map(r=>r.version);}
  catch(e){console.error('마이그레이션 상태 조회',e);
    put('<span class="chip red">확인 실패</span><p class="muted" style="font-size:12.5px;margin-top:8px">마이그레이션 추적 테이블 없음 — db/migrations/0002_migration_tracking.sql 실행 필요</p>');return;}
  const missing=EXPECTED_MIGRATIONS.filter(v=>!applied.includes(v));
  if(!missing.length){put('<span class="chip green">최신 상태</span><p class="muted" style="font-size:12.5px;margin-top:8px">적용됨 '+applied.length+'건</p>');return;}
  put('<span class="chip amber">미적용 '+missing.length+'건</span>'
    +'<p class="muted" style="font-size:12.5px;margin:8px 0">아래 파일을 Supabase SQL 에디터에서 번호 순서대로 실행하세요.</p>'
    +missing.map(v=>`<div class="kv"><span>db/migrations/${esc(v)}.sql</span><span>미적용</span></div>`).join(''));
}

/* AI 자동채점 설정 상태. 키 자체는 서버가 절대 내려주지 않고 설정 여부만 알려준다. */
async function fillAiStatus(){
  const put=html=>{const b=$('ai_box');if(b)b.innerHTML=html;};
  if(app.DEMO){put('<span class="chip gray">데모 모드 — AI 기능 사용 안 함</span>');return;}
  const s=await db.getAiStatus();
  if(!s||!s.configured){
    put('<span class="chip amber">미설정</span>'
      +'<p class="muted" style="font-size:12.5px;margin-top:8px">AI 자동채점이 꺼져 있습니다. 사진 첨부와 수동 채점은 정상 동작합니다.</p>'
      +'<div class="kv"><span>켜는 방법</span><span class="muted">Vercel 환경변수에 GEMINI_API_KEY 등록 후 재배포</span></div>'
      +(s&&s.error?`<div class="muted" style="font-size:11.5px;margin-top:6px">서버 응답: ${esc(s.error)}</div>`:''));
    return;
  }
  const modeLabel=s.mode==='full'
    ?'<span class="chip purple">점수 제안 포함</span>'
    :'<span class="chip blue">태그만</span>';
  put('<span class="chip green">사용 가능</span> '+modeLabel
    +`<div class="kv" style="margin-top:8px"><span>모델</span><b>${esc(s.model||'-')}</b></div>`
    +`<div class="kv"><span>프롬프트 버전</span><span class="muted">${esc(s.promptVersion||'-')}</span></div>`
    +`<div class="kv"><span>단가(1M 토큰)</span><span class="muted">입력 $${esc(s.priceInPerM)} · 출력 $${esc(s.priceOutPerM)}</span></div>`
    +'<p class="muted" style="font-size:12px;margin-top:8px">'
    +(s.mode==='full'
      ? 'AI가 점수까지 제안합니다. 제안은 강사가 [반영]을 눌러야만 채점에 기록됩니다.'
      : '앵커링을 막기 위해 점수 제안 없이 감점 태그·피드백만 받습니다. 일치율이 충분히 쌓이면 환경변수 AI_GRADING_MODE=full 로 전환하세요.')
    +'</p>');
}

export { renderSettings, fillMigrationStatus, fillAiStatus };
