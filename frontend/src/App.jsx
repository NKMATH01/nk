import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';

// Pages
import LoginPage from './pages/LoginPage';
import ParentDashboard from './pages/parent/ParentDashboard';
import ParentReport from './pages/parent/ParentReport';
import InstructorDashboard from './pages/instructor/InstructorDashboard';
import InstructorStudentDetail from './pages/instructor/InstructorStudentDetail';
import InstructorExamManage from './pages/instructor/InstructorExamManage';
import StudentDashboard from './pages/student/StudentDashboard';
import StudentExam from './pages/student/StudentExam';

// Components
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public Route */}
      <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" replace />} />

      {/* Protected Routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          {/* Parent Routes */}
          <Route path="/parent" element={<ParentDashboard />} />
          <Route path="/parent/report/:reportId" element={<ParentReport />} />

          {/* Instructor Routes */}
          <Route path="/instructor" element={<InstructorDashboard />} />
          <Route path="/instructor/student/:studentId" element={<InstructorStudentDetail />} />
          <Route path="/instructor/exams" element={<InstructorExamManage />} />

          {/* Student Routes */}
          <Route path="/student" element={<StudentDashboard />} />
          <Route path="/student/exam/:submissionId" element={<StudentExam />} />

          {/* Default Redirect */}
          <Route path="/" element={<RoleBasedRedirect />} />
        </Route>
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

// 역할 기반 리다이렉트
function RoleBasedRedirect() {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  switch (user.role) {
    case 'parent':
      return <Navigate to="/parent" replace />;
    case 'instructor':
      return <Navigate to="/instructor" replace />;
    case 'student':
      return <Navigate to="/student" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
}

export default App;
