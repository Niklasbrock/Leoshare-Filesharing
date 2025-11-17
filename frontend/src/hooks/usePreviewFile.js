import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export const usePreviewFile = (authLoading, user, requestStatus) => {
  const [previewFile, setPreviewFile] = useState(null);

  const fetchPreviewFile = useCallback(async (fileId) => {
    try {
      console.log(`🔍 Fetching preview for file ${fileId}, user authenticated: ${!!user}, approved: ${user && requestStatus !== 'pending'}`);
      
      const response = await axios.get(`/api/info/${fileId}`);
      setPreviewFile({
        id: fileId,
        ...response.data
      });
      console.log(`✅ Successfully fetched preview file: ${response.data.originalName}, isPrivate: ${response.data.isPrivate}`);
    } catch (error) {
      console.error('Failed to fetch preview file:', error);
      
      if (error.response?.status === 401) {
        // File requires authentication, but user is not logged in or not approved
        console.log(`🔒 File ${fileId} requires authentication`);
        setPreviewFile({
          id: fileId,
          isPrivate: true,
          requiresAuth: true
        });
      } else if (error.response?.status === 403) {
        // User is authenticated but not approved for private files
        console.log(`⏳ File ${fileId} requires approval`);
        setPreviewFile({
          id: fileId,
          isPrivate: true,
          requiresAuth: true,
          needsApproval: true
        });
      } else if (error.response?.status === 404) {
        throw new Error('File not found or has expired');
      } else {
        throw new Error('Failed to load file information');
      }
    }
  }, [user, requestStatus]);

  useEffect(() => {
    const handleRouting = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/preview\/(.+)$/);
      if (match) {
        const fileId = match[1];
        // Only fetch preview file after auth loading is complete
        if (!authLoading) {
          fetchPreviewFile(fileId).catch(error => {
            console.error('Preview file fetch error:', error);
          });
        }
      }
    };
    
    handleRouting();
  }, [authLoading, fetchPreviewFile]);

  return {
    previewFile,
    fetchPreviewFile
  };
};