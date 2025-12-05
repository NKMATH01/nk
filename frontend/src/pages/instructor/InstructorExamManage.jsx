import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { examApi } from '../../services/api';
import { Plus, Send, ClipboardList, X, Loader } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function InstructorExamManage() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    subject: '',
    classId: '',
    totalQuestions: 10,
    totalPoints: 100
  });

  // 시험지 목록 조회
  const { data, isLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examApi.getPapers()
  });

  // 시험지 생성
  const createMutation = useMutation({
    mutationFn: examApi.createPaper,
    onSuccess: () => {
      queryClient.invalidateQueries(['exams']);
      setShowCreateForm(false);
      setFormData({
        title: '',
        description: '',
        subject: '',
        classId: '',
        totalQuestions: 10,
        totalPoints: 100
      });
    },
    onError: (error) => {
      alert(error.response?.data?.error || '시험지 생성에 실패했습니다.');
    }
  });

  // 시험지 배포
  const distributeMutation = useMutation({
    mutationFn: examApi.distributePaper,
    onSuccess: (data) => {
      queryClient.invalidateQueries(['exams']);
      alert(`${data.data.distributedTo}명의 학생에게 배포되었습니다.`);
    },
    onError: (error) => {
      alert(error.response?.data?.error || '배포에 실패했습니다.');
    }
  });

  const papers = data?.data?.papers || [];

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">시험 관리</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          className="btn-primary"
        >
          <Plus className="w-4 h-4 mr-2" />
          새 시험지
        </button>
      </div>

      {/* Create Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">새 시험지 만들기</h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  시험 제목 *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="예: 12월 1주차 수학 테스트"
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  과목 *
                </label>
                <input
                  type="text"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="예: 수학"
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  반 ID *
                </label>
                <input
                  type="text"
                  value={formData.classId}
                  onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                  placeholder="배포할 반의 ID"
                  className="input"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    문제 수
                  </label>
                  <input
                    type="number"
                    value={formData.totalQuestions}
                    onChange={(e) => setFormData({ ...formData, totalQuestions: parseInt(e.target.value) })}
                    className="input"
                    min={1}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    총점
                  </label>
                  <input
                    type="number"
                    value={formData.totalPoints}
                    onChange={(e) => setFormData({ ...formData, totalPoints: parseInt(e.target.value) })}
                    className="input"
                    min={1}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  설명 (선택)
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="시험에 대한 설명"
                  className="input"
                  rows={3}
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="btn-secondary flex-1"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="btn-primary flex-1"
                >
                  {createMutation.isPending ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    '만들기'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Exam List */}
      {isLoading ? (
        <div className="card py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          로딩 중...
        </div>
      ) : papers.length === 0 ? (
        <div className="card py-12 text-center">
          <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">등록된 시험지가 없습니다.</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-primary mt-4"
          >
            첫 시험지 만들기
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {papers.map((paper) => (
            <ExamCard
              key={paper.id}
              paper={paper}
              onDistribute={() => distributeMutation.mutate(paper.id)}
              isDistributing={distributeMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExamCard({ paper, onDistribute, isDistributing }) {
  const statusConfig = {
    draft: { color: 'bg-gray-100 text-gray-600', label: '초안' },
    distributed: { color: 'bg-green-100 text-green-600', label: '배포됨' },
    closed: { color: 'bg-red-100 text-red-600', label: '마감' }
  };

  const status = statusConfig[paper.status];

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-4">
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-semibold text-gray-900">{paper.title}</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                {status.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {paper.subject} · {paper.total_questions}문제 · {paper.total_points}점
            </p>
            {paper.description && (
              <p className="text-sm text-gray-400 mt-1">{paper.description}</p>
            )}
          </div>
        </div>

        {paper.status === 'draft' && (
          <button
            onClick={onDistribute}
            disabled={isDistributing}
            className="btn-primary text-sm"
          >
            {isDistributing ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4 mr-1" />
                배포하기
              </>
            )}
          </button>
        )}
      </div>

      {paper.status === 'distributed' && paper.stats && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">제출 현황</span>
            <span className="font-medium text-gray-900">
              {paper.stats.submitted} / {paper.stats.totalStudents}명
            </span>
          </div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{
                width: `${(paper.stats.submitted / paper.stats.totalStudents) * 100}%`
              }}
            />
          </div>
          {paper.stats.averageScore !== null && (
            <p className="text-sm text-gray-500 mt-2">
              평균 점수: <span className="font-medium text-gray-900">{paper.stats.averageScore}점</span>
            </p>
          )}
        </div>
      )}

      {paper.distributed_at && (
        <p className="text-xs text-gray-400 mt-3">
          배포일: {format(new Date(paper.distributed_at), 'yyyy년 M월 d일 HH:mm', { locale: ko })}
        </p>
      )}
    </div>
  );
}
