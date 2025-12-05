import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, Home, FileText, Users, ClipboardList } from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getNavItems = () => {
    switch (user?.role) {
      case 'parent':
        return [
          { to: '/parent', icon: Home, label: '대시보드' },
        ];
      case 'instructor':
        return [
          { to: '/instructor', icon: Home, label: '대시보드' },
          { to: '/instructor/exams', icon: ClipboardList, label: '시험 관리' },
        ];
      case 'student':
        return [
          { to: '/student', icon: Home, label: '대시보드' },
        ];
      default:
        return [];
    }
  };

  const getRoleLabel = () => {
    switch (user?.role) {
      case 'parent': return '학부모';
      case 'instructor': return '강사';
      case 'student': return '학생';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">NK</span>
              </div>
              <span className="font-bold text-xl text-gray-900">NK-LMS</span>
            </Link>

            {/* Navigation */}
            <nav className="hidden md:flex items-center space-x-1">
              {getNavItems().map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex items-center space-x-2 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>

            {/* User Info & Logout */}
            <div className="flex items-center space-x-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                <p className="text-xs text-gray-500">{getRoleLabel()}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="로그아웃"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 z-50">
        <div className="flex justify-around">
          {getNavItems().map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-col items-center py-2 px-3 text-gray-600"
            >
              <item.icon className="w-5 h-5" />
              <span className="text-xs mt-1">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
