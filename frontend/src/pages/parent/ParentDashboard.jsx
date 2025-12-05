import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { reportApi, studentApi } from '../../services/api';
import { FileText, TrendingUp, Calendar, ChevronRight, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function ParentDashboard() {
  const { user } = useAuth();
  const studentId = user?.studentId;

  // 학생 정보 조회
  const { data: studentData } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => studentApi.getStudent(studentId),
    enabled: !!studentId
  });

  // 보고서 목록 조회
  const { data: reportsData, isLoading: reportsLoading } = useQuery({
    queryKey: ['reports', studentId],
    queryFn: () => reportApi.getReports(studentId),
    enabled: !!studentId
  });

  const student = studentData?.data?.student;
  const reports = reportsData?.data?.reports || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
            <span className="text-2xl font-bold text-primary-600">
              {student?.name?.charAt(0) || 'N'}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{student?.name}</h1>
            <p className="text-gray-500">
              {student?.grade} · {student?.classes?.name}
            </p>
            <p className="text-sm text-gray-400">{student?.classes?.subject}</p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={FileText}
          label="총 보고서"
          value={reports.length}
          color="primary"
        />
        <StatCard
          icon={Calendar}
          label="주간 보고서"
          value={reports.filter(r => r.report_type === 'weekly').length}
          color="blue"
        />
        <StatCard
          icon={TrendingUp}
          label="월간 보고서"
          value={reports.filter(r => r.report_type === 'monthly').length}
          color="green"
        />
        <StatCard
          icon={BookOpen}
          label="미열람"
          value={reports.filter(r => !r.viewed_at).length}
          color="orange"
        />
      </div>

      {/* Reports List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">학습 보고서</h2>
        </div>

        {reportsLoading ? (
          <div className="py-12 text-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
            로딩 중...
          </div>
        ) : reports.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>아직 생성된 보고서가 없습니다.</p>
            <p className="text-sm mt-1">강사가 보고서를 생성하면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {reports.map((report) => (
              <ReportItem key={report.id} report={report} />
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

function ReportItem({ report }) {
  const isNew = !report.viewed_at;
  const reportTypeLabel = report.report_type === 'weekly' ? '주간' : '월간';

  return (
    <Link
      to={`/parent/report/${report.id}`}
      className="flex items-center justify-between py-4 hover:bg-gray-50 -mx-6 px-6 transition-colors"
    >
      <div className="flex items-center space-x-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          report.report_type === 'weekly' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
        }`}>
          <FileText className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h3 className="font-medium text-gray-900">
              {report.report_content?.title || `${reportTypeLabel} 보고서`}
            </h3>
            {isNew && (
              <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                NEW
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">
            {format(new Date(report.report_period_start), 'M월 d일', { locale: ko })} ~{' '}
            {format(new Date(report.report_period_end), 'M월 d일', { locale: ko })}
          </p>
        </div>
      </div>
      <ChevronRight className="w-5 h-5 text-gray-400" />
    </Link>
  );
}
