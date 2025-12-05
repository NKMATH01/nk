import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// 응답 인터셉터: 에러 처리
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 세션 만료 시 로그아웃
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('userData');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ============================================================================
// API 함수들
// ============================================================================

// 보고서 관련
export const reportApi = {
  getReports: (studentId, type) =>
    api.get(`/reports/students/${studentId}`, { params: { type } }),

  getReport: (reportId) =>
    api.get(`/reports/${reportId}`),

  generateReport: (data) =>
    api.post('/reports/generate', data),

  getReportStatus: (reportId) =>
    api.get(`/reports/${reportId}/status`)
};

// 시험 관련
export const examApi = {
  getPapers: (params) =>
    api.get('/exams/papers', { params }),

  createPaper: (data) =>
    api.post('/exams/papers', data),

  distributePaper: (paperId) =>
    api.post(`/exams/papers/${paperId}/distribute`),

  getAvailableExams: () =>
    api.get('/exams/available'),

  getSubmission: (submissionId) =>
    api.get(`/exams/submissions/${submissionId}`),

  submitExam: (submissionId, data) =>
    api.post(`/exams/submissions/${submissionId}/submit`, data)
};

// 학생 관련
export const studentApi = {
  getStudents: (classId) =>
    api.get('/students', { params: { classId } }),

  getStudent: (studentId) =>
    api.get(`/students/${studentId}`),

  getComprehensive: (studentId) =>
    api.get(`/students/${studentId}/comprehensive`),

  getMoodLogs: (studentId, limit) =>
    api.get(`/students/${studentId}/mood`, { params: { limit } }),

  createMoodLog: (studentId, data) =>
    api.post(`/students/${studentId}/mood`, data),

  getFeedback: (studentId) =>
    api.get(`/students/${studentId}/feedback`)
};
