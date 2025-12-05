import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { studentApi, reportApi } from '../../services/api';
import { ArrowLeft, User, BookOpen, Brain, FileText, Smile, Focus, Hand, Send, Plus, Loader } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function InstructorStudentDetail() {
  const { studentId } = useParams();
  const queryClient = useQueryClient();

  // 종합 데이터 조회
  const { data, isLoading } = useQuery({
    queryKey: ['student-comprehensive', studentId],
    queryFn: () => studentApi.getComprehensive(studentId),
    enabled: !!studentId
  });

  // 보고서 생성 mutation
  const generateReportMutation = useMutation({
    mutationFn: (reportData) => reportApi.generateReport(reportData),
    onSuccess: () => {
      alert('보고서 생성이 시작되었습니다. 생성이 완료되면 학부모가 열람할 수 있습니다.');
    },
    onError: (error) => {
      alert(error.response?.data?.error || '보고서 생성에 실패했습니다.');
    }
  });

  // 태도 기록 mutation
  const moodMutation = useMutation({
    mutationFn: (moodData) => studentApi.createMoodLog(studentId, moodData),
    onSuccess: () => {
      queryClient.invalidateQueries(['student-comprehensive', studentId]);
      setShowMoodForm(false);
      setMoodForm({ moodScore: 3, focusScore: 3, participationScore: 3, instructorNote: '' });
    }
  });

  const [showMoodForm, setShowMoodForm] = useState(false);
  const [moodForm, setMoodForm] = useState({
    moodScore: 3,
    focusScore: 3,
    participationScore: 3,
    instructorNote: ''
  });

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const { student, recentExams, recentHomework, recentMoodLogs, correlationAnalysis } = data?.data || {};

  const handleGenerateReport = (type) => {
    const today = new Date();
    const periodEnd = today.toISOString().split('T')[0];
    const periodStart = new Date(today.setDate(today.getDate() - (type === 'weekly' ? 7 : 30)))
      .toISOString().split('T')[0];

    generateReportMutation.mutate({
      studentId,
      reportType: type,
      periodStart,
      periodEnd
    });
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Back Button */}
      <Link
        to="/instructor"
        className="inline-flex items-center text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        뒤로 가기
      </Link>

      {/* Student Header */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
              <User className="w-8 h-8 text-primary-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{student?.name}</h1>
              <p className="text-gray-500">
                {student?.grade} · {student?.classes?.name}
              </p>
            </div>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => handleGenerateReport('weekly')}
              disabled={generateReportMutation.isPending}
              className="btn-secondary text-sm"
            >
              {generateReportMutation.isPending ? <Loader className="w-4 h-4 animate-spin" /> : '주간 보고서'}
            </button>
            <button
              onClick={() => handleGenerateReport('monthly')}
              disabled={generateReportMutation.isPending}
              className="btn-primary text-sm"
            >
              {generateReportMutation.isPending ? <Loader className="w-4 h-4 animate-spin" /> : '월간 보고서'}
            </button>
          </div>
        </div>
      </div>

      {/* Correlation Analysis */}
      {correlationAnalysis?.hasData && (
        <div className="card bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
          <div className="flex items-center space-x-2 mb-4">
            <Brain className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">숙제-시험 상관관계 분석</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600">
                {correlationAnalysis.avgHomeworkCompletion?.toFixed(1)}%
              </p>
              <p className="text-sm text-gray-500">평균 숙제 완료율</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-pink-600">
                {correlationAnalysis.avgHomeworkAccuracy?.toFixed(1)}%
              </p>
              <p className="text-sm text-gray-500">평균 숙제 정확도</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-600">
                {correlationAnalysis.avgExamScore?.toFixed(1)}%
              </p>
              <p className="text-sm text-gray-500">평균 시험 점수</p>
            </div>
          </div>
          <p className="text-purple-800 font-medium">
            {correlationAnalysis.insight}
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Exams */}
        <div className="card">
          <div className="flex items-center space-x-2 mb-4">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">최근 시험</h2>
          </div>
          {recentExams?.length > 0 ? (
            <div className="space-y-3">
              {recentExams.map((exam) => (
                <div key={exam.id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-900">
                      {exam.exam_papers?.title}
                    </span>
                    <span className={`text-lg font-bold ${
                      exam.percentage >= 80 ? 'text-green-600' :
                      exam.percentage >= 60 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {exam.percentage?.toFixed(0)}점
                    </span>
                  </div>
                  {exam.ai_analysis && (
                    <p className="text-sm text-gray-500">
                      AI 분석: {exam.ai_analysis.suggestion}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">시험 기록이 없습니다.</p>
          )}
        </div>

        {/* Recent Homework */}
        <div className="card">
          <div className="flex items-center space-x-2 mb-4">
            <FileText className="w-5 h-5 text-green-600" />
            <h2 className="font-semibold text-gray-900">최근 숙제</h2>
          </div>
          {recentHomework?.length > 0 ? (
            <div className="space-y-3">
              {recentHomework.map((hw) => (
                <div key={hw.id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-900">
                      {format(new Date(hw.assignment_date), 'M월 d일', { locale: ko })}
                    </span>
                    <span className="text-sm text-gray-500">
                      완료 {hw.completion_rate?.toFixed(0)}% · 정확도 {hw.accuracy_rate?.toFixed(0)}%
                    </span>
                  </div>
                  {hw.notes && (
                    <p className="text-sm text-gray-500">{hw.notes}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">숙제 기록이 없습니다.</p>
          )}
        </div>
      </div>

      {/* Mood Logs */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Smile className="w-5 h-5 text-amber-600" />
            <h2 className="font-semibold text-gray-900">학습 태도 기록</h2>
          </div>
          <button
            onClick={() => setShowMoodForm(!showMoodForm)}
            className="btn-primary text-sm"
          >
            <Plus className="w-4 h-4 mr-1" />
            오늘 기록
          </button>
        </div>

        {/* Mood Form */}
        {showMoodForm && (
          <div className="bg-amber-50 rounded-xl p-4 mb-4">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Smile className="w-4 h-4 inline mr-1" />
                  기분
                </label>
                <select
                  value={moodForm.moodScore}
                  onChange={(e) => setMoodForm({ ...moodForm, moodScore: parseInt(e.target.value) })}
                  className="input text-sm"
                >
                  {[1, 2, 3, 4, 5].map(n => (
                    <option key={n} value={n}>{n}점</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Focus className="w-4 h-4 inline mr-1" />
                  집중도
                </label>
                <select
                  value={moodForm.focusScore}
                  onChange={(e) => setMoodForm({ ...moodForm, focusScore: parseInt(e.target.value) })}
                  className="input text-sm"
                >
                  {[1, 2, 3, 4, 5].map(n => (
                    <option key={n} value={n}>{n}점</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Hand className="w-4 h-4 inline mr-1" />
                  참여도
                </label>
                <select
                  value={moodForm.participationScore}
                  onChange={(e) => setMoodForm({ ...moodForm, participationScore: parseInt(e.target.value) })}
                  className="input text-sm"
                >
                  {[1, 2, 3, 4, 5].map(n => (
                    <option key={n} value={n}>{n}점</option>
                  ))}
                </select>
              </div>
            </div>
            <textarea
              value={moodForm.instructorNote}
              onChange={(e) => setMoodForm({ ...moodForm, instructorNote: e.target.value })}
              placeholder="메모 (선택사항)"
              className="input text-sm mb-3"
              rows={2}
            />
            <button
              onClick={() => moodMutation.mutate(moodForm)}
              disabled={moodMutation.isPending}
              className="btn-primary w-full text-sm"
            >
              {moodMutation.isPending ? '저장 중...' : '저장'}
            </button>
          </div>
        )}

        {/* Mood History */}
        {recentMoodLogs?.length > 0 ? (
          <div className="space-y-3">
            {recentMoodLogs.map((log) => (
              <div key={log.id} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">
                    {format(new Date(log.log_date), 'M월 d일 (EEE)', { locale: ko })}
                  </span>
                  <div className="flex space-x-2 text-sm">
                    <span>기분 {log.mood_score}</span>
                    <span>·</span>
                    <span>집중 {log.focus_score}</span>
                    <span>·</span>
                    <span>참여 {log.participation_score}</span>
                  </div>
                </div>
                {log.instructor_note && (
                  <p className="text-sm text-gray-600 mb-1">{log.instructor_note}</p>
                )}
                {log.ai_encouragement && (
                  <p className="text-sm text-amber-600 italic">
                    AI: "{log.ai_encouragement}"
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-4">태도 기록이 없습니다.</p>
        )}
      </div>
    </div>
  );
}
