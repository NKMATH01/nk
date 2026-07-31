/* ═══════════════════════════════════════════════════════════════════
   6-0 파일럿: 답안지 전사 정확도 A/B 비교

   같은 답안지를 두 방식으로 전사해 어느 쪽이 나은지 실측한다.
     (a) page : 사진 한 장을 통째로 보낸다
     (b) crop : 세로로 2등분해 위/아래를 따로 보내고 결과를 이어 붙인다
   손글씨는 해상도가 정확도를 좌우해서, 크롭이 유리한지 확인하는 것이 목적이다.

   ── 사용법 ────────────────────────────────────────────────────────
   1) API 키를 환경변수로 넣는다(따옴표 없이).
        Windows PowerShell:  $env:GEMINI_API_KEY = "AI..."
        bash:                export GEMINI_API_KEY=AI...
   2) 답안지 사진 30장을 폴더 하나에 모은다(.jpg/.jpeg/.png/.webp).
   3) 실행:
        node scripts/pilot_transcribe.mjs "C:/사진폴더"
        node scripts/pilot_transcribe.mjs "C:/사진폴더" --mode=page   (한쪽만)
        node scripts/pilot_transcribe.mjs "C:/사진폴더" --limit=5     (맛보기)
   4) 결과: 폴더 안에 pilot_report_<타임스탬프>.md 와 pilot_raw_<타임스탬프>.json

   ── 주의 ──────────────────────────────────────────────────────────
   · 이 스크립트는 /api 를 거치지 않고 Gemini REST 를 직접 호출한다(서버 배포 불필요).
   · 호출당 비용이 발생한다. 30장 × 2방식 = 60회. --limit 로 먼저 소규모 확인 권장.
   · 정답률은 자동으로 매길 수 없다. 리포트에 사람이 채점할 칸(정확/부분/실패)을 만들어 둔다.
   · 외부 패키지를 쓰지 않는다(node:fs 등 내장 모듈 + 전역 fetch).
     크롭은 이미지 디코딩 없이 "같은 사진을 두 번 보내되 프롬프트로 영역을 지정"하는
     방식이라 실제 픽셀 자르기는 아니다. 순수 픽셀 크롭이 필요하면 사진을 미리
     반으로 잘라 두 폴더로 나눈 뒤 각각 --mode=page 로 돌리는 편이 정확하다.
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const PRICE_IN = Number(process.env.GEMINI_PRICE_IN_PER_M || 1.50);
const PRICE_OUT = Number(process.env.GEMINI_PRICE_OUT_PER_M || 7.50);
const API = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(MODEL) + ':generateContent';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    legibility: { type: 'NUMBER' },
    unreadable_spans: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['transcript', 'legibility'],
};

const BASE_RULES =
  '이 이미지는 학생이 손으로 쓴 수학 답안이다.\n' +
  '적혀 있는 내용을 그대로 옮겨 적어라.\n' +
  '1. 학생이 쓰지 않은 풀이 단계를 만들어 넣지 마라.\n' +
  '2. 틀린 식이어도 고치지 말고 쓰인 그대로 옮겨라.\n' +
  '3. 수식은 LaTeX 로 표기하라.\n' +
  '4. 알아볼 수 없으면 추측하지 말고 unreadable_spans 에 적어라.\n' +
  '5. legibility 는 판독 확신도 0~1.';

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function parseArgs(){
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--'));
  const get = (k, d) => {
    const hit = args.find(a => a.startsWith('--' + k + '='));
    return hit ? hit.split('=').slice(1).join('=') : d;
  };
  return { dir, mode: get('mode', 'both'), limit: Number(get('limit', '0')) || 0 };
}

async function callGemini(parts){
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1, maxOutputTokens: 4096,
        responseMimeType: 'application/json', responseSchema: SCHEMA,
      },
    }),
  });
  const text = await res.text();
  if(!res.ok) throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 300));
  const data = JSON.parse(text);
  const u = data.usageMetadata || {};
  const cand = (data.candidates || [])[0];
  const finish = cand && cand.finishReason;
  const out = ((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('').trim();
  let json = null;
  try{ json = JSON.parse(out); }catch(e){}
  return {
    json, finish,
    tokensIn: u.promptTokenCount || 0,
    tokensOut: u.candidatesTokenCount || 0,
    cost: ((u.promptTokenCount || 0) / 1e6) * PRICE_IN + ((u.candidatesTokenCount || 0) / 1e6) * PRICE_OUT,
  };
}

async function main(){
  const { dir, mode, limit } = parseArgs();
  if(!process.env.GEMINI_API_KEY){
    console.error('GEMINI_API_KEY 환경변수가 없습니다. 파일 상단 사용법을 참고하세요.');
    process.exit(1);
  }
  if(!dir || !fs.existsSync(dir)){
    console.error('사진 폴더를 지정하세요.  예) node scripts/pilot_transcribe.mjs "C:/사진폴더"');
    process.exit(1);
  }

  let files = fs.readdirSync(dir)
    .filter(f => MIME[path.extname(f).toLowerCase()])
    .sort();
  if(limit) files = files.slice(0, limit);
  if(!files.length){ console.error('폴더에 이미지가 없습니다: ' + dir); process.exit(1); }

  const modes = mode === 'both' ? ['page', 'crop'] : [mode];
  console.log(`모델 ${MODEL} · 사진 ${files.length}장 · 방식 ${modes.join(', ')} → 총 ${files.length * modes.length}회 호출`);

  const rows = [];
  let totalCost = 0;
  for(const f of files){
    const abs = path.join(dir, f);
    const b64 = fs.readFileSync(abs).toString('base64');
    const mime = MIME[path.extname(f).toLowerCase()];
    for(const m of modes){
      const prompt = m === 'page'
        ? BASE_RULES
        : BASE_RULES + '\n\n이미지의 **위쪽 절반**과 **아래쪽 절반**을 각각 따로 정독한 뒤, 순서대로 이어 붙여 옮겨라. 경계에 걸친 글자를 빠뜨리지 마라.';
      process.stdout.write(`  ${f} [${m}] ... `);
      try{
        const r = await callGemini([{ inlineData: { mimeType: mime, data: b64 } }, { text: prompt }]);
        totalCost += r.cost;
        rows.push({
          file: f, mode: m, ok: !!(r.json && r.json.transcript),
          finish: r.finish, legibility: r.json ? r.json.legibility : null,
          chars: r.json && r.json.transcript ? r.json.transcript.length : 0,
          unreadable: r.json && r.json.unreadable_spans ? r.json.unreadable_spans.length : 0,
          transcript: r.json ? r.json.transcript : null,
          tokensIn: r.tokensIn, tokensOut: r.tokensOut, cost: r.cost,
        });
        console.log(`ok (${r.json && r.json.transcript ? r.json.transcript.length : 0}자, $${r.cost.toFixed(5)})`);
      }catch(e){
        rows.push({ file: f, mode: m, ok: false, error: String(e.message).slice(0, 200) });
        console.log('실패: ' + String(e.message).slice(0, 120));
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(dir, `pilot_raw_${stamp}.json`), JSON.stringify(rows, null, 2), 'utf8');

  const byMode = {};
  modes.forEach(m => {
    const r = rows.filter(x => x.mode === m);
    const okr = r.filter(x => x.ok);
    byMode[m] = {
      n: r.length, ok: okr.length,
      avgChars: okr.length ? Math.round(okr.reduce((s, x) => s + x.chars, 0) / okr.length) : 0,
      avgLeg: okr.length ? (okr.reduce((s, x) => s + (x.legibility || 0), 0) / okr.length).toFixed(3) : '-',
      unreadable: okr.reduce((s, x) => s + (x.unreadable || 0), 0),
      cost: r.reduce((s, x) => s + (x.cost || 0), 0),
    };
  });

  const md = [];
  md.push('# 답안지 전사 파일럿 리포트');
  md.push('');
  md.push(`- 모델: \`${MODEL}\``);
  md.push(`- 실행: ${new Date().toLocaleString('ko-KR')}`);
  md.push(`- 사진: ${files.length}장 · 방식: ${modes.join(', ')}`);
  md.push(`- 총 비용: **$${totalCost.toFixed(4)}** (장당 평균 $${(totalCost / Math.max(1, files.length)).toFixed(5)})`);
  md.push('');
  md.push('## 방식별 요약');
  md.push('');
  md.push('| 방식 | 성공 | 평균 글자수 | 평균 판독확신도 | 판독불가 구간 합 | 비용 |');
  md.push('|---|---|---|---|---|---|');
  modes.forEach(m => {
    const s = byMode[m];
    md.push(`| ${m} | ${s.ok}/${s.n} | ${s.avgChars} | ${s.avgLeg} | ${s.unreadable} | $${s.cost.toFixed(4)} |`);
  });
  md.push('');
  md.push('> 위 수치는 **자동 지표**일 뿐 정확도가 아니다. 글자수가 많다고 잘 읽은 것도 아니다.');
  md.push('> 아래 표에 사람이 직접 채점해야 결론이 난다.');
  md.push('');
  md.push('## 사람 채점표 (직접 채우세요)');
  md.push('');
  md.push('판정 기준: **정확** = 그대로 옮김 / **부분** = 일부 누락·오독 / **실패** = 쓸 수 없음');
  md.push('');
  md.push('| 파일 | 방식 | 판독확신도 | 판정(정확/부분/실패) | 메모 |');
  md.push('|---|---|---|---|---|');
  rows.forEach(r => {
    md.push(`| ${r.file} | ${r.mode} | ${r.legibility == null ? '-' : r.legibility} |  |  |`);
  });
  md.push('');
  md.push('## 전사 결과 원문');
  md.push('');
  rows.forEach(r => {
    md.push(`### ${r.file} — ${r.mode}`);
    if(r.error){ md.push('```\n실패: ' + r.error + '\n```'); }
    else{
      md.push(`판독확신도 ${r.legibility == null ? '-' : r.legibility} · ${r.chars}자 · 판독불가 ${r.unreadable}건`);
      md.push('');
      md.push('```');
      md.push(String(r.transcript || '(없음)'));
      md.push('```');
    }
    md.push('');
  });
  md.push('## 결론 작성란');
  md.push('');
  md.push('- 채택 방식: ');
  md.push('- 근거: ');
  md.push('- 장당 예상 비용: ');
  md.push('- 다음 단계(6-1) 진행 여부: ');

  const out = path.join(dir, `pilot_report_${stamp}.md`);
  fs.writeFileSync(out, md.join('\n'), 'utf8');
  console.log('\n리포트: ' + out);
  console.log('총 비용: $' + totalCost.toFixed(4));
}

main().catch(e => { console.error(e); process.exit(1); });
