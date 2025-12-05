/**
 * Supabase 클라이언트 설정
 * Zone A (Read-Only) 및 Zone B (Read/Write) 접근 관리
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 일반 클라이언트 (RLS 적용)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 서비스 역할 클라이언트 (RLS 우회, 서버 전용)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Zone A 테이블 목록 (Read-Only)
 * 이 테이블들에 대한 쓰기 작업은 차단됩니다.
 */
const ZONE_A_TABLES = ['students', 'instructors', 'classes', 'homework_logs'];

/**
 * Zone B 테이블 목록 (Read/Write)
 */
const ZONE_B_TABLES = ['exam_papers', 'student_exam_submissions', 'daily_mood_logs', 'ai_report_history'];

/**
 * Zone A 쓰기 작업 방지 유틸리티
 */
function isZoneATable(tableName) {
  return ZONE_A_TABLES.includes(tableName);
}

function assertWriteAllowed(tableName) {
  if (isZoneATable(tableName)) {
    throw new Error(`SECURITY VIOLATION: Zone A 테이블 '${tableName}'에 대한 쓰기 작업은 금지되어 있습니다.`);
  }
}

module.exports = {
  supabase,
  supabaseAdmin,
  ZONE_A_TABLES,
  ZONE_B_TABLES,
  isZoneATable,
  assertWriteAllowed
};
