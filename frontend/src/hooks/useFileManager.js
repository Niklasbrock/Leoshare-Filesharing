import { useState, useCallback } from 'react';
import axios from 'axios';

export const useFileManager = () => {
  const [userFiles, setUserFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileTypeFilter, setFileTypeFilter] = useState('all');
  const [expandedFile, setExpandedFile] = useState(null);

  const fetchUserFiles = useCallback(async () => {
    try {
      setFilesLoading(true);
      const response = await axios.get('/api/my-files');
      setUserFiles(response.data.files);
      return response.data.files;
    } catch (error) {
      console.error('Failed to fetch user files:', error);
      return [];
    } finally {
      setFilesLoading(false);
    }
  }, []);

  const handleDeleteFile = useCallback(async (fileId, filename) => {
    if (!window.confirm(`Are you sure you want to delete "${filename}"? This action cannot be undone.`)) {
      return false;
    }

    try {
      await axios.delete(`/api/files/${fileId}`);
      // Update local state to remove the deleted file
      setUserFiles(prevFiles => prevFiles.filter(file => file.id !== fileId));
      console.log(`File deleted successfully: ${filename}`);
      return true;
    } catch (error) {
      console.error('Delete error:', error);
      const errorMessage = error.response?.data?.error || 'Failed to delete file';
      throw new Error(errorMessage);
    }
  }, []);

  const getFileType = useCallback((filename) => {
    if (!filename || typeof filename !== 'string') return 'other';
    const extension = filename.toLowerCase().split('.').pop();
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(extension)) return 'audio';
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(extension)) return 'image';
    if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'ogv'].includes(extension)) return 'video';
    if (['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'zip'].includes(extension)) return 'document';
    return 'other';
  }, []);

  const isMediaFile = useCallback((filename) => {
    const fileType = getFileType(filename);
    return ['audio', 'image', 'video'].includes(fileType);
  }, [getFileType]);

  const filterFiles = useCallback((files, filterType) => {
    if (filterType === 'all') return files;
    return files.filter(file => getFileType(file.originalName) === filterType);
  }, [getFileType]);

  const formatFileSize = useCallback((bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  return {
    userFiles,
    filesLoading,
    fileTypeFilter,
    expandedFile,
    setFileTypeFilter,
    setExpandedFile,
    fetchUserFiles,
    handleDeleteFile,
    getFileType,
    isMediaFile,
    filterFiles,
    formatFileSize
  };
};