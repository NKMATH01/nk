import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { reportApi } from '../../services/api';
import { ArrowLeft, Calendar, TrendingUp, Target, MessageCircle, Lightbulb } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function ParentReport() {
  const { reportId } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => reportApi.getReport(reportId),
    enabled: !!reportId
  });

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !data?.data?.report) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">보고서를 불러올 수 없습니다.</p>
        <Link to="/parent" className="btn-primary mt-4 inline-block">
          돌아가기
        </Link>
      </div>
    );
  }

  const report = data.data.report;
  const content = report.report_content;

  return (
    <div className="space-y-6 pb-12">
      {/* Back Button */}
      <Link
        to="/parent"
        className="inline-flex items-center text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        뒤로 가기
      </Link>

      {/* Report Header */}
      <div className="card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              report.report_type === 'weekly'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700'
            }`}>
              {report.report_type === 'weekly' ? '주간 보고서' : '월간 보고서'}
            </span>
            <h1 className="text-2xl font-bold text-gray-900 mt-3">
              {content?.title || '학습 보고서'}
            </h1>
          </div>
          <div className="flex items-center text-gray-500 text-sm">
            <Calendar className="w-4 h-4 mr-1" />
            {format(new Date(report.report_period_start), 'yyyy년 M월 d일', { locale: ko })} ~{' '}
            {format(new Date(report.report_period_end), 'M월 d일', { locale: ko })}
          </div>
        </div>

        {/* Summary */}
        {content?.summary && (
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-gray-700 leading-relaxed">{content.summary}</p>
          </div>
        )}
      </div>

      {/* Detailed Analysis */}
      {content?.detailedAnalysis && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Strengths */}
          <div className="card">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <h2 className="font-semibold text-gray-900">강점</h2>
            </div>
            <ul className="space-y-2">
              {content.detailedAnalysis.strengths?.map((item, idx) => (
                <li key={idx} className="flex items-start space-x-2">
                  <span className="text-green-500 mt-1">•</span>
                  <span className="text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Areas for Improvement */}
          <div className="card">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                <Target className="w-4 h-4 text-orange-600" />
              </div>
              <h2 className="font-semibold text-gray-900">개선 영역</h2>
            </div>
            <ul className="space-y-2">
              {content.detailedAnalysis.areasForImprovement?.map((item, idx) => (
                <li key={idx} className="flex items-start space-x-2">
                  <span className="text-orange-500 mt-1">•</span>
                  <span className="text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Exam Performance */}
      {content?.detailedAnalysis?.examPerformance && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">시험 성적 분석</h2>
          <div className="bg-blue-50 rounded-xl p-4 mb-3">
            <p className="font-medium text-blue-900">
              {content.detailedAnalysis.examPerformance.overview}
            </p>
          </div>
          <p className="text-gray-700">
            {content.detailedAnalysis.examPerformance.details}
          </p>
        </div>
      )}

      {/* Homework Performance */}
      {content?.detailedAnalysis?.homeworkPerformance && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">숙제 수행 분석</h2>
          <div className="bg-green-50 rounded-xl p-4 mb-3">
            <p className="font-medium text-green-900">
              {content.detailedAnalysis.homeworkPerformance.overview}
            </p>
          </div>
          <p className="text-gray-700">
            {content.detailedAnalysis.homeworkPerformance.details}
          </p>
        </div>
      )}

      {/* Attitude Assessment */}
      {content?.detailedAnalysis?.attitudeAssessment && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">학습 태도 평가</h2>
          <div className="bg-purple-50 rounded-xl p-4 mb-3">
            <p className="font-medium text-purple-900">
              {content.detailedAnalysis.attitudeAssessment.overview}
            </p>
          </div>
          <p className="text-gray-700">
            {content.detailedAnalysis.attitudeAssessment.details}
          </p>
        </div>
      )}

      {/* Recommendations */}
      {content?.recommendations && content.recommendations.length > 0 && (
        <div className="card bg-gradient-to-br from-primary-50 to-white">
          <div className="flex items-center space-x-2 mb-4">
            <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
              <Lightbulb className="w-4 h-4 text-primary-600" />
            </div>
            <h2 className="font-semibold text-gray-900">가정에서 실천할 수 있는 조언</h2>
          </div>
          <ul className="space-y-3">
            {content.recommendations.map((item, idx) => (
              <li key={idx} className="flex items-start space-x-3">
                <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-sm font-medium">
                  {idx + 1}
                </span>
                <span className="text-gray-700">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Encouragement Message */}
      {content?.encouragementMessage && (
        <div className="card bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
          <div className="flex items-start space-x-3">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-amber-900 mb-1">격려의 말</h3>
              <p className="text-amber-800 leading-relaxed">
                {content.encouragementMessage}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Report Info */}
      <div className="text-center text-sm text-gray-400">
        <p>
          이 보고서는 {format(new Date(report.created_at), 'yyyy년 M월 d일 HH:mm', { locale: ko })}에 생성되었습니다.
        </p>
        <p className="mt-1">
          AI 모델: {report.ai_model || 'Gemini 2.5 Pro'}
        </p>
      </div>
    </div>
  );
}
