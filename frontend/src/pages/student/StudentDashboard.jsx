import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { examApi, studentApi } from '../../services/api';
import { ClipboardList, Star, MessageCircle, Clock, ChevronRight, AlertCircle, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function StudentDashboard() {
  const { user } = useAuth();
  const studentId = user?.id;

  // 배포된 시험 목록
  const { data: examsData, isLoading: examsLoading } = useQuery({
    queryKey: ['available-exams'],
    queryFn: () => examApi.getAvailableExams()
  });

  // AI 피드백
  const { data: feedbackData } = useQuery({
    queryKey: ['student-feedback', studentId],
    queryFn: () => studentApi.getFeedback(studentId),
    enabled: !!studentId
  });

  const availableExams = examsData?.data?.exams || [];
  const feedback = feedbackData?.data?.feedback;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
            <span className="text-2xl">
              {user?.name?.charAt(0) || ''}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              안녕하세요, {user?.name}!
            </h1>
            <p className="text-gray-500">
              {user?.grade} · {user?.className}
            </p>
          </div>
        </div>
      </div>

      {/* Pending Exams Alert */}
      {availableExams.length > 0 && (
        <div className="card bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-5 h-5 text-orange-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-orange-900">
                제출 대기 중인 시험이 {availableExams.length}개 있어요!
              </h3>
              <p className="text-sm text-orange-700">
                아래 시험을 클릭하여 응시해주세요.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Available Exams */}
      <div className="card">
        <div className="flex items-center space-x-2 mb-4">
          <ClipboardList className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">응시 가능한 시험</h2>
        </div>

        {examsLoading ? (
          <div className="py-8 text-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
            로딩 중...
          </div>
        ) : availableExams.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>현재 응시 가능한 시험이 없습니다.</p>
            <p className="text-sm mt-1">선생님이 시험을 배포하면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {availableExams.map((exam) => (
              <Link
                key={exam.submissionId}
                to={`/student/exam/${exam.submissionId}`}
                className="block p-4 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{exam.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {exam.subject} · {exam.total_questions}문제 · {exam.total_points}점
                    </p>
                    {exam.due_date && (
                      <p className="text-sm text-orange-600 mt-1 flex items-center">
                        <Clock className="w-3 h-3 mr-1" />
                        마감: {format(new Date(exam.due_date), 'M월 d일 HH:mm', { locale: ko })}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* AI Feedback */}
      <div className="card">
        <div className="flex items-center space-x-2 mb-4">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h2 className="font-semibold text-gray-900">AI 피드백</h2>
        </div>

        {feedback?.examFeedback ? (
          <div className="bg-purple-50 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-purple-900">
                {feedback.examFeedback.examTitle}
              </span>
              <span className={`text-lg font-bold ${
                feedback.examFeedback.percentage >= 80 ? 'text-green-600' :
                feedback.examFeedback.percentage >= 60 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {feedback.examFeedback.percentage?.toFixed(0)}점
              </span>
            </div>
            {feedback.examFeedback.analysis && (
              <div className="space-y-2 text-sm text-purple-800">
                {feedback.examFeedback.analysis.suggestion && (
                  <p>
                    <strong>제안:</strong> {feedback.examFeedback.analysis.suggestion}
                  </p>
                )}
                {feedback.examFeedback.analysis.encouragement && (
                  <p>
                    <strong>격려:</strong> {feedback.examFeedback.analysis.encouragement}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">아직 AI 분석 데이터가 없습니다.</p>
        )}

        {feedback?.encouragement && (
          <div className="bg-amber-50 rounded-xl p-4">
            <div className="flex items-start space-x-3">
              <MessageCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-800">
                  {format(new Date(feedback.encouragement.date), 'M월 d일', { locale: ko })} 격려 메시지
                </p>
                <p className="text-amber-900 font-medium mt-1">
                  "{feedback.encouragement.message}"
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
