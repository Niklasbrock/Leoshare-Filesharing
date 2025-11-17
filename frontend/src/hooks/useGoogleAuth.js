import { useState, useCallback, useEffect } from 'react';

export const useGoogleAuth = ({ 
  onAuthResult, 
  setLoginButtonLoading, 
  setRequestStatus,
  isMobile: externalIsMobile
}) => {
  const [internalIsMobile, setInternalIsMobile] = useState(false);
  
  // Use external isMobile if provided, otherwise use internal detection
  const isMobile = externalIsMobile !== undefined ? externalIsMobile : internalIsMobile;

  useEffect(() => {
    // Only do internal detection if external isMobile is not provided
    if (externalIsMobile === undefined) {
      const checkMobile = () => {
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        setInternalIsMobile(/android|iPad|iPhone|iPod|blackberry|iemobile|opera mini/i.test(userAgent));
      };
      checkMobile();
    }
  }, [externalIsMobile]);

  const handleGoogleLogin = useCallback(() => {
    setLoginButtonLoading(true);
    setRequestStatus('loading');
    
    // Check if mobile device - use redirect flow on mobile, popup on desktop
    if (isMobile) {
      // Store current state in sessionStorage for mobile
      sessionStorage.setItem('authState', JSON.stringify({
        requestStatus: 'loading',
        loginButtonLoading: true
      }));
      // Use redirect flow for mobile devices
      window.location.href = '/auth/google?mobile=true';
      return;
    }
    
    // Desktop: Use popup flow
    const popup = window.open(
      '/auth/google',
      'googleOAuth',
      'width=500,height=600,scrollbars=yes,resizable=yes'
    );
    
    // Check if popup was blocked
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      // Fallback to redirect if popup is blocked
      console.log('Popup blocked, falling back to redirect');
      sessionStorage.setItem('authState', JSON.stringify({
        requestStatus: 'loading',
        loginButtonLoading: true
      }));
      window.location.href = '/auth/google?fallback=true';
      return;
    }
    
    // Handle popup being closed manually and check localStorage for result
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        // Check localStorage for OAuth result as backup
        try {
          const storedResult = localStorage.getItem('oauth_result');
          if (storedResult) {
            const result = JSON.parse(storedResult);
            
            // Check if this is a recent result (within last 10 seconds)
            if (Date.now() - result.timestamp < 10000) {
              localStorage.removeItem('oauth_result'); // Clean up
              
              if (onAuthResult) {
                onAuthResult(result.status);
              }
              
              clearInterval(checkClosed);
              window.removeEventListener('message', handleMessage);
              return;
            } else {
              // Clean up old result
              localStorage.removeItem('oauth_result');
            }
          }
        } catch (e) {
          // Silently handle localStorage errors
        }
        
        // No result found, treat as cancelled
        clearInterval(checkClosed);
        window.removeEventListener('message', handleMessage);
        setLoginButtonLoading(false);
        setRequestStatus(null);
      }
    }, 1000);
    
    // Listen for messages from popup
    const handleMessage = (event) => {
      // Allow messages from same origin and trusted origins
      const trustedOrigins = [
        window.location.origin,
        'https://leoshare.dk',
        'https://www.leoshare.dk'
      ];
      
      if (!trustedOrigins.includes(event.origin)) {
        return;
      }
      
      // Check if this is an OAuth result message
      if (event.data && event.data.type === 'OAUTH_RESULT') {
        // Clean up localStorage in case it was also set
        try {
          localStorage.removeItem('oauth_result');
        } catch (e) {
          console.log('Error cleaning localStorage:', e);
        }
        
        // Clean up the popup and listeners
        try {
          if (popup && !popup.closed) {
            popup.close();
          }
        } catch (e) {
          console.log('Error closing popup:', e);
        }
        
        window.removeEventListener('message', handleMessage);
        clearInterval(checkClosed);
        
        // Call the result handler
        const { status } = event.data;
        if (onAuthResult) {
          onAuthResult(status);
        }
      }
    };
    
    window.addEventListener('message', handleMessage);
  }, [isMobile, setLoginButtonLoading, setRequestStatus, onAuthResult]);

  return {
    isMobile,
    handleGoogleLogin
  };
};