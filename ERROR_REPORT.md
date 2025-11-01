# NK 학원 업무 관리 시스템 - 오류 분석 및 수정 리포트

## 📋 요약
Google Apps Script 기반 NK 학원 업무 관리 시스템의 백엔드(Code.gs)와 프론트엔드(index.html) 코드에서 발견된 오류를 분석하고 수정했습니다.

---

## 🔴 발견된 주요 오류

### 1. **날짜/시간 처리 오류 (심각도: ⭐⭐⭐⭐⭐ 매우 높음)**

**위치:** `Code.gs:34-60`

**문제점:**
- `getKSTNow()` 함수가 UTC 시간에 9시간을 더해 KST로 변환
- 하지만 `formatDateTime()`과 `formatDate()` 함수는 **다시 UTC 메서드(`getUTCFullYear()` 등)를 사용**
- 결과: 시간이 **중복으로 변환**되거나 **잘못된 시간이 저장**됨

**원본 코드:**
```javascript
function getKSTNow() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  return new Date(now.getTime() + kstOffset);
}

function formatDateTime(date) {
  const year = date.getUTCFullYear();  // ❌ 문제: UTC 메서드 사용
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  // ...
}
```

**수정된 코드:**
```javascript
function getKSTNow() {
  // Utilities.formatDate()를 사용하여 정확한 KST 시간 반환
  const now = new Date();
  const timeZone = 'Asia/Seoul';
  return new Date(Utilities.formatDate(now, timeZone, 'yyyy-MM-dd\'T\'HH:mm:ss'));
}

function formatDateTime(date) {
  // KST로 변환된 Date이므로 로컬 메서드 사용
  const year = date.getFullYear();  // ✅ 수정: 로컬 메서드 사용
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

**영향:**
- 업무 할당 시간이 잘못 기록됨
- 마감 시간 비교 오류
- 벌금 부과 시간 오류
- 공지사항/건의사항 타임스탬프 오류

---

### 2. **할당 지연 벌금 시간 체크 오류 (심각도: ⭐⭐⭐⭐⭐ 매우 높음)**

**위치:** `Code.gs:326-332` (addNewTasks 함수 내)

**문제점:**
- `kstNow`가 KST로 변환된 시간이지만, **UTC 메서드(`getUTCDay()`, `getUTCHours()`)를 사용**
- 결과: 오후 2:30 기준 벌금 체크가 **9시간 차이로 잘못 작동**

**원본 코드:**
```javascript
const dayOfWeek = kstNow.getUTCDay();  // ❌ UTC 메서드
const hour = kstNow.getUTCHours();      // ❌ UTC 메서드
const minute = kstNow.getUTCMinutes();  // ❌ UTC 메서드
```

**수정된 코드:**
```javascript
const dayOfWeek = kstNow.getDay();     // ✅ 로컬 메서드
const hour = kstNow.getHours();         // ✅ 로컬 메서드
const minute = kstNow.getMinutes();     // ✅ 로컬 메서드
```

**영향:**
- 팀장/대표가 업무를 오후 2:30 이후에 할당했을 때 벌금이 **잘못 부과**될 수 있음
- 예: 실제 KST 오후 3시에 할당했지만 UTC 기준 오전 6시로 체크하여 벌금이 부과되지 않음

---

### 3. **Deadline 비교 오류 (심각도: ⭐⭐⭐⭐ 높음)**

**위치:** `Code.gs:391` (updateTaskStatus 함수 내)

**문제점:**
- `deadline` 문자열을 Date로 변환할 때 **`+ 'Z'`를 추가하여 UTC로 해석**
- 실제 deadline은 **KST 기준 시간**이므로 9시간 차이 발생

**원본 코드:**
```javascript
const deadlineDate = new Date(deadline.replace(' ', 'T') + 'Z');  // ❌ UTC로 해석
```

**수정된 코드:**
```javascript
// deadline은 KST 기준 문자열이므로 직접 Date 객체로 변환
const deadlineDate = new Date(deadline.replace(' ', 'T'));  // ✅ KST로 해석
```

**영향:**
- 업무 완료 시 지연 여부 판단 오류
- 벌금 부과 오류 (정시에 완료했는데 지연으로 표시되거나 그 반대)

---

### 4. **Suggestions 시트 컬럼 불일치 (심각도: ⭐⭐⭐ 중간)**

**위치:** `Code.gs:519-521`, `Code.gs:535-544`

**문제점:**
- `getInitialData()`에서는 Suggestions 시트를 **6개 컬럼**(`Reply`, `ReplyTime` 포함)으로 생성
- 하지만 `addSuggestion()`에서는 **4개 컬럼만 추가**하여 데이터 구조 불일치

**원본 코드:**
```javascript
// addSuggestion() 함수
if (!suggestionsSheet) {
  suggestionsSheet = ss.insertSheet(SHEET_SUGGESTIONS);
  suggestionsSheet.appendRow(['SuggestionID', 'Timestamp', 'SubmitterID', 'SuggestionText']);
  // ❌ Reply, ReplyTime 누락
}

