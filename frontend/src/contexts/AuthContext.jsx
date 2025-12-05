import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 저장된 세션 확인
    const token = localStorage.getItem('sessionToken');
    const userData = localStorage.getItem('userData');

    if (token && userData) {
      try {
        setUser(JSON.parse(userData));
        api.defaults.headers.common['x-session-token'] = token;
      } catch (e) {
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('userData');
      }
    }
    setLoading(false);
  }, []);

  // 학부모 로그인
  const parentLogin = async (phone) => {
    const response = await api.post('/auth/parent-login', { phone });
    return response.data;
  };

  // 자녀 선택
  const selectChild = async (phone, studentId) => {
    const response = await api.post('/auth/parent-select-child', { phone, studentId });

    if (response.data.success) {
      const userData = {
        role: 'parent',
        name: `${response.data.student.name} 학부모`,
        studentId: studentId,
        student: response.data.student
      };
      setUser(userData);
      localStorage.setItem('sessionToken', response.data.sessionToken);
      localStorage.setItem('userData', JSON.stringify(userData));
      api.defaults.headers.common['x-session-token'] = response.data.sessionToken;
    }

    return response.data;
  };

  // 단일 자녀 학부모 즉시 로그인
  const completeParentLogin = (sessionToken, student) => {
    const userData = {
      role: 'parent',
      name: `${student.name} 학부모`,
      studentId: student.id,
      student
    };
    setUser(userData);
    localStorage.setItem('sessionToken', sessionToken);
    localStorage.setItem('userData', JSON.stringify(userData));
    api.defaults.headers.common['x-session-token'] = sessionToken;
  };

  // 강사 로그인
  const instructorLogin = async (email, password) => {
    const response = await api.post('/auth/instructor-login', { email, password });

    if (response.data.success) {
      const userData = {
        role: 'instructor',
        ...response.data.instructor
      };
      setUser(userData);
      localStorage.setItem('sessionToken', response.data.sessionToken);
      localStorage.setItem('userData', JSON.stringify(userData));
      api.defaults.headers.common['x-session-token'] = response.data.sessionToken;
    }

    return response.data;
  };

  // 학생 로그인
  const studentLogin = async (studentId, birthDate) => {
    const response = await api.post('/auth/student-login', { studentId, birthDate });

    if (response.data.success) {
      const userData = {
        role: 'student',
        ...response.data.student
      };
      setUser(userData);
      localStorage.setItem('sessionToken', response.data.sessionToken);
      localStorage.setItem('userData', JSON.stringify(userData));
      api.defaults.headers.common['x-session-token'] = response.data.sessionToken;
    }

    return response.data;
  };

  // 로그아웃
  const logout = () => {
    setUser(null);
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('userData');
    delete api.defaults.headers.common['x-session-token'];
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        parentLogin,
        selectChild,
        completeParentLogin,
        instructorLogin,
        studentLogin,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
