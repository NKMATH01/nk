import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { examApi } from '../../services/api';
import { ArrowLeft, Send, AlertCircle, CheckCircle, Loader } from 'lucide-react';

// 오답 원인 옵션
const WRONG_REASONS = [
  { value: '개념_미숙지', label: '개념을 잘 몰랐어요' },
  { value: '계산_실수', label: '계산 실수를 했어요' },
  { value: '문제_오독', label: '문제를 잘못 읽었어요' },
  { value: '시간_부족', label: '시간이 부족했어요' },
  { value: '공식_착오', label: '공식을 잘못 적용했어요' },
  { value: '기타', label: '기타' }
];

export default function StudentExam() {
  const { submissionId } = useParams();
  const navigate = useNavigate();

  const [answers, setAnswers] = useState({});
  const [wrongAnswers, setWrongAnswers] = useState({});
  const [selfAnalysis, setSelfAnalysis] = useState({});

  // 제출 정보 조회
  const { data, isLoading, error } = useQuery({
    queryKey: ['submission', submissionId],
    queryFn: () => examApi.getSubmission(submissionId),
    enabled: !!submissionId
  });

  // 제출 mutation
  const submitMutation = useMutation({
    mutationFn: (data) => examApi.submitExam(submissionId, data),
    onSuccess: (response) => {
      alert('시험이 제출되었습니다!');
      navigate('/student');
    },
    onError: (error) => {
      alert(error.response?.data?.error || '제출에 실패했습니다.');
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !data?.data?.submission) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <p className="text-gray-500">시험을 불러올 수 없습니다.</p>
        <Link to="/student" className="btn-primary mt-4 inline-block">
          돌아가기
        </Link>
      </div>
    );
  }

  const submission = data.data.submission;
  const paper = submission.exam_papers;

  // 이미 제출된 경우
  if (submission.status !== 'pending') {
    return (
      <div className="space-y-6">
        <Link
          to="/student"
          className="inline-flex items-center text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          뒤로 가기
        </Link>

        <div className="card text-center py-12">
          <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">이미 제출된 시험입니다</h2>
          {submission.score !== null && (
            <p className="text-xl text-gray-600">
              점수: <span className="font-bold text-primary-600">{submission.percentage?.toFixed(0)}점</span>
            </p>
          )}
          {submission.ai_analysis && (
            <div className="mt-6 p-4 bg-purple-50 rounded-xl max-w-md mx-auto text-left">
              <p className="text-sm text-purple-600 font-medium mb-1">AI 피드백</p>
              <p className="text-purple-800">{submission.ai_analysis.suggestion}</p>
              <p className="text-purple-600 mt-2 italic">"{submission.ai_analysis.encouragement}"</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const totalQuestions = paper?.total_questions || 10;

  const handleWrongToggle = (questionNum) => {
    if (wrongAnswers[questionNum]) {
      const newWrong = { ...wrongAnswers };
      delete newWrong[questionNum];
      setWrongAnswers(newWrong);

      const newAnalysis = { ...selfAnalysis };
      delete newAnalysis[questionNum];
      setSelfAnalysis(newAnalysis);
    } else {
      setWrongAnswers({ ...wrongAnswers, [questionNum]: true });
    }
  };

  const handleReasonChange = (questionNum, reason) => {
    setSelfAnalysis({
      ...selfAnalysis,
      [questionNum]: { reason, note: selfAnalysis[questionNum]?.note || '' }
    });
  };

  const handleNoteChange = (questionNum, note) => {
    setSelfAnalysis({
      ...selfAnalysis,
      [questionNum]: { ...selfAnalysis[questionNum], note }
    });
  };

  const handleSubmit = () => {
    if (Object.keys(wrongAnswers).length === 0) {
      if (!confirm('틀린 문제가 없나요? 제출하시겠습니까?')) {
        return;
      }
    }

    // 틀린 문제에 대한 원인 분석이 모두 입력되었는지 확인
    const missingAnalysis = Object.keys(wrongAnswers).filter(
      q => !selfAnalysis[q]?.reason
    );

    if (missingAnalysis.length > 0) {
      alert(`${missingAnalysis.join(', ')}번 문제의 틀린 이유를 선택해주세요.`);
      return;
    }

    submitMutation.mutate({
      answers,
      wrongAnswers,
      selfAnalysis
    });
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Back Button */}
      <Link
        to="/student"
        className="inline-flex items-center text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        뒤로 가기
      </Link>

      {/* Exam Header */}
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900">{paper?.title}</h1>
        <p className="text-gray-500 mt-1">
          {paper?.subject} · {totalQuestions}문제 · {paper?.total_points}점
        </p>
        {paper?.description && (
          <p className="text-gray-600 mt-3">{paper.description}</p>
        )}
      </div>

      {/* Instructions */}
      <div className="card bg-blue-50 border-blue-200">
        <h3 className="font-semibold text-blue-900 mb-2">안내사항</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>1. 시험지를 보고 문제를 풀어주세요.</li>
          <li>2. 아래에서 틀린 문제 번호를 선택해주세요.</li>
          <li>3. 틀린 문제마다 왜 틀렸는지 이유를 선택해주세요.</li>
          <li>4. 제출하기 버튼을 눌러 완료하세요.</li>
        </ul>
      </div>

      {/* Questions */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-4">틀린 문제 체크</h2>
        <p className="text-sm text-gray-500 mb-4">
          틀린 문제 번호를 클릭해주세요
        </p>

        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 mb-6">
          {Array.from({ length: totalQuestions }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              onClick={() => handleWrongToggle(num)}
              className={`w-10 h-10 rounded-lg font-medium transition-colors ${
                wrongAnswers[num]
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {num}
            </button>
          ))}
        </div>

        {/* Wrong Answer Analysis */}
        {Object.keys(wrongAnswers).length > 0 && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <h3 className="font-medium text-gray-900">
              틀린 이유를 알려주세요 ({Object.keys(wrongAnswers).length}문제)
            </h3>

            {Object.keys(wrongAnswers).sort((a, b) => a - b).map((qNum) => (
              <div key={qNum} className="p-4 bg-red-50 rounded-xl">
                <p className="font-medium text-red-900 mb-3">{qNum}번 문제</p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                  {WRONG_REASONS.map((reason) => (
                    <button
                      key={reason.value}
                      onClick={() => handleReasonChange(qNum, reason.value)}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                        selfAnalysis[qNum]?.reason === reason.value
                          ? 'bg-red-500 text-white'
                          : 'bg-white text-gray-700 hover:bg-red-100'
                      }`}
                    >
                      {reason.label}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={selfAnalysis[qNum]?.note || ''}
                  onChange={(e) => handleNoteChange(qNum, e.target.value)}
                  placeholder="추가 메모 (선택사항)"
                  className="input text-sm bg-white"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit Button - Fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto">
          <button
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="btn-primary w-full py-4 text-lg"
          >
            {submitMutation.isPending ? (
              <>
                <Loader className="w-5 h-5 animate-spin mr-2" />
                제출 중...
              </>
            ) : (
              <>
                <Send className="w-5 h-5 mr-2" />
                시험 제출하기
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
