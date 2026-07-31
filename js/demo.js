/* 데모 모드(?demo=1)용 메모리 데이터 생성기. */
import { COGNITIONS, UNITS, WRONG_REASONS } from './config.js';
import { mulberry32, pad, uuid } from './util.js';

/* ═══════════════════════════════════════════════════════════════════
   데모 데이터
   ═══════════════════════════════════════════════════════════════════ */

function buildDemoStore(){
  const rnd=mulberry32(20260707);
  const students=[
    {id:uuid(),name:'김민준',grade_type:'고3',school:'상록고',naesin_grade:2.4,parent_phone:'01011110001',consent_date:'2026-03-02',status:'재원',created_at:'2026-03-02'},
    {id:uuid(),name:'이서연',grade_type:'고3',school:'안산고',naesin_grade:1.8,parent_phone:'01011110002',consent_date:'2026-03-02',status:'재원',created_at:'2026-03-03'},
    {id:uuid(),name:'박도윤',grade_type:'고3',school:'초지고',naesin_grade:3.1,parent_phone:'01011110003',consent_date:'2026-03-04',status:'재원',created_at:'2026-03-04'},
    {id:uuid(),name:'최지우',grade_type:'고3',school:'양지고',naesin_grade:2.0,parent_phone:'01011110004',consent_date:'2026-03-05',status:'재원',created_at:'2026-03-05'},
    {id:uuid(),name:'정하람',grade_type:'N수',school:'재수생',naesin_grade:null,parent_phone:'01011110005',consent_date:'2026-03-06',status:'재원',created_at:'2026-03-06'},
    {id:uuid(),name:'한유진',grade_type:'N수',school:'재수생',naesin_grade:null,parent_phone:'01011110006',consent_date:'2026-03-07',status:'재원',created_at:'2026-03-07'},
  ];
  const U=(name,campus,region,eo,er,nr,mg,qmix,date,quota,notes)=>({
    id:uuid(),name,campus:campus||null,region,essay_only:eo,essay_ratio:er,naesin_ratio:nr,min_grade_rule:mg,
    math_scope:'수Ⅰ·수Ⅱ',question_mix:qmix,exam_date:date,quota:quota,confirmed:false,notes:notes||null,
    last_competition:null,last_cut_pct:null,last_result_note:null,last_cut_basis:null});
  const universities=[
    U('국민대',null,'서울',true,'논술 100%','미반영','요강 확인 필요','국어 단답+수학 서술 12문항','2026-11-22',210,'EBS 수특·수완 기반'),
    U('상명대',null,'서울',false,'논술 70%+내신 30%','30%','요강 확인 필요','국어+수학 10문항','2026-11-29',160,null),
    U('서경대',null,'서울',true,'논술 100%','미반영','수능 최저 없음','국어4+수학4 · 60분','2026-11-01',214,'고사장 확인 9/23'),
    U('삼육대',null,'서울',true,'논술 100%','미반영','요강 확인 필요','국어+수학 12문항','2026-12-06',95,null),
    U('가천대','자연','경기',true,'논술 100%','미반영','수능 1개 영역 3등급 이내(1합3)','국어5+수학8 · 80분','2026-12-01',1036,'고사장 확인 11/17 · 모집 1036명은 인문·자연 합계'),
    U('가천대','인문','경기',true,'논술 100%','미반영','수능 1개 영역 3등급 이내(1합3)','국어8+수학5 · 80분','2026-11-30',1036,'고사장 확인 11/17 · 모집 1036명은 인문·자연 합계'),
    U('강남대',null,'경기',false,'논술 60%+내신 40%','40%','요강 확인 필요','국어+수학 10문항','2026-11-21',110,null),
    U('수원대',null,'경기',false,'논술 75%+교과 25%','교과 25%','수능 2개 영역 합 7 이내(2합7)','인문 국어10+수학5 / 자연 국어5+수학10','2026-11-21',434,'자연 11/21 · 인문 11/22'),
    U('신한대',null,'경기',false,'논술 60%+내신 40%','40%','요강 확인 필요','국어+수학 10문항','2026-11-15',90,null),
    U('을지대',null,'경기',false,'논술 80%+교과 20%','교과 20%','수능 최저 없음','국어7+수학7 · 70분','2026-10-16',251,'고사장 확인 10/12 · 세부 인원 요강 재확인 필요'),
    U('한국공학대',null,'경기',false,'논술 70%+내신 30%','30%','요강 확인 필요','수학 서술 12문항','2026-11-29',130,null),
    U('한국외대','글로벌','경기',true,'논술 100%','미반영','요강 확인 필요','국어+수학 10문항','2026-11-22',150,'글로벌캠퍼스'),
    U('한신대',null,'경기',false,'논술 60%+내신 40%','40%','요강 확인 필요','국어+수학 10문항','2026-11-28',80,null),
    U('고려대','세종','충청',true,'논술 100%','미반영','요강 확인 필요','수학 서술 12문항','2026-12-06',200,'세종캠퍼스'),
    U('홍익대','세종','충청',false,'논술 70%+내신 30%','30%','요강 확인 필요','수학 중심 10문항','2026-11-29',140,'세종캠퍼스'),
    U('한국기술교육대',null,'충청',true,'논술 100%','미반영','요강 확인 필요','수학 서술 12문항','2026-11-21',85,null),
  ];
  const uByName=n=>universities.find(u=>u.name===n);
  // 작년 입시결과 데모 시드(경쟁률·합격선%·합격선 산출기준)
  // 국민대는 basis 를 비워 둬서 "합격선 정의 미확인 → 비교 생략" 경로를 보여준다.
  [['가천대',40,68,'2025 자연 기준(데모)','150점 만점 환산 70%컷(데모)'],
   ['서경대',25,74,'2025 논술 100% 기준(데모)','논술 100% 원점수 백분율(데모)'],
   ['국민대',30,71,'2025 기준(데모)',null]]
    .forEach(([n,comp,cut,note,basis])=>{const u=uByName(n);if(u){u.last_competition=comp;u.last_cut_pct=cut;u.last_result_note=note;u.last_cut_basis=basis;}});
  const student_targets=[];
  const addT=(si,names)=>names.forEach((n,i)=>student_targets.push({id:uuid(),student_id:students[si].id,university_id:uByName(n).id,priority:i+1}));
  addT(0,['국민대','가천대','서경대']);
  addT(1,['한국외대','국민대','고려대']);
  addT(2,['가천대','수원대','강남대']);
  addT(3,['국민대','상명대','삼육대']);
  addT(4,['고려대','가천대','한국기술교육대']);
  addT(5,['가천대','국민대','한국외대']);

  // 회차/문항/점수
  const test_sessions=[], questions=[], scores=[];
  const homework_records=[], essay_gradings=[], teacher_comments=[];
  const ability=[0.72,0.86,0.58,0.80,0.68,0.63]; // 학생별 기본 실력
  for(let w=0;w<6;w++){
    const nQ=10+(w%3); // 10~12
    const exam=new Date('2026-05-30T00:00:00'); exam.setDate(exam.getDate()+7*w);
    const examStr=exam.getFullYear()+'-'+pad(exam.getMonth()+1)+'-'+pad(exam.getDate());
    const scopeUnits=[UNITS[w%6],UNITS[(w+2)%6],UNITS[(w+4)%6]];
    const sess={id:uuid(),week_no:w+1,exam_date:examStr,scope_units:scopeUnits.join(', '),total_score:0,memo:'',created_at:examStr};
    let totPts=0;
    const qs=[];
    for(let q=0;q<nQ;q++){
      const unit=scopeUnits[q%scopeUnits.length];
      const cog=COGNITIONS[(q+w)%4];
      const points=[5,8,10,12][Math.floor(rnd()*4)];
      totPts+=points;
      const qq={id:uuid(),session_id:sess.id,no:q+1,unit,cognition:cog,points,source:'수특 '+unit+' '+(q+1)};
      // 감점 항목 샘플(앞 3문항만) — 채점 그리드 체크박스 데모용
      if(q<3){
        qq.deduction_items=[
          {label:'조건 누락',points:Math.max(1,Math.round(points*0.2)),tag:'조건 해석'},
          {label:'풀이 근거 미기재',points:Math.max(1,Math.round(points*0.3)),tag:'풀이 근거 누락'},
          {label:'계산 오류',points:Math.max(1,Math.round(points*0.2)),tag:'계산 실수'},
        ];
      }
      questions.push(qq);qs.push(qq);
    }
    sess.total_score=totPts;
    test_sessions.push(sess);
    // 점수
    students.forEach((st,si)=>{
      qs.forEach(qq=>{
        let base=ability[si];
        // 김민준(0): 삼각함수+활용 취약 스토리
        if(si===0 && qq.unit==='삼각함수' && qq.cognition==='활용') base=0.2;
        else if(si===0 && qq.unit==='삼각함수') base=0.45;
        const noise=(rnd()-0.5)*0.28;
        let ratio=Math.max(0,Math.min(1,base+noise+w*0.012)); // 주차별 소폭 상승
        let earned=Math.round(ratio*qq.points);
        earned=Math.max(0,Math.min(qq.points,earned));
        const sc={id:uuid(),question_id:qq.id,student_id:st.id,earned,wrong_reason:null};
        if(earned<qq.points){
          // 오답원인 태그: 김민준 삼각/활용은 조건해석/풀이근거
          if(si===0 && qq.unit==='삼각함수') sc.wrong_reason=(rnd()<0.6?'조건 해석':'풀이 근거 누락');
          else sc.wrong_reason=WRONG_REASONS[Math.floor(rnd()*WRONG_REASONS.length)];
        }
        scores.push(sc);
      });
      // 과제 점검(풀이 채점 결과)
      const ptot=15+Math.floor(rnd()*11); // 15~25
      const pcorr=Math.max(0,Math.min(ptot,Math.round(ptot*(ability[si]+(rnd()-0.5)*0.18))));
      const tmin=30+Math.floor(rnd()*51); // 30~80
      homework_records.push({id:uuid(),student_id:st.id,week_date:examStr,problems_total:ptot,problems_correct:pcorr,time_min:tmin,
        memo:((si===0&&w>=4)?'삼각함수 활용 문항에서 시간 초과':(rnd()<0.2?'풀이 과정 서술 보강 필요':null)),created_at:examStr});
      // 첨삭(2주에 한 번)
      if(w%2===1){
        const tName=universities[si%universities.length].name;
        const mk=(m)=>Math.round((ability[si]*m)+(rnd()-0.4)*m*0.2);
        essay_gradings.push({id:uuid(),student_id:st.id,week_date:examStr,univ_name:tName,
          cond_earned:Math.max(0,Math.min(10,mk(10))),cond_max:10,
          proc_earned:Math.max(0,Math.min(20,mk(20))),proc_max:20,
          ans_earned:Math.max(0,Math.min(10,mk(10))),ans_max:10,
          comment:(si===0?'삼각함수 활용형에서 조건 해석이 흔들립니다. 도식화 훈련 필요.':'전반적으로 안정적. 서술 근거 보강 권장.'),created_at:examStr});
      }
    });
  }
  // 강사 코멘트(최근 주차)
  students.forEach((st,si)=>{
    teacher_comments.push({id:uuid(),student_id:st.id,week_no:6,
      comment:(si===0?'삼각함수-활용 단원이 지속 취약합니다. 다음 주 활용형 집중 클리닉 배정. 계산 정확도는 양호.':'목표 대학 대비 준비도 안정권. 첨삭 서술 근거를 한 단계 더 정교화합시다.'),created_at:'2026-07-05'});
  });

  // 상담 기록(학생별 1~3건, 관리자 전용)
  const counseling_notes=[];
  students.forEach((st,si)=>{
    counseling_notes.push({id:uuid(),student_id:st.id,note_date:'2026-05-18',category:'정기상담',
      content:(si===0?'9월 모평 목표 상담. 수학 취약 단원 삼각함수(활용) 집중 보완 합의. 주 2회 활용형 클리닉 배정.':'중간 점검 상담. 목표 대학 대비 학습 페이스 양호. 첨삭 서술 근거 강화 목표 공유.'),
      follow_up:(si===0?'학부모께 주간 리포트 링크 안내 예정':null),visible_to_student:true,created_at:'2026-05-18'});
    if(si%2===0)counseling_notes.push({id:uuid(),student_id:st.id,note_date:'2026-06-15',category:'학부모상담',
      content:'학부모 대면 상담. 최근 성적 추이와 첨삭 방향 공유. 가정 학습 시간 조정 요청.',follow_up:'다음 달 재상담 일정 조율',visible_to_student:false,created_at:'2026-06-15'});
    if(si===0)counseling_notes.push({id:uuid(),student_id:st.id,note_date:'2026-06-30',category:'진로·지원상담',
      content:'논술 100% 대학 위주 지원 전략 논의(국민대·가천대·서경대). 내신 부담 낮은 라인업 확정.',follow_up:'모집요강 확정 후 최저 재확인',visible_to_student:false,created_at:'2026-06-30'});
  });

  // 처방(취약 진단에서 배정한 보완 과제) — 개선/정체/대기 3가지 상태를 모두 보여준다
  const prescriptions=[];
  prescriptions.push({id:uuid(),student_id:students[0].id,unit:'삼각함수',cognition:'활용',
    due_date:'2026-06-27',note:'활용형 조건 도식화 훈련 주 2회. 수특 삼각함수 활용 6~12번 반복.',
    baseline_rate:18,status:'active',created_at:'2026-06-13'});
  prescriptions.push({id:uuid(),student_id:students[0].id,unit:'수열',cognition:'계산',
    due_date:'2026-06-13',note:'점화식 계산 정확도 훈련.',
    baseline_rate:52,status:'done',created_at:'2026-05-30'});
  prescriptions.push({id:uuid(),student_id:students[1].id,unit:'미분',cognition:'그래프',
    due_date:'2026-07-25',note:'증감표 작성 후 개형 스케치 루틴화.',
    baseline_rate:61,status:'active',created_at:'2026-07-11'});

  return {students,universities,student_targets,test_sessions,questions,scores,homework_records,essay_gradings,teacher_comments,counseling_notes,prescriptions,accounts:[]};
}

export { buildDemoStore };
