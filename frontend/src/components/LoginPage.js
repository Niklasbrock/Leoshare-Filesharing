import React, { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import LoginCard from './LoginCard';

const LoginPage = () => {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);
  
  const {
    user,
    authLoading,
    requestStatus,
    loginButtonLoading,
    setLoginButtonLoading,
    setRequestStatus,
    setLoginMessage,
    checkAuthStatus,
    handleLogout,
    handleTryAgain
  } = useAuth();

  // Auth result handler
  const handleAuthResult = useCallback((status) => {
    switch (status) {
      case 'success':
        setLoginMessage('Login successful! Redirecting...');
        // Immediately refresh auth status and redirect
        (async () => {
          try {
            await checkAuthStatus();
            setTimeout(() => {
              navigate('/', { replace: true });
            }, 500); // Shorter delay for better UX
          } catch (error) {
            console.error('Auth status check failed:', error);
            // Still navigate even if check fails
            setTimeout(() => {
              navigate('/', { replace: true });
            }, 1000);
          }
        })();
        break;
      case 'pending':
        setLoginMessage('Your access request has been sent to the administrator. You will receive an email notification once approved.');
        setRequestStatus('pending');
        break;
      case 'denied':
        setLoginMessage('Login denied. Please contact the administrator for access.');
        setRequestStatus('denied');
        setTimeout(() => {
          setLoginMessage('');
          setRequestStatus(null);
        }, 10000);
        break;
      case 'error':
        setLoginMessage('Login error occurred. Please try again.');
        setRequestStatus('denied');
        setTimeout(() => {
          setLoginMessage('');
          setRequestStatus(null);
        }, 5000);
        break;
      default:
        break;
    }
  }, [setLoginMessage, setRequestStatus, navigate, checkAuthStatus]);

  const { handleGoogleLogin } = useGoogleAuth({
    onAuthResult: handleAuthResult,
    setLoginButtonLoading,
    setRequestStatus,
    isMobile
  });

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const screenWidth = window.innerWidth;
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const mobile = /android|iPad|iPhone|iPod|blackberry|iemobile|opera mini/i.test(userAgent) || 
                    (screenWidth <= 768 && isTouchDevice);
      
      setIsMobile(mobile);
    };
    
    checkMobile();
    
    // Add resize listener to detect orientation changes
    const handleResize = () => {
      setTimeout(checkMobile, 100); // Small delay to ensure accurate measurements
    };
    
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Enhanced logout handler
  const handleLogoutWithCleanup = useCallback(async () => {
    const success = await handleLogout();
    if (success) {
      // Stay on login page after logout
      window.location.reload();
    }
  }, [handleLogout]);

  // Redirect to main page if user is logged in and approved
  useEffect(() => {
    if (!authLoading && user && requestStatus === null) {
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 100); // Small delay for smooth transition
    }
  }, [user, requestStatus, authLoading, navigate]);

  // Show user info if logged in but not approved (pending)
  const showUserInfo = user && requestStatus === 'pending';
  return (
    <div className={`app ${isMobile ? 'mobile' : 'desktop'}`}>
      {showUserInfo && (
        <div className="user-info">
          <span>Welcome, {user?.name || user?.email || 'User'}</span>
          <button onClick={handleLogoutWithCleanup} className="logout-button">
            Logout
          </button>
        </div>
      )}
      
      <div className="container">
        <header className="header">
          <div className="header-content">
            <div className="logo-section">
              <h1 className="app-title">
                <span className="logo-text">LeoLord</span>
                <span className="logo-subtitle">File Sharing - Login</span>
              </h1>
            </div>
          </div>
        </header>

        {authLoading ? (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Checking authentication...</p>
          </div>
        ) : (
          <LoginCard
            user={user}
            requestStatus={requestStatus}
            loginButtonLoading={loginButtonLoading}
            handleGoogleLogin={handleGoogleLogin}
            handleLogout={handleLogoutWithCleanup}
            handleTryAgain={handleTryAgain}
          />
        )}
      </div>
    </div>
  );
};

export default LoginPage;