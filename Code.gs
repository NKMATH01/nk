// ===================================
// NK 학원 업무 관리 시스템 - 완전 수정 버전
// ===================================

// --- 설정 ---
const SHEET_USERS = 'Users';
const SHEET_TASKS = 'Tasks';
const SHEET_PENALTIES = 'Penalties';
const SHEET_SUGGESTIONS = 'Suggestions';
const SHEET_ANNOUNCEMENTS = 'Announcements';

// 벌금 정책
const ASSIGNMENT_DEADLINE_HOUR = 14;
const ASSIGNMENT_DEADLINE_MINUTE = 30;
const ASSIGNER_LATE_PENALTY = 3000;
const ASSIGNEE_LATE_PENALTY = 5000;

// --- HTML 페이지 제공 ---
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('NK 학원 업무 관리 시스템')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// --- 스프레드시트 객체 가져오기 ---
function getSpreadsheet() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    throw new Error('스프레드시트를 열 수 없습니다: ' + e.message);
  }
}

// --- 현재 한국 시간 가져오기 (KST, UTC+9) ---
function getKSTNow() {
  // Session.getScriptTimeZone()을 사용하여 스크립트 시간대 기준으로 Date 반환
  const now = new Date();
  const timeZone = 'Asia/Seoul';
  return new Date(Utilities.formatDate(now, timeZone, 'yyyy-MM-dd\'T\'HH:mm:ss'));
}