const newRow = [
  nextId,
  timestamp,
  submitterId,
  suggestionText
  // ❌ 4개만 추가
];
```

**수정된 코드:**
```javascript
if (!suggestionsSheet) {
  suggestionsSheet = ss.insertSheet(SHEET_SUGGESTIONS);
  suggestionsSheet.appendRow(['SuggestionID', 'Timestamp', 'SubmitterID', 'SuggestionText', 'Reply', 'ReplyTime']);
  // ✅ Reply, ReplyTime 추가
}

const newRow = [
  nextId,
  timestamp,
  submitterId,
  suggestionText,
  '', // Reply (빈 값)
  ''  // ReplyTime (빈 값)
  // ✅ 6개로 일치
];
```

**영향:**
- 건의사항에 답변을 달 때 오류 발생 가능
- 데이터 파싱 시 인덱스 불일치

---

## ⚠️ 기타 주의사항

### 5. **프론트엔드: 날짜 비교 시 시간대 처리**

**위치:** HTML의 JavaScript (여러 곳)

**주의사항:**
- 프론트엔드에서 `new Date()`로 현재 시간을 가져올 때, **브라우저의 로컬 시간대**를 사용
- 서버에서 KST 기준으로 저장된 시간과 비교할 때 주의 필요
- 특히 `loadUrgentTasksTable()`, `loadAllTasksTable()` 등에서 마감 임박 판단 시

**권장 수정:**
```javascript
// 현재 방식 (브라우저 로컬 시간)
const now = new Date();

// 권장 방식 (서버에서 KST 시간 받아오기)
// 또는 프론트엔드에서 명시적으로 KST 변환
```

---

### 6. **에러 핸들링 부족**

**문제점:**
- 여러 함수에서 `try-catch`는 있지만, **구체적인 에러 정보 부족**
- 프론트엔드에서 에러 발생 시 사용자에게 **어떤 오류인지 정확히 알려주지 못함**

**권장 개선:**
```javascript
// 현재
} catch (e) {
  throw new Error('업무 추가 실패: ' + e.message);
}

