import { useState, useCallback } from 'react';
import axios from 'axios';

export const useFileUpload = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isPrivate, setIsPrivate] = useState(true);
  const [retentionTime, setRetentionTime] = useState('24hours');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResults, setUploadResults] = useState([]);
  const [error, setError] = useState('');

  const handleFileChange = useCallback((event) => {
    const files = Array.from(event.target.files);
    setSelectedFiles(files);
    setUploadResults([]);
    setError('');
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      setError('Please select files to upload');
      return null;
    }

    setUploading(true);
    setUploadProgress(0);
    setError('');
    setUploadResults([]);

    const totalFiles = selectedFiles.length;
    const results = [];
    let completedFiles = 0;

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const currentCompletedFiles = completedFiles; // Capture the value outside the callback
        
        // Client-side folder detection
        const isFolder = (
          (file.size === 0 && !file.type && file.name && !file.name.includes('.')) ||
          (file.type === '' && file.size === 0 && !file.name.includes('.')) ||
          (file.webkitRelativePath && file.webkitRelativePath.includes('/'))
        );
        
        if (isFolder) {
          const errorResult = {
            originalFileName: file.name,
            success: false,
            error: 'Folder uploads are not supported. Please zip the folder first or upload individual files.'
          };
          results.push(errorResult);
          completedFiles++;
          continue;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('isPrivate', isPrivate);
        formData.append('retentionTime', retentionTime);

        try {
          const response = await axios.post('/api/upload', formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            onUploadProgress: (progressEvent) => {
              const fileProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              const totalProgress = Math.round(((currentCompletedFiles + (fileProgress / 100)) / totalFiles) * 100);
              setUploadProgress(totalProgress);
            },
          });

          // Ensure all values are properly serialized
          const result = {
            ...response.data,
            filename: String(response.data.filename || ''),
            size: Number(response.data.size || 0),
            downloadLink: String(response.data.downloadLink || ''),
            expiryTime: response.data.expiryTime ? String(response.data.expiryTime) : null,
            originalFileName: file.name,
            success: true
          };
          
          results.push(result);
          completedFiles++;
          
        } catch (fileErr) {
          const errorResult = {
            originalFileName: file.name,
            success: false,
            error: fileErr.response?.data?.error || `Failed to upload ${file.name}`
          };
          results.push(errorResult);
          completedFiles++;
        }
      }
      
      setUploadResults(results);
      setSelectedFiles([]);
      setIsPrivate(true);
      
      // Reset file input
      const fileInput = document.getElementById('file-input');
      if (fileInput) {
        fileInput.value = '';
      }
      
      return results;
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Upload failed';
      setError(errorMessage);
      return null;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [selectedFiles, isPrivate, retentionTime]);

  const resetUploadState = useCallback(() => {
    setSelectedFiles([]);
    setUploadResults([]);
    setError('');
    setUploadProgress(0);
    setIsPrivate(true);
  }, []);

  return {
    selectedFiles,
    isPrivate,
    retentionTime,
    uploading,
    uploadProgress,
    uploadResults,
    error,
    setSelectedFiles,
    setIsPrivate,
    setRetentionTime,
    setError,
    handleFileChange,
    handleUpload,
    resetUploadState
  };
};