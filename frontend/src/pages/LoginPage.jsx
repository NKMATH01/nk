import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Phone, Mail, User, ArrowRight, Check } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const { parentLogin, selectChild, completeParentLogin, instructorLogin, studentLogin } = useAuth();

  const [loginType, setLoginType] = useState('parent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 학부모 로그인 상태
  const [phone, setPhone] = useState('');
  const [students, setStudents] = useState([]);
  const [showChildSelection, setShowChildSelection] = useState(false);

  // 강사 로그인 상태
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 학생 로그인 상태
  const [studentId, setStudentId] = useState('');
  const [birthDate, setBirthDate] = useState('');

  const handleParentLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await parentLogin(phone);

      if (result.requiresSelection) {
        // 자녀가 2명 이상
        setStudents(result.students);
        setShowChildSelection(true);
      } else if (result.sessionToken) {
        // 자녀가 1명 - 즉시 로그인
        completeParentLogin(result.sessionToken, result.student);
        navigate('/parent');
      }
    } catch (err) {
      setError(err.response?.data?.error || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleChildSelect = async (studentId) => {
    setLoading(true);
    setError('');

    try {
      const result = await selectChild(phone, studentId);
      if (result.success) {
        navigate('/parent');
      }
    } catch (err) {
      setError(err.response?.data?.error || '처리에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleInstructorLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await instructorLogin(email, password);
      if (result.success) {
        navigate('/instructor');
      }
    } catch (err) {
      setError(err.response?.data?.error || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleStudentLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await studentLogin(studentId, birthDate);
      if (result.success) {
        navigate('/student');
      }
    } catch (err) {
      setError(err.response?.data?.error || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 자녀 선택 화면
  if (showChildSelection) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">자녀 선택</h2>
            <p className="text-gray-500 mt-2">조회할 자녀를 선택해주세요</p>
          </div>

          <div className="space-y-3">
            {students.map((student) => (
              <button
                key={student.id}
                onClick={() => handleChildSelect(student.id)}
                disabled={loading}
                className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-primary-50 rounded-xl transition-colors group"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-primary-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-gray-900">{student.name}</p>
                    <p className="text-sm text-gray-500">
                      {student.grade} · {student.className}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-primary-600 transition-colors" />
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setShowChildSelection(false);
              setStudents([]);
            }}
            className="w-full mt-6 text-gray-500 hover:text-gray-700"
          >
            다시 입력하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">NK</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">NK-LMS</h1>
          <p className="text-gray-500 mt-1">학습 관리 시스템</p>
        </div>

        {/* Login Type Tabs */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
          {[
            { type: 'parent', label: '학부모' },
            { type: 'instructor', label: '강사' },
            { type: 'student', label: '학생' }
          ].map((tab) => (
            <button
              key={tab.type}
              onClick={() => {
                setLoginType(tab.type);
                setError('');
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                loginType === tab.type
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* Parent Login Form */}
        {loginType === 'parent' && (
          <form onSubmit={handleParentLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                전화번호
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010-1234-5678"
                  className="input pl-10"
                  required
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                학원에 등록된 전화번호를 입력해주세요
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? '확인 중...' : '로그인'}
            </button>
          </form>
        )}

        {/* Instructor Login Form */}
        {loginType === 'instructor' && (
          <form onSubmit={handleInstructorLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                이메일
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="instructor@nkacademy.com"
                  className="input pl-10"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        )}

        {/* Student Login Form */}
        {loginType === 'student' && (
          <form onSubmit={handleStudentLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                학생 ID
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="학원에서 받은 ID"
                  className="input pl-10"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                생년월일
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="input"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
