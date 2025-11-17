import { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';

export const useApi = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cancelTokenRef = useRef(null);

  // Cleanup function to cancel ongoing requests
  const cleanup = useCallback(() => {
    if (cancelTokenRef.current) {
      cancelTokenRef.current.cancel('Request cancelled due to component unmount or new request');
      cancelTokenRef.current = null;
    }
  }, []);

  // Generic API call function with automatic cleanup
  const apiCall = useCallback(async (apiFunction, ...args) => {
    try {
      // Cancel any existing request
      cleanup();
      
      // Create new cancel token
      cancelTokenRef.current = axios.CancelToken.source();
      
      setLoading(true);
      setError(null);
      
      // Add cancel token to axios config if it's an axios request
      const config = { cancelToken: cancelTokenRef.current.token };
      
      let result;
      if (typeof apiFunction === 'function') {
        // If apiFunction is a custom function, call it with args
        result = await apiFunction(...args, config);
      } else {
        // If apiFunction is an axios request config, use it directly
        result = await axios({ ...apiFunction, ...config });
      }
      
      return result;
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log('Request cancelled:', error.message);
        return null;
      } else {
        const errorMessage = error.response?.data?.error || error.message || 'An error occurred';
        setError(errorMessage);
        console.error('API call failed:', error);
        throw error;
      }
    } finally {
      setLoading(false);
      cancelTokenRef.current = null;
    }
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    loading,
    error,
    apiCall,
    clearError: () => setError(null),
    cleanup
  };
};