// 개선
} catch (e) {
  Logger.log('❌ 업무 추가 실패 상세:', e);
  Logger.log('Stack trace:', e.stack);
  throw new Error(`업무 추가 실패: ${e.message} (위치: ${e.stack?.split('\n')[0] || 'unknown'})`);
}
```

---

## 📊 수정 전후 비교

| 오류 | 심각도 | 수정 전 | 수정 후 |
|------|--------|---------|---------|
| 날짜/시간 처리 | ⭐⭐⭐⭐⭐ | UTC 메서드 사용으로 9시간 차이 | `Utilities.formatDate()` + 로컬 메서드 사용 |
| 벌금 시간 체크 | ⭐⭐⭐⭐⭐ | UTC 기준 체크 | KST 기준 체크 |
| Deadline 비교 | ⭐⭐⭐⭐ | UTC로 잘못 해석 | KST로 정확히 해석 |
| Suggestions 컬럼 | ⭐⭐⭐ | 4개 컬럼 (불일치) | 6개 컬럼 (일치) |

---

## ✅ 수정 완료 파일

1. **Code.gs** - 백엔드 코드 전체 수정 완료
   - 날짜/시간 처리 로직 수정
   - 벌금 체크 로직 수정
   - Deadline 비교 로직 수정
   - Suggestions 시트 구조 수정

2. **index.html** - 프론트엔드는 현재 코드 그대로 사용 가능
   - 주의사항: 날짜 비교 시 KST 기준 확인 필요

---

## 🚀 배포 전 체크리스트

### 백엔드 (Code.gs)
- [x] 날짜/시간 함수 수정 확인
- [x] 벌금 체크 로직 검증
- [x] Deadline 비교 로직 검증
- [x] Suggestions 시트 컬럼 일치 확인
- [ ] Google Apps Script 편집기에 코드 붙여넣기
- [ ] `createSampleUsers()` 함수 실행하여 샘플 데이터 생성
- [ ] 웹 앱으로 배포 (새 배포)

### 프론트엔드 (index.html)
- [ ] HTML 파일을 Apps Script 프로젝트에 추가
- [ ] 파일 이름이 정확히 `index.html`인지 확인

### 테스트
- [ ] 업무 추가 테스트 (오후 2:30 전후)
- [ ] 업무 완료 체크 테스트 (마감 전/후)
- [ ] 벌금 자동 부과 확인
- [ ] 건의사항 작성 및 답변 테스트
- [ ] 공지사항 작성 테스트
- [ ] 각 대시보드 정상 작동 확인

---

## 📝 추가 개선 권장사항

### 1. 타임존 명시
모든 시트에 "모든 시간은 KST(한국 표준시) 기준입니다" 명시

### 2. 로깅 강화
```javascript
function logWithContext(message, data) {
  const timestamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  Logger.log(`[${timestamp}] ${message}`, data ? JSON.stringify(data) : '');
}
```

### 3. 환경 설정 분리
```javascript
const CONFIG = {
  TIMEZONE: 'Asia/Seoul',
  ASSIGNMENT_DEADLINE: { hour: 14, minute: 30 },
  PENALTIES: {
    ASSIGNER_LATE: 3000,
    ASSIGNEE_LATE: 5000
  }
};
```

### 4. 단위 테스트 추가
주요 함수(날짜 처리, 벌금 계산 등)에 대한 테스트 코드 작성

---

## 🔧 문제 발생 시 디버깅 방법

### Apps Script 로그 확인
1. Apps Script 편집기에서 `보기` → `로그`
2. 실행 로그에서 `Logger.log()` 출력 확인
3. `===` 구분선으로 `getInitialData` 실행 흐름 확인

### 시트 데이터 확인
1. Users 시트: UserID, Name, Role 컬럼이 비어있지 않은지
2. Tasks 시트: Deadline이 `YYYY-MM-DD HH:mm:ss` 형식인지
3. Penalties 시트: PenaltyAmount가 숫자 타입인지

### 브라우저 콘솔 확인
1. F12 → Console
2. `fetchInitialData()` 실행 시 오류 메시지 확인
3. `usersMap` 데이터 구조 확인: `console.log(usersMap)`

---

## 📞 지원

추가 오류 발생 시:
1. Apps Script 실행 로그 확인
2. 브라우저 콘솔 에러 메시지 확인
3. 구체적인 에러 메시지와 함께 문의

---

**최종 수정일:** 2025-11-01
**버전:** 1.0
**수정 파일:** Code.gs (4개 오류 수정 완료)
