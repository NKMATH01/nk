/* 과제 점검 */
import { hwAccuracyAvg, hwTimeAvg } from '../calc.js';
import { db } from '../db.js';
import { svg } from '../icons.js';
import { app } from '../state.js';
import { bindStudentSelector, studentSelector } from '../ui.js';
import { $, esc, fmtDate, r1, todayStr } from '../util.js';

/* ═══════════════════════════════════════════════════════════════════
   3.5) 과제 점검 (풀이 채점 결과 기록 — 제출 관리는 외부 앱)
   ═══════════════════════════════════════════════════════════════════ */
async function renderHomeworkCheck(c){
  if(app.cur.role!=='admin'){c.innerHTML='<p class="muted">권한이 없습니다.</p>';return;}
  c.innerHTML=await studentSelector()+'<p class="muted">불러오는 중...</p>';bindStudentSelector(()=>renderHomeworkCheck(c));
  const sid=app.cur.studentId;if(!sid){c.querySelector('p').textContent='학생을 선택하세요.';return;}
  const recs=(await db.listHomework(sid)).slice().sort((a,b)=>a.week_date<b.week_date?1:-1); // 최신순
  const accAvg=hwAccuracyAvg(recs), timeAvg=hwTimeAvg(recs);
  const recent4=recs.slice(0,4).slice().reverse(); // 최근 4주 오래된->최신
  const trend=recent4.map(h=>{const t=Number(h.problems_total)||0;return t>0?(Number(h.problems_correct)||0)/t*100:0;});
  const trendDelta=(trend.length>=2)?trend[trend.length-1]-trend[0]:null;

  c.innerHTML=await studentSelector()+`
    <div class="kpi-grid" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">${svg('clipboardCheck','sm')}평균 정답률</div><div class="val">${accAvg==null?'-':r1(accAvg)+'<small>%</small>'}</div></div>
      <div class="kpi"><div class="lbl">${svg('clock','sm')}평균 풀이 시간</div><div class="val">${timeAvg==null?'-':r1(timeAvg)+'<small> 분/회</small>'}</div></div>
      <div class="kpi"><div class="lbl">${svg('activity','sm')}최근 4주 추이</div><div class="val">${trend.length?'<canvas id="hwSpark" width="150" height="42" style="vertical-align:middle"></canvas>':'-'} ${trendDelta==null?'':(trendDelta>=0?'<span class="delta up">'+svg('arrowUp','xs')+r1(Math.abs(trendDelta))+'%p</span>':'<span class="delta down">'+svg('arrowDown','xs')+r1(Math.abs(trendDelta))+'%p</span>')}</div></div>
    </div>
    <div class="card"><h3>${svg('clipboardCheck')}과제 점검 입력 <span class="sub">숙제 제출은 학원 앱에서 관리 · 여기서는 풀이 채점 결과만 기록</span></h3>
      <div class="row">
        <div class="field"><label>날짜</label><input id="hw_date" type="date" value="${todayStr()}"></div>
        <div class="field"><label>전체 문항 수</label><input id="hw_total" type="number" min="1" placeholder="예: 20"></div>
        <div class="field"><label>맞은 문항 수</label><input id="hw_correct" type="number" min="0" placeholder="예: 18"></div>
        <div class="field"><label>걸린 시간(분)</label><input id="hw_time" type="number" min="0" placeholder="예: 45"></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="field" style="flex:2"><label>교재명(선택)</label><input id="hw_book" placeholder="예: 수능특강 수학Ⅰ"></div>
        <div class="field"><label>시작 페이지</label><input id="hw_pfrom" type="number" min="0" placeholder="예: 12"></div>
        <div class="field"><label>끝 페이지</label><input id="hw_pto" type="number" min="0" placeholder="예: 20"></div>
      </div>
      <div class="field" style="margin-top:8px"><label>메모(선택)</label><input id="hw_memo" placeholder="특이사항"></div>
      <button class="btn" id="hw_add">${svg('check','sm')}기록 저장</button><div id="hw_msg" class="msg"></div>
    </div>
    <div class="card"><h3>${svg('clock')}점검 기록 (최신순)</h3>
      <div style="overflow-x:auto"><table><thead><tr><th>날짜</th><th>교재(페이지)</th><th>채점 결과</th><th class="num">걸린 시간</th><th class="num">문항당 평균</th><th>메모</th><th></th></tr></thead><tbody>
      ${recs.length?recs.map(h=>{const t=Number(h.problems_total)||0,cc=Number(h.problems_correct)||0;const pct=t>0?Math.round(cc/t*100):0;
        const per=(t>0&&h.time_min!=null&&h.time_min!=='')?r1(Number(h.time_min)/t):null;
        const pgFrom=h.page_from!=null&&h.page_from!==''?h.page_from:null,pgTo=h.page_to!=null&&h.page_to!==''?h.page_to:null;
        const pg=(pgFrom!=null||pgTo!=null)?'p'+(pgFrom!=null?pgFrom:'')+'~p'+(pgTo!=null?pgTo:''):'';
        const bookLabel=h.book?esc(h.book)+(pg?' ('+pg+')':''):(pg||'-');
        return `<tr><td>${esc(fmtDate(h.week_date))}</td><td class="muted">${bookLabel}</td><td><b>${cc}/${t}</b> <span class="muted">(${pct}%)</span></td>
          <td class="num">${h.time_min!=null&&h.time_min!==''?esc(h.time_min)+'분':'-'}</td>
          <td class="num">${per==null?'-':per+'분'}</td>
          <td class="muted">${esc(h.memo||'-')}</td>
          <td><button class="btn danger sm hw_del" data-id="${esc(h.id)}">${svg('trash','xs')}</button></td></tr>`;}).join(''):'<tr><td colspan="7" class="muted">기록이 없습니다.</td></tr>'}
      </tbody></table></div></div>`;
  bindStudentSelector(()=>renderHomeworkCheck(c));
  if(trend.length&&typeof Chart!=='undefined'){
    app.state.charts.push(new Chart($('hwSpark').getContext('2d'),{type:'line',
      data:{labels:trend.map((_,i)=>i+1),datasets:[{data:trend,borderColor:'#7C5CFC',borderWidth:2,pointRadius:2,tension:.35,fill:false}]},
      options:{responsive:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false,min:0,max:100}}}}));
  }
  $('hw_add').addEventListener('click',async()=>{
    const m=$('hw_msg');m.className='msg';m.textContent='';
    const date=$('hw_date').value;const total=Number($('hw_total').value);const correct=Number($('hw_correct').value);
    const timeRaw=$('hw_time').value;
    if(!date){m.className='msg err';m.textContent='날짜를 입력하세요.';return;}
    if(!$('hw_total').value||isNaN(total)||total<1){m.className='msg err';m.textContent='전체 문항 수를 입력하세요.';return;}
    if($('hw_correct').value===''||isNaN(correct)||correct<0){m.className='msg err';m.textContent='맞은 문항 수를 입력하세요.';return;}
    if(correct>total){m.className='msg err';m.textContent='맞은 개수는 전체 문항 수를 넘을 수 없습니다.';return;}
    let time=null;if(timeRaw!==''){time=Number(timeRaw);if(isNaN(time)||time<0){m.className='msg err';m.textContent='걸린 시간은 0 이상이어야 합니다.';return;}}
    const book=$('hw_book').value.trim()||null;const pf=$('hw_pfrom').value!==''?Number($('hw_pfrom').value):null;const pt=$('hw_pto').value!==''?Number($('hw_pto').value):null;
    try{await db.insertHomework({student_id:sid,week_date:date,problems_total:total,problems_correct:correct,time_min:time,memo:$('hw_memo').value.trim()||null,book,page_from:pf,page_to:pt});
      m.className='msg ok';m.textContent='저장되었습니다.';renderHomeworkCheck(c);}
    catch(e){m.className='msg err';m.textContent='실패: '+(e?.message||'오류');}
  });
  c.querySelectorAll('.hw_del').forEach(b=>b.addEventListener('click',async()=>{
    try{await db.deleteHomework(b.dataset.id);renderHomeworkCheck(c);}catch(e){alert('삭제 실패: '+(e?.message||'오류'));}}));
}

export { renderHomeworkCheck };