// --- 날짜/시간 포맷팅 ---
function formatDateTime(date) {
  // KST로 이미 변환된 Date를 받으므로 로컬 메서드 사용
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function formatDate(date) {
  // KST로 이미 변환된 Date를 받으므로 로컬 메서드 사용
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- 안전한 문자열 변환 및 trim ---
function safeStringTrim(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

// --- 데이터 파싱 (완전 수정 버전) ---
function parseSheetData(values, sheetName) {
  if (!values || values.length === 0) {
    Logger.log(`[${sheetName}] 데이터가 비어있음`);
    return [];
  }

  if (values.length === 1) {
    Logger.log(`[${sheetName}] 헤더만 있음`);
    return [];
  }

  const headers = values[0].map(h => safeStringTrim(h));
  const rows = values.slice(1);

  Logger.log(`[${sheetName}] 헤더: ${JSON.stringify(headers)}`);
  Logger.log(`[${sheetName}] 원본 행 수: ${rows.length}`);

  // 빈 행 필터링 (모든 셀이 비어있는 경우)
  const validRows = rows.filter(row => {
    return row.some(cell => {
      const val = safeStringTrim(cell);
      return val !== '';
    });
  });

  Logger.log(`[${sheetName}] 유효 행 수: ${validRows.length}`);

  return validRows.map((row, rowIndex) => {
    const obj = {};

    headers.forEach((header, colIndex) => {
      if (!header) return; // 빈 헤더 스킵

      const value = row[colIndex];
      const strValue = safeStringTrim(value);

      // 기본값 설정
      if (strValue === '') {
        if (header.endsWith('ID')) {
          obj[header] = '';
        } else if (header.endsWith('Amount')) {
          obj[header] = 0;
        } else if (header === 'CompletedTime' || header === 'ActionTime') {
          obj[header] = '-';
        } else {
          obj[header] = '';
        }
      } else {
        // 숫자 타입 유지
        if (header.endsWith('Amount') || header === 'PenaltyAmount') {
          obj[header] = Number(value) || 0;
        } else {
          obj[header] = strValue;
        }
      }
    });

    // 디버깅: 처음 3개 행만 로그
    if (rowIndex < 3) {
      Logger.log(`[${sheetName}] 행${rowIndex + 1}: ${JSON.stringify(obj)}`);
    }

    return obj;
  });
}

// --- 초기 데이터 로드 (완전 수정 버전) ---
function getInitialData() {
  try {
    Logger.log('========================================');
    Logger.log('===     getInitialData 시작          ===');
    Logger.log('========================================');

    const ss = getSpreadsheet();

    // === Users 시트 확인 및 생성 ===
    let usersSheet = ss.getSheetByName(SHEET_USERS);

    if (!usersSheet) {
      Logger.log('⚠️ Users 시트가 없습니다. 생성합니다...');
      createSampleUsers();
      usersSheet = ss.getSheetByName(SHEET_USERS);
    }

    const usersLastRow = usersSheet.getLastRow();
    if (usersLastRow <= 1) {
      Logger.log('⚠️ Users 시트가 비어있습니다. 샘플 생성...');
      createSampleUsers();
      usersSheet = ss.getSheetByName(SHEET_USERS);
    }

    // === 다른 시트들 확인 및 생성 ===
    let tasksSheet = ss.getSheetByName(SHEET_TASKS);
    if (!tasksSheet) {
      tasksSheet = ss.insertSheet(SHEET_TASKS);
      tasksSheet.appendRow([
        'TaskID', 'AssignDate', 'AssignTimestamp', 'AssigneeID', 'AssignerID',
        'TaskName', 'TaskType', 'Priority', 'Deadline', 'Status',
        'CompletedTime', 'Memo', 'FileUrl'
      ]);
    }

    let penaltiesSheet = ss.getSheetByName(SHEET_PENALTIES);
    if (!penaltiesSheet) {
      penaltiesSheet = ss.insertSheet(SHEET_PENALTIES);
      penaltiesSheet.appendRow([
        'PenaltyID', 'Date', 'UserID', 'PenaltyType', 'TaskName',
        'Deadline', 'ActionTime', 'Delay', 'PenaltyAmount'
      ]);
    }

    let suggestionsSheet = ss.getSheetByName(SHEET_SUGGESTIONS);
    if (!suggestionsSheet) {
      suggestionsSheet = ss.insertSheet(SHEET_SUGGESTIONS);
      suggestionsSheet.appendRow(['SuggestionID', 'Timestamp', 'SubmitterID', 'SuggestionText', 'Reply', 'ReplyTime']);
    }

    let announcementsSheet = ss.getSheetByName(SHEET_ANNOUNCEMENTS);
    if (!announcementsSheet) {
      announcementsSheet = ss.insertSheet(SHEET_ANNOUNCEMENTS);
      announcementsSheet.appendRow(['AnnouncementID', 'Timestamp', 'AuthorID', 'Title', 'Content']);
    }

    // === 데이터 읽기 ===
    Logger.log('\n--- 데이터 읽기 ---');

    const usersData = usersSheet.getDataRange().getValues();
    const tasksData = tasksSheet.getDataRange().getValues();
    const penaltiesData = penaltiesSheet.getDataRange().getValues();
    const suggestionsData = suggestionsSheet.getDataRange().getValues();
    const announcementsData = announcementsSheet.getDataRange().getValues();

    Logger.log(`Users: ${usersData.length}행, Tasks: ${tasksData.length}행`);

    // === 데이터 파싱 ===
    const usersList = parseSheetData(usersData, 'Users');
    const tasksList = parseSheetData(tasksData, 'Tasks');
    const penaltiesList = parseSheetData(penaltiesData, 'Penalties');
    const suggestionsList = parseSheetData(suggestionsData, 'Suggestions');
    const announcementsList = parseSheetData(announcementsData, 'Announcements');

    Logger.log(`\n파싱 결과: Users=${usersList.length}, Tasks=${tasksList.length}`);

    // === Users Map 생성 (완전 수정) ===
    Logger.log('\n--- Users Map 생성 ---');

    const usersMap = {};
    let validCount = 0;
    let invalidCount = 0;

    usersList.forEach((user, index) => {
      const userId = safeStringTrim(user.UserID);
      const userName = safeStringTrim(user.Name);
      const userRole = safeStringTrim(user.Role);

      // UserID와 Name이 필수
      if (!userId || !userName) {
        Logger.log(`⚠️ 행${index + 2}: UserID 또는 Name 없음 - ${JSON.stringify(user)}`);
        invalidCount++;
        return;
      }

      // Role이 비어있으면 '강사'로 기본값 설정
      const finalRole = userRole || '강사';

      usersMap[userId] = {
        UserID: userId,
        Name: userName,
        Role: finalRole
      };

      validCount++;
      Logger.log(`✓ ${userId} = ${userName} (${finalRole})`);
    });

    Logger.log(`\n✅ Users Map 완료: 유효=${validCount}, 무효=${invalidCount}`);
    Logger.log(`총 키 수: ${Object.keys(usersMap).length}`);

    // === 최종 검증 ===
    if (Object.keys(usersMap).length === 0) {
      throw new Error('Users 데이터가 없습니다. Users 시트를 확인하세요.');
    }

    // === 결과 반환 ===
    const result = {
      users: usersMap,
      tasks: tasksList,
      penalties: penaltiesList,
      suggestions: suggestionsList,
      announcements: announcementsList
    };

    Logger.log('\n========================================');
    Logger.log('===   getInitialData 성공 완료       ===');
    Logger.log('========================================');

    return result;

  } catch (e) {
    Logger.log('\n❌ getInitialData 실패: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    throw new Error('데이터 로드 실패: ' + e.message);
  }
}

// --- 새 업무 추가 ---
function addNewTasks(taskData) {
  try {
    const ss = getSpreadsheet();
    const tasksSheet = ss.getSheetByName(SHEET_TASKS);
    const penaltiesSheet = ss.getSheetByName(SHEET_PENALTIES);

    const { assigner, receivers, taskName, taskType, priority, deadlineDate, deadlineTime, memo, fileUrl } = taskData;

    if (!assigner || !receivers || receivers.length === 0 || !taskName || !taskType || !deadlineDate || !deadlineTime) {
      throw new Error('필수 필드가 누락되었습니다.');
    }

    const kstNow = getKSTNow();
    const assignTimestamp = formatDateTime(kstNow);
    const assignDate = formatDate(kstNow);
    const deadline = `${deadlineDate} ${deadlineTime}`;

    // 다음 TaskID
    const lastRow = tasksSheet.getLastRow();
    let nextTaskId = 1;
    if (lastRow > 1) {
      const taskIds = tasksSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      const maxId = Math.max(...taskIds.map(row => Number(row[0]) || 0));
      nextTaskId = maxId + 1;
    }

    // 새 업무 행 생성
    const newRows = [];
    receivers.forEach(receiverId => {
      newRows.push([
        nextTaskId++,
        assignDate,
        assignTimestamp,
        receiverId,
        assigner,
        taskName,
        taskType,
        priority,
        deadline,
        '미완료',
        '-',
        memo || '',
        fileUrl || ''
      ]);
    });

    // Tasks 시트에 추가
    tasksSheet.getRange(lastRow + 1, 1, newRows.length, 13).setValues(newRows);

    // 할당 지연 벌금 체크 (KST 기준)
    const dayOfWeek = kstNow.getDay();
    const hour = kstNow.getHours();
    const minute = kstNow.getMinutes();
    const isWeekday = dayOfWeek > 0 && dayOfWeek < 6;
    const isLate = hour > ASSIGNMENT_DEADLINE_HOUR ||
                   (hour === ASSIGNMENT_DEADLINE_HOUR && minute > ASSIGNMENT_DEADLINE_MINUTE);

    let penaltyAdded = false;
    if (isWeekday && isLate) {
      const penaltyLastRow = penaltiesSheet.getLastRow();
      let nextPenaltyId = 1;
      if (penaltyLastRow > 1) {
        const penaltyIds = penaltiesSheet.getRange(2, 1, penaltyLastRow - 1, 1).getValues();
        const maxPenaltyId = Math.max(...penaltyIds.map(row => Number(row[0]) || 0));
        nextPenaltyId = maxPenaltyId + 1;
      }

      const deadlineTime = `${String(ASSIGNMENT_DEADLINE_HOUR).padStart(2, '0')}:${String(ASSIGNMENT_DEADLINE_MINUTE).padStart(2, '0')}`;

      const penaltyRow = [
        nextPenaltyId,
        assignDate,
        assigner,
        'assigner_late',
        `업무 할당 (${receivers.length}건)`,
        `${assignDate} ${deadlineTime}`,
        assignTimestamp,
        '할당 지연',
        ASSIGNER_LATE_PENALTY
      ];

      penaltiesSheet.appendRow(penaltyRow);
      penaltyAdded = true;
    }

    return {
      message: `업무 ${newRows.length}건이 추가되었습니다.${penaltyAdded ? ' (할당 지연 벌금 발생)' : ''}`,
      penaltyAdded: penaltyAdded
    };

  } catch (e) {
    throw new Error('업무 추가 실패: ' + e.message);
  }
}

// --- 업무 상태 업데이트 ---
function updateTaskStatus(taskId, isChecked, deadline) {
  try {
    const ss = getSpreadsheet();
    const tasksSheet = ss.getSheetByName(SHEET_TASKS);
    const penaltiesSheet = ss.getSheetByName(SHEET_PENALTIES);

    const taskIds = tasksSheet.getRange(2, 1, tasksSheet.getLastRow() - 1, 1).getValues();
    const rowIndex = taskIds.findIndex(row => String(row[0]) === String(taskId));

    if (rowIndex === -1) {
      throw new Error('해당 업무를 찾을 수 없습니다.');
    }

    const actualRow = rowIndex + 2;

    const kstNow = getKSTNow();
    const kstTimestamp = formatDateTime(kstNow);
    // deadline은 KST 기준 문자열이므로 직접 Date 객체로 변환
    const deadlineDate = new Date(deadline.replace(' ', 'T'));

    let newStatus, newCompletedTime;
    let penaltyAction = 'none';

    const taskRow = tasksSheet.getRange(actualRow, 1, 1, 13).getValues()[0];
    const assigneeId = taskRow[3];
    const taskName = taskRow[5];

    if (isChecked) {
      newCompletedTime = kstTimestamp;
      if (kstNow > deadlineDate) {
        newStatus = '지연';
        penaltyAction = 'add';
      } else {
        newStatus = '완료';
        penaltyAction = 'none';
      }
    } else {
      newCompletedTime = '-';
      if (kstNow > deadlineDate) {
        newStatus = '지연';
        penaltyAction = 'add';
      } else {
        newStatus = '미완료';
        penaltyAction = 'remove';
      }
    }

    tasksSheet.getRange(actualRow, 10).setValue(newStatus);
    tasksSheet.getRange(actualRow, 11).setValue(newCompletedTime);

    // 벌금 처리
    if (penaltyAction === 'add') {
      const penaltiesData = penaltiesSheet.getDataRange().getValues();
      const existingPenalty = penaltiesData.slice(1).some(row =>
        String(row[2]) === String(assigneeId) &&
        row[3] === 'assignee_late' &&
        row[4].includes(taskName)
      );

      if (!existingPenalty) {
        const penaltyLastRow = penaltiesSheet.getLastRow();
        let nextPenaltyId = 1;
        if (penaltyLastRow > 1) {
          const penaltyIds = penaltiesSheet.getRange(2, 1, penaltyLastRow - 1, 1).getValues();
          const maxPenaltyId = Math.max(...penaltyIds.map(row => Number(row[0]) || 0));
          nextPenaltyId = maxPenaltyId + 1;
        }

        const delayText = isChecked ? '지연 완료' : '미완료';
        const todayDate = formatDate(kstNow);

        const penaltyRow = [
          nextPenaltyId,
          todayDate,
          assigneeId,
          'assignee_late',
          taskName,
          deadline,
          isChecked ? kstTimestamp : '미완료',
          delayText,
          ASSIGNEE_LATE_PENALTY
        ];

        penaltiesSheet.appendRow(penaltyRow);
      }
    } else if (penaltyAction === 'remove') {
      const penaltiesData = penaltiesSheet.getDataRange().getValues();
      for (let i = penaltiesData.length - 1; i > 0; i--) {
        const row = penaltiesData[i];
        if (String(row[2]) === String(assigneeId) &&
            row[3] === 'assignee_late' &&
            row[4].includes(taskName)) {
          penaltiesSheet.deleteRow(i + 1);
          break;
        }
      }
    }

    return {
      message: '업무 상태가 업데이트되었습니다.',
      taskId: taskId,
      newStatus: newStatus,
      newCompletedTime: newCompletedTime
    };

  } catch (e) {
    throw new Error('상태 업데이트 실패: ' + e.message);
  }
}

// --- 업무 메모 업데이트 ---
function updateTaskMemo(taskId, newMemo) {
  try {
    const ss = getSpreadsheet();
    const tasksSheet = ss.getSheetByName(SHEET_TASKS);

    const taskIds = tasksSheet.getRange(2, 1, tasksSheet.getLastRow() - 1, 1).getValues();
    const rowIndex = taskIds.findIndex(row => String(row[0]) === String(taskId));

    if (rowIndex === -1) {
      throw new Error('해당 업무를 찾을 수 없습니다.');
    }

    const actualRow = rowIndex + 2;
    tasksSheet.getRange(actualRow, 12).setValue(newMemo || '');

    return {
      message: '메모가 업데이트되었습니다.',
      taskId: taskId
    };

  } catch (e) {
    throw new Error('메모 업데이트 실패: ' + e.message);
  }
}

// --- 건의사항 추가 ---
function addSuggestion(suggestionText, submitterId) {
  try {
    Logger.log('=== 건의사항 추가 ===');
    Logger.log('제출자: ' + submitterId);
    Logger.log('내용: ' + suggestionText);

    const ss = getSpreadsheet();
    let suggestionsSheet = ss.getSheetByName(SHEET_SUGGESTIONS);

    if (!suggestionsSheet) {
      suggestionsSheet = ss.insertSheet(SHEET_SUGGESTIONS);
      suggestionsSheet.appendRow(['SuggestionID', 'Timestamp', 'SubmitterID', 'SuggestionText', 'Reply', 'ReplyTime']);
    }

    const kstNow = getKSTNow();
    const timestamp = formatDateTime(kstNow);

    const lastRow = suggestionsSheet.getLastRow();
    let nextId = 1;
    if (lastRow > 1) {
      const ids = suggestionsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      const maxId = Math.max(...ids.map(row => Number(row[0]) || 0));
      nextId = maxId + 1;
    }

    const newRow = [
      nextId,
      timestamp,
      submitterId,
      suggestionText,
      '', // Reply (빈 값)
      ''  // ReplyTime (빈 값)
    ];

    suggestionsSheet.appendRow(newRow);

    const usersSheet = ss.getSheetByName(SHEET_USERS);
    const usersData = usersSheet.getDataRange().getValues();
    const submitter = usersData.slice(1).find(row => safeStringTrim(row[0]) === safeStringTrim(submitterId));
    const submitterName = submitter ? submitter[1] : '알 수 없음';

    Logger.log('✅ 건의사항 추가 완료');

    return `건의사항이 대표님께 성공적으로 전달되었습니다. (제출자: ${submitterName})`;

  } catch (e) {
    Logger.log('❌ 건의사항 실패: ' + e.message);
    throw new Error('건의사항 추가 실패: ' + e.message);
  }
}

// --- 공지사항 추가 ---
function addAnnouncement(title, content) {
  try {
    const ss = getSpreadsheet();
    let announcementsSheet = ss.getSheetByName(SHEET_ANNOUNCEMENTS);

    if (!announcementsSheet) {
      announcementsSheet = ss.insertSheet(SHEET_ANNOUNCEMENTS);
      announcementsSheet.appendRow(['AnnouncementID', 'Timestamp', 'AuthorID', 'Title', 'Content']);
    }

    const kstNow = getKSTNow();
    const timestamp = formatDateTime(kstNow);

    const lastRow = announcementsSheet.getLastRow();
    let nextId = 1;
    if (lastRow > 1) {
      const ids = announcementsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      const maxId = Math.max(...ids.map(row => Number(row[0]) || 0));
      nextId = maxId + 1;
    }

    const authorId = 'CEO';

    const newRow = [
      nextId,
      timestamp,
      authorId,
      title,
      content
    ];

    announcementsSheet.appendRow(newRow);

    return `공지사항이 성공적으로 등록되었습니다.`;

  } catch (e) {
    throw new Error('공지사항 추가 실패: ' + e.message);
  }
}

// --- 샘플 Users 데이터 생성 ---
function createSampleUsers() {
  try {
    Logger.log('=== 샘플 Users 생성 ===');

    const ss = getSpreadsheet();
    let usersSheet = ss.getSheetByName(SHEET_USERS);

    if (!usersSheet) {
      usersSheet = ss.insertSheet(SHEET_USERS);
    } else {
      usersSheet.clear();
    }

    usersSheet.appendRow(['UserID', 'Name', 'Role', 'Password']);

    const sampleData = [
      ['CEO', '김대표', '대표', '1234'],
      ['T001', '박팀장', '학습팀장', '1111'],
      ['T002', '이팀장', '연구팀장', '2222'],
      ['T003', '최부장', '본부장', '3333'],
      ['S001', '홍강사', '강사', '1001'],
      ['S002', '정강사', '강사', '1002'],
      ['S003', '강강사', '강사', '1003'],
      ['S004', '윤강사', '강사', '1004'],
      ['S005', '임강사', '강사', '1005'],
      ['S006', '서강사', '강사', '1006'],
      ['S007', '오강사', '강사', '1007']
    ];

    sampleData.forEach(row => {
      usersSheet.appendRow(row);
    });

    const headerRange = usersSheet.getRange(1, 1, 1, 4);
    headerRange.setBackground('#667eea');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');

    usersSheet.autoResizeColumns(1, 4);

    Logger.log(`✅ ${sampleData.length}명 생성 완료`);

    return `샘플 Users 데이터가 생성되었습니다. (${sampleData.length}명)`;

  } catch (e) {
    Logger.log('❌ 샘플 생성 실패: ' + e.message);
    throw new Error('샘플 생성 실패: ' + e.message);
  }
}

// --- 비밀번호 확인 ---
function checkPassword(userId, password) {
  try {
    const ss = getSpreadsheet();
    const usersSheet = ss.getSheetByName(SHEET_USERS);
    const usersData = usersSheet.getDataRange().getValues();

    const user = usersData.slice(1).find(row => safeStringTrim(row[0]) === safeStringTrim(userId));

    if (!user) {
      return { success: false, message: '사용자를 찾을 수 없습니다.' };
    }

    const storedPassword = safeStringTrim(user[3]); // Password 컬럼

    if (storedPassword === safeStringTrim(password)) {
      return {
        success: true,
        user: {
          UserID: user[0],
          Name: user[1],
          Role: user[2]
        }
      };
    } else {
      return { success: false, message: '비밀번호가 일치하지 않습니다.' };
    }

  } catch (e) {
    Logger.log('❌ 비밀번호 확인 실패: ' + e.message);
    return { success: false, message: '오류가 발생했습니다.' };
  }
}

// --- 건의사항 답장 추가 ---
function replySuggestion(suggestionId, replyText) {
  try {
    Logger.log('=== 건의사항 답장 ===');
    Logger.log('SuggestionID: ' + suggestionId);
    Logger.log('답장: ' + replyText);

    const ss = getSpreadsheet();
    const suggestionsSheet = ss.getSheetByName(SHEET_SUGGESTIONS);

    const suggestionIds = suggestionsSheet.getRange(2, 1, suggestionsSheet.getLastRow() - 1, 1).getValues();
    const rowIndex = suggestionIds.findIndex(row => String(row[0]) === String(suggestionId));

    if (rowIndex === -1) {
      throw new Error('건의사항을 찾을 수 없습니다.');
    }

    const actualRow = rowIndex + 2;
    const kstNow = getKSTNow();
    const replyTime = formatDateTime(kstNow);

    // Reply (5열), ReplyTime (6열)
    suggestionsSheet.getRange(actualRow, 5).setValue(replyText);
    suggestionsSheet.getRange(actualRow, 6).setValue(replyTime);

    Logger.log('✅ 답장 완료');

    return '답장이 성공적으로 등록되었습니다.';

  } catch (e) {
    Logger.log('❌ 답장 실패: ' + e.message);
    throw new Error('답장 실패: ' + e.message);
  }
}
