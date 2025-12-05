import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { studentApi, examApi } from '../../services/api';
import { Users, ClipboardList, FileText, ChevronRight, TrendingUp, AlertCircle } from 'lucide-react';

export default function InstructorDashboard() {
  const { user } = useAuth();

  // 학생 목록 조회
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students'],
    queryFn: () => studentApi.getStudents()
  });

  // 시험지 목록 조회
  const { data: examsData } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examApi.getPapers()
  });

  const students = studentsData?.data?.students || [];
  const papers = examsData?.data?.papers || [];

  const distributedPapers = papers.filter(p => p.status === 'distributed');
  const pendingSubmissions = distributedPapers.reduce(
    (sum, p) => sum + (p.stats?.totalStudents - p.stats?.submitted || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900">
          안녕하세요, {user?.name} 선생님
        </h1>
        <p className="text-gray-500 mt-1">오늘도 좋은 하루 되세요!</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          label="담당 학생"
          value={students.length}
          color="primary"
        />
        <StatCard
          icon={ClipboardList}
          label="배포된 시험"
          value={distributedPapers.length}
          color="blue"
        />
        <StatCard
          icon={AlertCircle}
          label="미제출"
          value={pendingSubmissions}
          color="orange"
        />
        <StatCard
          icon={FileText}
          label="총 시험지"
          value={papers.length}
          color="green"
        />
      </div>

      {/* Students List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">담당 학생</h2>
        </div>

        {studentsLoading ? (
          <div className="py-8 text-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
            로딩 중...
          </div>
        ) : students.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>담당 학생이 없습니다.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {students.slice(0, 10).map((student) => (
              <StudentItem key={student.id} student={student} />
            ))}
          </div>
        )}

        {students.length > 10 && (
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-500">
              외 {students.length - 10}명의 학생
            </p>
          </div>
        )}
      </div>

      {/* Recent Exams */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">최근 시험</h2>
          <Link
            to="/instructor/exams"
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            전체보기
          </Link>
        </div>

        {papers.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>등록된 시험지가 없습니다.</p>
            <Link to="/instructor/exams" className="btn-primary mt-4 inline-block">
              시험지 만들기
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {papers.slice(0, 5).map((paper) => (
              <ExamItem key={paper.id} paper={paper} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    primary: 'bg-primary-50 text-primary-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600'
  };

  return (
    <div className="card !p-4">
      <div className={`w-10 h-10 rounded-lg ${colors[color]} flex items-center justify-center mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

function StudentItem({ student }) {
  return (
    <Link
      to={`/instructor/student/${student.id}`}
      className="flex items-center justify-between py-4 hover:bg-gray-50 -mx-6 px-6 transition-colors"
    >
      <div className="flex items-center space-x-4">
        <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
          <span className="text-primary-600 font-medium">
            {student.name?.charAt(0)}
          </span>
        </div>
        <div>
          <h3 className="font-medium text-gray-900">{student.name}</h3>
          <p className="text-sm text-gray-500">
            {student.grade} · {student.classes?.name}
          </p>
        </div>
      </div>
      <ChevronRight className="w-5 h-5 text-gray-400" />
    </Link>
  );
}

function ExamItem({ paper }) {
  const statusColors = {
    draft: 'bg-gray-100 text-gray-600',
    distributed: 'bg-green-100 text-green-600',
    closed: 'bg-red-100 text-red-600'
  };

  const statusLabels = {
    draft: '초안',
    distributed: '배포됨',
    closed: '마감'
  };

  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex items-center space-x-4">
        <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-medium text-gray-900">{paper.title}</h3>
          <p className="text-sm text-gray-500">
            {paper.subject} · {paper.stats?.submitted || 0}/{paper.stats?.totalStudents || 0} 제출
          </p>
        </div>
      </div>
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[paper.status]}`}>
        {statusLabels[paper.status]}
      </span>
    </div>
  );
}
