import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [requestStatus, setRequestStatus] = useState(null);
  const [loginMessage, setLoginMessage] = useState('');
  const [loginButtonLoading, setLoginButtonLoading] = useState(false);

  const checkAuthStatus = useCallback(async () => {
    try {
      const response = await axios.get('/api/auth/status');
      if (response.data.authenticated) {
        setUser(response.data.user);
        
        if (response.data.approved) {
          setRequestStatus(null);
          return { authenticated: true, approved: true, user: response.data.user };
        } else {
          setRequestStatus('pending');
          setLoginMessage('Your access request is being reviewed by the administrator. You will receive an email notification once approved.');
          return { authenticated: true, approved: false, user: response.data.user };
        }
      } else {
        setUser(null);
        setRequestStatus(null);
        setLoginMessage('');
        return { authenticated: false, approved: false };
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      return { authenticated: false, approved: false };
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await axios.post('/api/auth/logout');
      setUser(null);
      setRequestStatus(null);
      setLoginMessage('');
      return true;
    } catch (error) {
      console.error('Logout failed:', error);
      return false;
    }
  }, []);

  const handleTryAgain = useCallback(() => {
    setRequestStatus(null);
    setLoginMessage('');
    setLoginButtonLoading(false);
  }, []);

  // Handle OAuth results from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const loginStatus = urlParams.get('login');
    
    if (loginStatus) {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Restore auth state if available
      const savedAuthState = sessionStorage.getItem('authState');
      if (savedAuthState) {
        sessionStorage.removeItem('authState');
        
        switch (loginStatus) {
          case 'success':
            setLoginMessage('Login successful! Checking approval status...');
            // Sequential auth flow to prevent race conditions
            (async () => {
              try {
                await checkAuthStatus();
                setTimeout(() => {
                  setLoginMessage('');
                  // Refresh page after successful login to ensure clean state
                  window.location.reload();
                }, 2000);
              } catch (error) {
                console.error('Auth status check failed:', error);
                setLoginMessage('Authentication verification failed. Please try again.');
                setLoginButtonLoading(false);
              }
            })();
            break;
          case 'pending':
            setLoginMessage('Your access request has been sent to the administrator. You will receive an email notification once approved.');
            setRequestStatus('pending');
            // Sequential auth flow to prevent race conditions
            (async () => {
              try {
                await checkAuthStatus();
                setLoginButtonLoading(false);
              } catch (error) {
                console.error('Auth status check failed:', error);
                setLoginButtonLoading(false);
              }
            })();
            break;
          case 'denied':
            setLoginMessage('Login denied. Please contact the administrator for access.');
            setRequestStatus('denied');
            setLoginButtonLoading(false);
            setTimeout(() => {
              setLoginMessage('');
              setRequestStatus(null);
            }, 10000);
            break;
          case 'error':
            setLoginMessage('Login error occurred. Please try again.');
            setRequestStatus('denied');
            setLoginButtonLoading(false);
            setTimeout(() => {
              setLoginMessage('');
              setRequestStatus(null);
            }, 5000);
            break;
          default:
            // Handle unknown status
            break;
        }
      }
    }
  }, [checkAuthStatus]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  return {
    user,
    authLoading,
    requestStatus,
    loginMessage,
    loginButtonLoading,
    setLoginButtonLoading,
    setRequestStatus,
    setLoginMessage,
    checkAuthStatus,
    handleLogout,
    handleTryAgain
  };
};