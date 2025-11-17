import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [sendEmailReceipt, setSendEmailReceipt] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [retentionTime, setRetentionTime] = useState('24hours');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginMessage, setLoginMessage] = useState('');
  const [userFiles, setUserFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [expandedFile, setExpandedFile] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [requestStatus, setRequestStatus] = useState(null); // null, 'loading', 'pending', 'approved', 'denied'
  const [loginButtonLoading, setLoginButtonLoading] = useState(false);
  const [fileTypeFilter, setFileTypeFilter] = useState('all'); // 'all', 'audio', 'image', 'video', 'other'
  const [collections, setCollections] = useState([]);
  const [subscribedFiles, setSubscribedFiles] = useState([]);
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [editingCollection, setEditingCollection] = useState(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [draggedFile, setDraggedFile] = useState(null);
  const [dragOverCollection, setDragOverCollection] = useState(null);
  const [showAddToCollection, setShowAddToCollection] = useState(null); // fileId when showing dropdown
  const [expandedCollections, setExpandedCollections] = useState(new Set()); // Set of expanded collection IDs
  const [expandedCollectionFiles, setExpandedCollectionFiles] = useState(new Set()); // Set of expanded file IDs in collections
  const [mediaLoadingStates, setMediaLoadingStates] = useState(new Map()); // Map of file IDs to loading states
  const [mediaErrorStates, setMediaErrorStates] = useState(new Map()); // Map of file IDs to error states

  // Configure axios to include credentials
  axios.defaults.withCredentials = true;

  useEffect(() => {
    checkAuthStatus();
    
    // Detect mobile device
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      setIsMobile(/android|iPad|iPhone|iPod|blackberry|iemobile|opera mini/i.test(userAgent));
    };
    checkMobile();
    
    // Handle mobile/fallback OAuth redirect results
    const urlParams = new URLSearchParams(window.location.search);
    const loginStatus = urlParams.get('login');
    
    if (loginStatus) {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Restore auth state if available
      const savedAuthState = sessionStorage.getItem('authState');
      if (savedAuthState) {
        sessionStorage.removeItem('authState');
        // State was saved, proceed with handling the result
        
        if (loginStatus === 'success') {
          setLoginMessage('Login successful! You can now upload files.');
          setRequestStatus('approved');
          checkAuthStatus();
          setTimeout(() => {
            setLoginMessage('');
            setRequestStatus(null);
          }, 5000);
        } else if (loginStatus === 'pending') {
          setLoginMessage('Your access request has been sent to the administrator. You will receive an email notification once approved.');
          setRequestStatus('pending');
          checkAuthStatus(); // Refresh auth status to show pending page
          setLoginButtonLoading(false);
        } else if (loginStatus === 'denied') {
          setLoginMessage('Login denied. Please contact the administrator for access.');
          setRequestStatus('denied');
          setLoginButtonLoading(false);
          setTimeout(() => {
            setLoginMessage('');
            setRequestStatus(null);
          }, 10000);
        } else if (loginStatus === 'error') {
          setLoginMessage('Login error occurred. Please try again.');
          setRequestStatus('denied');
          setLoginButtonLoading(false);
          setTimeout(() => {
            setLoginMessage('');
            setRequestStatus(null);
          }, 5000);
        }
      }
    }
  }, []); // Empty dependency array - only run once on mount

  const checkAuthStatus = async () => {
    try {
      const response = await axios.get('/api/auth/status');
      if (response.data.authenticated) {
        setUser(response.data.user);
        
        if (response.data.approved) {
          // User is fully approved - they can access everything
          setRequestStatus(null);
          fetchUserFiles();
          fetchCollections();
          
          // If we have a preview file that requires auth, retry fetching it
          const path = window.location.pathname;
          const match = path.match(/^\/preview\/(.+)$/);
          if (match && previewFile && previewFile.requiresAuth) {
            const fileId = match[1];
            fetchPreviewFile(fileId);
          }
        } else {
          // User is logged in but pending approval
          setRequestStatus('pending');
          setLoginMessage('Your access request is being reviewed by the administrator. You will receive an email notification once approved.');
        }
      } else {
        setUser(null);
        setRequestStatus(null);
        setLoginMessage('');
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchUserFiles = async () => {
    try {
      setFilesLoading(true);
      const response = await axios.get('/api/my-files');
      setUserFiles(response.data.files);
    } catch (error) {
      console.error('Failed to fetch user files:', error);
    } finally {
      setFilesLoading(false);
    }
  };


  const handleGoogleLogin = () => {
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
    
    // Listen for messages from popup
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      
      if (event.data.type === 'OAUTH_RESULT') {
        popup.close();
        window.removeEventListener('message', handleMessage);
        
        const { status } = event.data;
        
        if (status === 'success') {
          setLoginMessage('Login successful! You can now upload files.');
          setRequestStatus('approved');
          checkAuthStatus();
          setTimeout(() => {
            setLoginMessage('');
            setRequestStatus(null);
          }, 5000);
        } else if (status === 'pending') {
          setLoginMessage('Your access request has been sent to the administrator. You will receive an email notification once approved.');
          setRequestStatus('pending');
          setLoginButtonLoading(false);
          checkAuthStatus(); // Refresh auth status to show pending page
        } else if (status === 'denied') {
          setLoginMessage('Login denied. Please contact the administrator for access.');
          setRequestStatus('denied');
          setLoginButtonLoading(false);
          setTimeout(() => {
            setLoginMessage('');
            setRequestStatus(null);
          }, 10000);
        } else if (status === 'error') {
          setLoginMessage('Login error occurred. Please try again.');
          setRequestStatus('denied');
          setLoginButtonLoading(false);
          setTimeout(() => {
            setLoginMessage('');
            setRequestStatus(null);
          }, 5000);
        }
      }
    };
    
    window.addEventListener('message', handleMessage);
    
    // Handle popup being closed manually
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', handleMessage);
        setLoginButtonLoading(false);
        setRequestStatus(null);
      }
    }, 1000);
  };

  const handleTryAgain = () => {
    setRequestStatus(null);
    setLoginMessage('');
    setLoginButtonLoading(false);
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
      setUser(null);
      setUploadResult(null);
      setSelectedFile(null);
      setSendEmailReceipt(false);
      setIsPrivate(true);
      setError('');
      document.getElementById('file-input').value = '';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    setSelectedFile(file);
    setUploadResult(null);
    setError('');
  };

  // Upload card drag and drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only hide drag effect when leaving the upload card area
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      setSelectedFile(file);
      setUploadResult(null);
      setError('');
      // Clear the file input
      const fileInput = document.getElementById('file-input');
      if (fileInput) {
        fileInput.value = '';
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('sendEmailReceipt', sendEmailReceipt);
    formData.append('isPrivate', isPrivate);
    formData.append('retentionTime', retentionTime);

    setUploading(true);
    setUploadProgress(0);
    setError('');

    try {
      const response = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });

      // Ensure all values are properly serialized to prevent React rendering errors
      const result = {
        ...response.data,
        filename: String(response.data.filename || ''),
        size: Number(response.data.size || 0),
        downloadLink: String(response.data.downloadLink || ''),
        expiryTime: response.data.expiryTime ? String(response.data.expiryTime) : null
      };
      setUploadResult(result);
      setSelectedFile(null);
      setSendEmailReceipt(false);
      setIsPrivate(true);
      fetchUserFiles(); // Refresh file list
      // Reset file input
      document.getElementById('file-input').value = '';
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDeleteFile = async (fileId, filename) => {
    if (!window.confirm(`Are you sure you want to delete "${filename}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await axios.delete(`/api/files/${fileId}`);
      // Refresh the file list after successful deletion
      fetchUserFiles();
      console.log(`File deleted successfully: ${filename}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete file');
      console.error('Delete error:', err);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const copyToClipboard = async (text, button) => {
    try {
      await navigator.clipboard.writeText(text);
      // Show feedback (using textContent to prevent XSS)
      const originalText = button.getAttribute('data-original-text') || button.textContent;
      button.textContent = '✓ Copied!';
      button.style.background = 'rgba(34, 197, 94, 0.2)';
      button.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      button.style.color = '#86efac';
      
      setTimeout(() => {
        button.textContent = originalText;
        button.style.background = 'rgba(100, 255, 218, 0.1)';
        button.style.borderColor = 'rgba(100, 255, 218, 0.3)';
        button.style.color = '#64ffda';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        button.textContent = '✓ Copied!';
        button.style.background = 'rgba(34, 197, 94, 0.2)';
        button.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        button.style.color = '#86efac';
        
        setTimeout(() => {
          button.textContent = button.getAttribute('data-original-text') || 'Copy';
          button.style.background = 'rgba(100, 255, 218, 0.1)';
          button.style.borderColor = 'rgba(100, 255, 218, 0.3)';
          button.style.color = '#64ffda';
        }, 2000);
      } catch (fallbackErr) {
        alert('Failed to copy to clipboard');
      }
      document.body.removeChild(textArea);
    }
  };

  const getFileType = (filename) => {
    const extension = filename.toLowerCase().split('.').pop();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov'].includes(extension)) return 'video';
    if (['mp3', 'wav', 'm4a'].includes(extension)) return 'audio';
    return 'other';
  };

  const isMediaFile = (filename) => {
    return getFileType(filename) !== 'other';
  };

  const filterFiles = (files, filterType) => {
    if (filterType === 'all') return files;
    return files.filter(file => getFileType(file.originalName) === filterType);
  };

  // Collection management functions
  const fetchCollections = async () => {
    try {
      const response = await axios.get('/api/collections');
      setCollections(response.data);
    } catch (err) {
      console.error('Error fetching collections:', err);
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;
    
    try {
      const response = await axios.post('/api/collections', {
        name: newCollectionName,
        description: newCollectionDescription
      });
      
      setCollections([...collections, response.data]);
      setNewCollectionName('');
      setNewCollectionDescription('');
      setShowCreateCollection(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create collection');
    }
  };

  const handleDeleteCollection = async (collectionId) => {
    if (!window.confirm('Are you sure you want to delete this collection?')) return;
    
    try {
      await axios.delete(`/api/collections/${collectionId}`);
      setCollections(collections.filter(c => c.id !== collectionId));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete collection');
    }
  };

  const handleAddFileToCollection = async (collectionId, fileId) => {
    try {
      await axios.post(`/api/collections/${collectionId}/files`, { fileId });
      await fetchCollections(); // Refresh collections
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add file to collection');
    }
  };

  const handleRemoveFileFromCollection = async (collectionId, fileId) => {
    try {
      await axios.delete(`/api/collections/${collectionId}/files/${fileId}`);
      await fetchCollections(); // Refresh collections
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove file from collection');
    }
  };

  // Drag and drop handlers for collections
  const handleFileDragStart = (e, file) => {
    setDraggedFile(file);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleFileDragEnd = () => {
    setDraggedFile(null);
    setDragOverCollection(null);
  };

  const handleCollectionDragOver = (e, collectionId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverCollection(collectionId);
  };

  const handleCollectionDragLeave = (e) => {
    // Only clear drag state if we're leaving the collection item completely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverCollection(null);
    }
  };

  const handleCollectionDrop = async (e, collectionId) => {
    e.preventDefault();
    setDragOverCollection(null);
    
    if (draggedFile) {
      await handleAddFileToCollection(collectionId, draggedFile.id);
      setDraggedFile(null);
    }
  };

  // Helper function to find which collections contain a file
  const getFileCollections = (fileId) => {
    return collections.filter(collection => 
      collection.files.some(file => file.id === fileId)
    );
  };

  // Toggle collection expansion
  const toggleCollectionExpansion = (collectionId) => {
    setExpandedCollections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(collectionId)) {
        newSet.delete(collectionId);
      } else {
        newSet.add(collectionId);
      }
      return newSet;
    });
  };

  // Toggle collection file expansion
  const toggleCollectionFileExpansion = (fileId) => {
    setExpandedCollectionFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  // Media event handlers
  const handleMediaLoadStart = (fileId) => {
    setMediaLoadingStates(prev => new Map(prev.set(fileId, true)));
    setMediaErrorStates(prev => new Map(prev.set(fileId, false)));
  };

  const handleMediaCanPlay = (fileId) => {
    setMediaLoadingStates(prev => new Map(prev.set(fileId, false)));
  };

  const handleMediaError = (fileId, error) => {
    console.error(`Media error for file ${fileId}:`, error);
    setMediaLoadingStates(prev => new Map(prev.set(fileId, false)));
    setMediaErrorStates(prev => new Map(prev.set(fileId, true)));
  };

  const handleMediaClick = (e) => {
    // Prevent event bubbling to avoid interfering with media controls
    e.stopPropagation();
  };

  const toggleFullscreen = (element) => {
    // If element is a button, find the media element
    if (element.tagName === 'BUTTON' || element.tagName === 'svg' || element.tagName === 'path') {
      const container = element.closest('.image-container, .video-container');
      if (container) {
        element = container.querySelector('img, video');
      }
    }
    
    if (!element) {
      console.error('No media element found for fullscreen');
      return;
    }
    
    // Check if already in fullscreen
    const isFullscreen = document.fullscreenElement || 
                        document.webkitFullscreenElement || 
                        document.mozFullScreenElement || 
                        document.msFullscreenElement;
    
    if (!isFullscreen) {
      // Try multiple fullscreen APIs for browser compatibility
      const requestFullscreen = element.requestFullscreen || 
                               element.webkitRequestFullscreen || 
                               element.webkitEnterFullscreen || // iOS Safari for video
                               element.mozRequestFullScreen || 
                               element.msRequestFullscreen;
      
      if (requestFullscreen) {
        requestFullscreen.call(element).catch(err => {
          console.log('Error attempting to enable fullscreen:', err.message);
          
          // Fallback for iOS: try to enter fullscreen video mode
          if (element.tagName === 'VIDEO' && element.webkitEnterFullscreen) {
            try {
              element.webkitEnterFullscreen();
            } catch (fallbackErr) {
              console.log('Fallback fullscreen also failed:', fallbackErr.message);
            }
          }
        });
      } else {
        console.log('Fullscreen not supported on this device/browser');
      }
    } else {
      // Exit fullscreen
      const exitFullscreen = document.exitFullscreen || 
                            document.webkitExitFullscreen || 
                            document.mozCancelFullScreen || 
                            document.msExitFullscreen;
      
      if (exitFullscreen) {
        exitFullscreen.call(document);
      }
    }
  };

  useEffect(() => {
    const handleRouting = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/preview\/(.+)$/);
      if (match) {
        const fileId = match[1];
        // Only fetch preview file after auth loading is complete
        if (!authLoading) {
          fetchPreviewFile(fileId);
        }
      }
    };
    
    handleRouting();
    
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [authLoading]); // Add authLoading as dependency

  // Close collection dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showAddToCollection && !event.target.closest('.collection-button-container')) {
        setShowAddToCollection(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAddToCollection]);

  const fetchPreviewFile = async (fileId) => {
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
        setError('File not found or has expired');
      } else {
        setError('Failed to load file information');
      }
    }
  };

  if (authLoading) {
    return (
      <div className="app">
        <div className="container">
          <div className="loading">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {user && (
              <div className="user-info">
                <span>Welcome, {user.name}</span>
                <button onClick={handleLogout} className="logout-button">
                  Logout
                </button>
              </div>
            )}
      <div className="container">
        <header className="header">
          <div className="header-content">
            <a href="http://leolord.dk" className="title-link">
              <h1 className="title">
                LeoLord<br />
                File Sharing
              </h1>
            </a>
          </div>
        </header>

        {loginMessage && (
          <div className={`login-message ${loginMessage.includes('successful') ? 'success' : 'error'}`}>
            {loginMessage}
          </div>
        )}

        {previewFile ? (
          <div className="preview-container">
            <div className="preview-card">
              <div className="preview-header">
                <h2>
                  {previewFile.requiresAuth ? 'Private File' : previewFile.originalName}
                  {previewFile.isPrivate && !previewFile.requiresAuth && (
                    <span className="privacy-badge">🔒 Private</span>
                  )}
                </h2>
                {!previewFile.requiresAuth && previewFile.originalName && (
                  <div className="preview-details">
                    <span>{formatFileSize(previewFile.size)}</span>
                    <span>•</span>
                    <span>{new Date(previewFile.uploadTime).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>{previewFile.downloadCount} downloads</span>
                    {previewFile.expiryTime && (
                      <>
                        <span>•</span>
                        <span>Expires: {new Date(previewFile.expiryTime).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              
              {user && requestStatus !== 'pending' && !previewFile.requiresAuth && (
                <div className="preview-actions">
                  <button
                    onClick={(e) => copyToClipboard(window.location.href, e.target)}
                    className="copy-button"
                    data-original-text="Copy Link"
                    title="Copy link"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Link
                  </button>
                  <a
                    href={`/api/download/${previewFile.id}`}
                    className="download-button"
                    title="Download file"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download
                  </a>
                  {previewFile.originalName && isMediaFile(previewFile.originalName) && (
                    <button
                      onClick={() => setExpandedFile(expandedFile === previewFile.id ? null : previewFile.id)}
                      className="play-button"
                      title="Preview media"
                    >
                      <svg fill="currentColor" stroke="none" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {expandedFile === previewFile.id ? 'Hide' : 'Preview'}
                    </button>
                  )}
                </div>
              )}

              {!user && !previewFile.isPrivate && (
                <div className="preview-actions">
                  <button
                    onClick={(e) => copyToClipboard(window.location.href, e.target)}
                    className="copy-button"
                    data-original-text="Copy Link"
                    title="Copy link"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Link
                  </button>
                  <a
                    href={`/api/download/${previewFile.id}`}
                    className="download-button"
                    title="Download file"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download
                  </a>
                  {previewFile.originalName && isMediaFile(previewFile.originalName) && (
                    <button
                      onClick={() => setExpandedFile(expandedFile === previewFile.id ? null : previewFile.id)}
                      className="play-button"
                      title="Preview media"
                    >
                      <svg fill="currentColor" stroke="none" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      Play
                      {expandedFile === previewFile.id ? 'Hide' : 'Preview'}
                    </button>
                  )}
                </div>
              )}
              
              {expandedFile === previewFile.id && previewFile.originalName && isMediaFile(previewFile.originalName) && !previewFile.requiresAuth && (
                <div className="media-player">
                  {getFileType(previewFile.originalName) === 'image' && (
                    <div className="image-container">
                      {mediaLoadingStates.get(previewFile.id) && (
                        <div className="media-loading">
                          <div className="spinner"></div>
                          <span>Loading image...</span>
                        </div>
                      )}
                      {mediaErrorStates.get(previewFile.id) && (
                        <div className="media-error">
                          <svg fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span>Failed to load image</span>
                        </div>
                      )}
                      <img 
                        src={`/api/stream/${previewFile.id}`} 
                        alt={previewFile.originalName}
                        className="preview-image"
                        onClick={(e) => {toggleFullscreen(e.target); handleMediaClick(e);}}
                        onLoadStart={() => handleMediaLoadStart(previewFile.id)}
                        onLoad={() => handleMediaCanPlay(previewFile.id)}
                        onError={(e) => handleMediaError(previewFile.id, e)}
                      />
{!isMobile && (
                        <button 
                          className="fullscreen-button"
                          onClick={(e) => toggleFullscreen(e.target)}
                          title="Toggle fullscreen"
                        >
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  
                  {getFileType(previewFile.originalName) === 'video' && (
                    <div className="video-container">
                      {mediaLoadingStates.get(previewFile.id) && (
                        <div className="media-loading">
                          <div className="spinner"></div>
                          <span>Loading video...</span>
                        </div>
                      )}
                      {mediaErrorStates.get(previewFile.id) && (
                        <div className="media-error">
                          <svg fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span>Failed to load video</span>
                        </div>
                      )}
                      <video 
                        controls
                        className="preview-video"
                        playsInline
                        preload="metadata"
                        disablePictureInPicture={false}
                        crossOrigin="anonymous"
                        webkit-playsinline="true"
                        x-webkit-airplay="allow"
                        allow="fullscreen"
                        onClick={handleMediaClick}
                        onLoadStart={() => handleMediaLoadStart(previewFile.id)}
                        onCanPlay={() => handleMediaCanPlay(previewFile.id)}
                        onError={(e) => handleMediaError(previewFile.id, e)}
                      >
                        <source src={`/api/stream/${previewFile.id}`} type="video/mp4" />
                        <p>Your browser doesn't support this video format. 
                          <a href={`/api/download/${previewFile.id}`}>Download the video</a> to play it locally.
                        </p>
                      </video>
{!isMobile && (
                        <button 
                          className="fullscreen-button"
                          onClick={(e) => toggleFullscreen(e.target)}
                          title="Toggle fullscreen"
                        >
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  
                  {getFileType(previewFile.originalName) === 'audio' && (
                    <div className="audio-container">
                      {mediaLoadingStates.get(previewFile.id) && (
                        <div className="media-loading">
                          <div className="spinner"></div>
                          <span>Loading audio...</span>
                        </div>
                      )}
                      {mediaErrorStates.get(previewFile.id) && (
                        <div className="media-error">
                          <svg fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span>Failed to load audio</span>
                        </div>
                      )}
                      <audio 
                        src={`/api/stream/${previewFile.id}`}
                        controls
                        className="preview-audio"
                        onClick={handleMediaClick}
                        onLoadStart={() => handleMediaLoadStart(previewFile.id)}
                        onCanPlay={() => handleMediaCanPlay(previewFile.id)}
                        onError={(e) => handleMediaError(previewFile.id, e)}
                      />
                    </div>
                  )}
                </div>
              )}
              
              {previewFile.requiresAuth && (
                <div className="auth-required">
                  <p>This file is private and requires authentication to view.</p>
                  {user && requestStatus === 'pending' ? (
                    <div className="request-pending-state">
                      <div className="pending-icon">⏳</div>
                      <h4>Request Submitted</h4>
                      <p>Your access request has been sent to the administrator for review.</p>
                    </div>
                  ) : user && requestStatus === 'denied' ? (
                    <div className="request-denied-state">
                      <div className="denied-icon">❌</div>
                      <h4>Access Denied</h4>
                      <p>Your access request was not approved.</p>
                      <button onClick={handleTryAgain} className="try-again-button">
                        Try Again
                      </button>
                    </div>
                  ) : !user ? (
                    <button 
                      onClick={handleGoogleLogin} 
                      className={`google-login-button ${loginButtonLoading ? 'loading' : ''}`}
                      disabled={loginButtonLoading}
                    >
                      {loginButtonLoading ? (
                        <>
                          <div className="spinner"></div>
                          Sending request...
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" className="google-icon">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                          Sign in with Google
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="request-pending-state">
                      <div className="pending-icon">⏳</div>
                      <h4>Access Required</h4>
                      <p>You need approval to access this private file.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : !user ? (
          <div className="login-card">
            <h2>Please sign in to continue</h2>
            <p>You need to be authenticated to upload and download files.</p>
            <button 
              onClick={handleGoogleLogin} 
              className={`google-login-button ${loginButtonLoading ? 'loading' : ''}`}
              disabled={loginButtonLoading}
            >
              {loginButtonLoading ? (
                <>
                  <div className="spinner"></div>
                  Sending request...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="google-icon">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </>
              )}
            </button>
            <p className="note">
              Note: Your login request will be reviewed by the administrator before access is granted.
            </p>
          </div>
        ) : user && requestStatus === 'pending' ? (
          <div className="login-card">
            <h2>Access Request Pending</h2>
            <div className="request-pending-state">
              <div className="pending-icon">⏳</div>
              <h3>Hello, {user.name}!</h3>
              <p>You are signed in with Google, but your access request is being reviewed by the administrator.</p>
              <p>You will receive an email notification once your request is approved.</p>
              <div className="pending-actions">
                <button onClick={handleLogout} className="try-again-button">
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div 
              className={`upload-card ${isDragOver ? 'drag-over' : ''}`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
          <div className="upload-section">
            <div className="file-input-wrapper">
              <input
                id="file-input"
                type="file"
                onChange={handleFileChange}
                className="file-input"
              />
              <label htmlFor="file-input" className="file-input-label">
                <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {selectedFile ? selectedFile.name : 'Choose File'}
              </label>
            </div>

            <div className="controls-row">
              <label className="checkbox-wrapper disabled">
                <input
                  type="checkbox"
                  checked={sendEmailReceipt}
                  onChange={(e) => setSendEmailReceipt(e.target.checked)}
                  className="checkbox-input"
                  disabled
                />
                <span className="checkbox-label">Receive email receipt (temporarily disabled)</span>
              </label>

              <label className="checkbox-wrapper">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="checkbox-input"
                />
                <span className="checkbox-label">Private (login required)</span>
              </label>
            </div>

            <div className="controls-row">
              <label htmlFor="retention-select" className="retention-label">Expire in:</label>
              <select
                id="retention-select"
                value={retentionTime}
                onChange={(e) => setRetentionTime(e.target.value)}
                className="retention-select"
              >
                <option value="1hour">1 Hour</option>
                <option value="5hours">5 Hours</option>
                <option value="12hours">12 Hours</option>
                <option value="24hours">24 Hours</option>
                <option value="permanent">Permanent</option>
              </select>
            </div>

            <button
              onClick={handleUpload}
              disabled={uploading || !selectedFile}
              className="upload-button"
            >
              {uploading ? (
                <>
                  <div className="spinner"></div>
                  Uploading... {uploadProgress}%
                </>
              ) : (
                'Upload File'
              )}
            </button>

            {uploading && (
              <div className="upload-progress-container">
                <div className="upload-progress-bar">
                  <div 
                    className="upload-progress-fill" 
                    style={{width: `${uploadProgress}%`}}
                  ></div>
                </div>
                <div className="upload-progress-text">{uploadProgress}%</div>
              </div>
            )}
          </div>

          {error && (
            <div className="error-message">
              <svg className="error-icon" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          {uploadResult && (
            <div className="success-section">
              <div className="success-message">
                <svg className="success-icon" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                File uploaded successfully!
              </div>

              <div className="file-info">
                <div className="info-row">
                  <span className="info-label">File:</span>
                  <span className="info-value">{uploadResult.filename}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Size:</span>
                  <span className="info-value">{formatFileSize(uploadResult.size)}</span>
                </div>
                {uploadResult.expiryTime && (
                  <div className="info-row">
                    <span className="info-label">Expires:</span>
                    <span className="info-value">
                      {uploadResult.expiryTime ? new Date(uploadResult.expiryTime).toLocaleString() : 'No expiry'}
                    </span>
                  </div>
                )}
              </div>

              <div className="download-link-section">
                <label className="download-label">Download Link:</label>
                <div className="link-wrapper">
                  <input
                    type="text"
                    value={uploadResult.downloadLink}
                    readOnly
                    className="download-link-input"
                  />
                  <button
                    onClick={(e) => copyToClipboard(uploadResult.downloadLink, e.target)}
                    className="copy-button"
                    title="Copy to clipboard"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
            </div>

            <div className="files-section">
              <h2>Your Uploaded Files</h2>
              
              {userFiles.length > 0 && (
                <div className="file-filters">
                  <button 
                    className={`filter-button ${fileTypeFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('all')}
                  >
                    All ({userFiles.length})
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'audio' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('audio')}
                  >
                    🎵 Audio ({userFiles.filter(f => getFileType(f.originalName) === 'audio').length})
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'image' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('image')}
                  >
                    🖼️ Pictures ({userFiles.filter(f => getFileType(f.originalName) === 'image').length})
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'video' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('video')}
                  >
                    🎬 Videos ({userFiles.filter(f => getFileType(f.originalName) === 'video').length})
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'other' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('other')}
                  >
                    📄 Other ({userFiles.filter(f => getFileType(f.originalName) === 'other').length})
                  </button>
                </div>
              )}
              
              {/* Drop zone for removing files from collections */}
              {draggedFile && draggedFile.fromCollection && (
                <div 
                  className="remove-from-collection-zone"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    if (draggedFile && draggedFile.fromCollection) {
                      await handleRemoveFileFromCollection(draggedFile.fromCollection, draggedFile.id);
                      setDraggedFile(null);
                    }
                  }}
                >
                  <div className="remove-zone-content">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1H9a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span>Drop here to remove from collection</span>
                  </div>
                </div>
              )}

              {/* Collections Section */}
              <div className={`collections-section ${draggedFile ? 'drag-active' : ''}`}>
                <div className="collections-header">
                  <h3>Collections</h3>
                  <button 
                    className="create-collection-button"
                    onClick={() => setShowCreateCollection(true)}
                  >
                    + Create Collection
                  </button>
                </div>
                
                {collections.length === 0 ? (
                  <div className="no-collections">No collections yet. Create one to organize your files!</div>
                ) : (
                  <div className="collections-list">
                    {collections.map((collection) => (
                      <div 
                        key={collection.id} 
                        className={`collection-item ${dragOverCollection === collection.id ? 'drag-over' : ''}`}
                        onDragOver={(e) => handleCollectionDragOver(e, collection.id)}
                        onDragLeave={handleCollectionDragLeave}
                        onDrop={(e) => handleCollectionDrop(e, collection.id)}
                      >
                        <div className="collection-header-row">
                          <div className="collection-info">
                            <div className="collection-name-row">
                              <button
                                className="collection-expand-button"
                                onClick={() => toggleCollectionExpansion(collection.id)}
                                title={expandedCollections.has(collection.id) ? 'Collapse' : 'Expand'}
                              >
                                <svg 
                                  fill="none" 
                                  stroke="currentColor" 
                                  viewBox="0 0 24 24"
                                  className={expandedCollections.has(collection.id) ? 'expanded' : 'collapsed'}
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                              <span className="collection-name">{collection.name}</span>
                              <span className="collection-count">{collection.files.length} files</span>
                            </div>
                          </div>
                          <div className="collection-actions">
                            <button 
                              className="collection-edit-button"
                              onClick={() => setEditingCollection(collection)}
                            >
                              Edit
                            </button>
                            <button 
                              className="collection-delete-button"
                              onClick={() => handleDeleteCollection(collection.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        
                        {expandedCollections.has(collection.id) && (
                          <div className="collection-files">
                            {collection.files.length === 0 ? (
                              <div className="no-files-in-collection">No files in this collection</div>
                            ) : (
                              collection.files.map((file) => (
                                <div 
                                  key={file.id} 
                                  className="collection-file-item"
                                  draggable
                                  onDragStart={(e) => {
                                    setDraggedFile({...file, fromCollection: collection.id});
                                    e.dataTransfer.effectAllowed = 'move';
                                  }}
                                  onDragEnd={handleFileDragEnd}
                                >
                                  <div className="collection-file-header">
                                    <div className="collection-file-info">
                                      <div className="collection-file-name-section">
                                        <a 
                                          href={`/preview/${file.id}`} 
                                          className="collection-file-name"
                                          title="View file preview"
                                        >
                                          {file.originalName}
                                        </a>
                                        <span className={`file-visibility ${file.isPrivate ? 'private' : 'public'}`}>
                                          {file.isPrivate ? '🔒 Private' : '🌐 Public'}
                                        </span>
                                      </div>
                                      <div className="collection-file-details">
                                        <span>{formatFileSize(file.size)}</span>
                                        <span>•</span>
                                        <span>{new Date(file.uploadTime).toLocaleDateString()}</span>
                                        <span>•</span>
                                        <span>{file.downloadCount || 0} downloads</span>
                                        {file.expiryTime && (
                                          <>
                                            <span>•</span>
                                            <span>Expires: {new Date(file.expiryTime).toLocaleDateString()}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    <div className="collection-file-actions">
                                      <button
                                        onClick={(e) => copyToClipboard(file.downloadLink, e.target)}
                                        className="copy-button"
                                        data-original-text="Copy"
                                        title="Copy link"
                                      >
                                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                      </button>
                                      <a
                                        href={`/api/download/${file.id}`}
                                        className="download-button"
                                        title="Download file"
                                      >
                                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                      </a>
                                      {isMediaFile(file.originalName) && (
                                        <button
                                          onClick={() => toggleCollectionFileExpansion(file.id)}
                                          className="play-button"
                                          title="Preview media"
                                        >
                                          <svg fill="currentColor" stroke="none" viewBox="0 0 24 24">
                                            <path d="M8 5v14l11-7z" />
                                          </svg>
                                        </button>
                                      )}
                                      <button
                                        onClick={() => handleRemoveFileFromCollection(collection.id, file.id)}
                                        className="collection-file-remove"
                                        title="Remove from collection"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                  
                                  {expandedCollectionFiles.has(file.id) && isMediaFile(file.originalName) && (
                                    <div className="media-player">
                                      {getFileType(file.originalName) === 'image' && (
                                        <div className="image-container">
                                          {mediaLoadingStates.get(file.id) && (
                                            <div className="media-loading">
                                              <div className="spinner"></div>
                                              <span>Loading image...</span>
                                            </div>
                                          )}
                                          {mediaErrorStates.get(file.id) && (
                                            <div className="media-error">
                                              <svg fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                              </svg>
                                              <span>Failed to load image</span>
                                            </div>
                                          )}
                                          <img 
                                            src={`/api/stream/${file.id}`} 
                                            alt={file.originalName}
                                            className="preview-image"
                                            onClick={(e) => {toggleFullscreen(e.target); handleMediaClick(e);}}
                                            onLoadStart={() => handleMediaLoadStart(file.id)}
                                            onLoad={() => handleMediaCanPlay(file.id)}
                                            onError={(e) => handleMediaError(file.id, e)}
                                          />
                                          {!isMobile && (
                                            <button 
                                              className="fullscreen-button"
                                              onClick={(e) => toggleFullscreen(e.target)}
                                              title="Toggle fullscreen"
                                            >
                                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      )}
                                      
                                      {getFileType(file.originalName) === 'video' && (
                                        <div className="video-container">
                                          {mediaLoadingStates.get(file.id) && (
                                            <div className="media-loading">
                                              <div className="spinner"></div>
                                              <span>Loading video...</span>
                                            </div>
                                          )}
                                          {mediaErrorStates.get(file.id) && (
                                            <div className="media-error">
                                              <svg fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                              </svg>
                                              <span>Failed to load video</span>
                                            </div>
                                          )}
                                          <video 
                                            controls
                                            className="preview-video"
                                            playsInline
                                            preload="metadata"
                                            disablePictureInPicture={false}
                                            crossOrigin="anonymous"
                                            webkit-playsinline="true"
                                            x-webkit-airplay="allow"
                                            allow="fullscreen"
                                            onClick={handleMediaClick}
                                            onLoadStart={() => handleMediaLoadStart(file.id)}
                                            onCanPlay={() => handleMediaCanPlay(file.id)}
                                            onError={(e) => handleMediaError(file.id, e)}
                                          >
                                            <source src={`/api/stream/${file.id}`} type="video/mp4" />
                                            <p>Your browser doesn't support this video format. 
                                              <a href={`/api/download/${file.id}`}>Download the video</a> to play it locally.
                                            </p>
                                          </video>
                                          {!isMobile && (
                                            <button 
                                              className="fullscreen-button"
                                              onClick={(e) => toggleFullscreen(e.target)}
                                              title="Toggle fullscreen"
                                            >
                                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      )}
                                      
                                      {getFileType(file.originalName) === 'audio' && (
                                        <div className="audio-container">
                                          {mediaLoadingStates.get(file.id) && (
                                            <div className="media-loading">
                                              <div className="spinner"></div>
                                              <span>Loading audio...</span>
                                            </div>
                                          )}
                                          {mediaErrorStates.get(file.id) && (
                                            <div className="media-error">
                                              <svg fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                              </svg>
                                              <span>Failed to load audio</span>
                                            </div>
                                          )}
                                          <audio 
                                            src={`/api/stream/${file.id}`}
                                            controls
                                            className="preview-audio"
                                            onClick={handleMediaClick}
                                            onLoadStart={() => handleMediaLoadStart(file.id)}
                                            onCanPlay={() => handleMediaCanPlay(file.id)}
                                            onError={(e) => handleMediaError(file.id, e)}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {filesLoading ? (
                <div className="loading">Loading your files...</div>
              ) : userFiles.length === 0 ? (
                <div className="no-files">No files uploaded yet</div>
              ) : (
                <div className="files-list">
                  {filterFiles(userFiles, fileTypeFilter).map((file) => (
                    <div 
                      key={file.id} 
                      className="file-item"
                      draggable
                      onDragStart={(e) => handleFileDragStart(e, file)}
                      onDragEnd={handleFileDragEnd}
                    >
                      <div className="file-info-row">
                        <div className="file-info">
                          <div className="file-name">
                            <a 
                              href={`/preview/${file.id}`} 
                              className="file-name-link"
                              title="View file preview"
                            >
                              {file.originalName}
                            </a>
                            <span className={`file-visibility ${file.isPrivate ? 'private' : 'public'}`}>
                              {file.isPrivate ? '🔒 Private' : '🌐 Public'}
                            </span>
                          </div>
                          <div className="file-details">
                            <span>{formatFileSize(file.size)}</span>
                            <span>•</span>
                            <span>{new Date(file.uploadTime).toLocaleDateString()}</span>
                            <span>•</span>
                            <span>{file.downloadCount} downloads</span>
                            {file.expiryTime && (
                              <>
                                <span>•</span>
                                <span>Expires: {new Date(file.expiryTime).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                          {getFileCollections(file.id).length > 0 && (
                            <div className="file-collections">
                              <span>In collections: </span>
                              {getFileCollections(file.id).map((collection, index) => (
                                <span key={collection.id} className="collection-tag-container">
                                  <span className="collection-tag">{collection.name}</span>
                                  <button
                                    onClick={() => handleRemoveFileFromCollection(collection.id, file.id)}
                                    className="remove-from-collection-button"
                                    title={`Remove from ${collection.name}`}
                                  >
                                    ×
                                  </button>
                                  {index < getFileCollections(file.id).length - 1 && <span className="collection-separator">, </span>}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="file-actions">
                        <button
                          onClick={(e) => copyToClipboard(file.downloadLink, e.target)}
                          className="copy-button"
                          data-original-text="Copy"
                          title="Copy link"
                        >
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                        <a
                          href={`/api/download/${file.id}`}
                          className="download-button"
                          title="Download file"
                        >
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </a>
                        {isMediaFile(file.originalName) && (
                          <button
                            onClick={() => setExpandedFile(expandedFile === file.id ? null : file.id)}
                            className="play-button"
                            title="Play media"
                          >
                            <svg fill="currentColor" stroke="none" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        )}
                        <div className="collection-button-container">
                          <button
                            onClick={() => setShowAddToCollection(showAddToCollection === file.id ? null : file.id)}
                            className="add-to-collection-button"
                            title="Add to collection"
                          >
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                          </button>
                          {showAddToCollection === file.id && (
                            <div className="collection-dropdown">
                              <div className="collection-dropdown-content">
                                {collections.length === 0 ? (
                                  <div className="no-collections-option">No collections available</div>
                                ) : (
                                  collections
                                    .filter(collection => !getFileCollections(file.id).find(fc => fc.id === collection.id))
                                    .map(collection => (
                                      <button
                                        key={collection.id}
                                        onClick={() => {
                                          handleAddFileToCollection(collection.id, file.id);
                                          setShowAddToCollection(null);
                                        }}
                                        className="collection-dropdown-item"
                                      >
                                        {collection.name}
                                      </button>
                                    ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteFile(file.id, file.originalName)}
                          className="delete-button"
                          title="Delete file"
                        >
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1H9a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                        </div>
                      </div>
                      
                      {expandedFile === file.id && isMediaFile(file.originalName) && (
                        <div className="media-player">
                          {getFileType(file.originalName) === 'image' && (
                            <div className="image-container">
                              {mediaLoadingStates.get(file.id) && (
                                <div className="media-loading">
                                  <div className="spinner"></div>
                                  <span>Loading image...</span>
                                </div>
                              )}
                              {mediaErrorStates.get(file.id) && (
                                <div className="media-error">
                                  <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <span>Failed to load image</span>
                                </div>
                              )}
                              <img 
                                src={`/api/stream/${file.id}`} 
                                alt={file.originalName}
                                className="preview-image"
                                onClick={(e) => {toggleFullscreen(e.target); handleMediaClick(e);}}
                                onLoadStart={() => handleMediaLoadStart(file.id)}
                                onLoad={() => handleMediaCanPlay(file.id)}
                                onError={(e) => handleMediaError(file.id, e)}
                              />
                              {!isMobile && (
                                <button 
                                  className="fullscreen-button"
                                  onClick={(e) => toggleFullscreen(e.target)}
                                  title="Toggle fullscreen"
                                >
                                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          )}
                          
                          {getFileType(file.originalName) === 'video' && (
                            <div className="video-container">
                              {mediaLoadingStates.get(file.id) && (
                                <div className="media-loading">
                                  <div className="spinner"></div>
                                  <span>Loading video...</span>
                                </div>
                              )}
                              {mediaErrorStates.get(file.id) && (
                                <div className="media-error">
                                  <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <span>Failed to load video</span>
                                </div>
                              )}
                              <video 
                                controls
                                className="preview-video"
                                playsInline
                                preload="metadata"
                                disablePictureInPicture={false}
                                crossOrigin="anonymous"
                                webkit-playsinline="true"
                                x-webkit-airplay="allow"
                                allow="fullscreen"
                                onClick={handleMediaClick}
                                onLoadStart={() => handleMediaLoadStart(file.id)}
                                onCanPlay={() => handleMediaCanPlay(file.id)}
                                onError={(e) => handleMediaError(file.id, e)}
                              >
                                <source src={`/api/stream/${file.id}`} type="video/mp4" />
                                <p>Your browser doesn't support this video format. 
                                  <a href={`/api/download/${file.id}`}>Download the video</a> to play it locally.
                                </p>
                              </video>
                              {!isMobile && (
                                <button 
                                  className="fullscreen-button"
                                  onClick={(e) => toggleFullscreen(e.target)}
                                  title="Toggle fullscreen"
                                >
                                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          )}
                          
                          {getFileType(file.originalName) === 'audio' && (
                            <div className="audio-container">
                              {mediaLoadingStates.get(file.id) && (
                                <div className="media-loading">
                                  <div className="spinner"></div>
                                  <span>Loading audio...</span>
                                </div>
                              )}
                              {mediaErrorStates.get(file.id) && (
                                <div className="media-error">
                                  <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <span>Failed to load audio</span>
                                </div>
                              )}
                              <audio 
                                src={`/api/stream/${file.id}`}
                                controls
                                className="preview-audio"
                                onClick={handleMediaClick}
                                onLoadStart={() => handleMediaLoadStart(file.id)}
                                onCanPlay={() => handleMediaCanPlay(file.id)}
                                onError={(e) => handleMediaError(file.id, e)}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        
        {/* Create Collection Modal */}
        {showCreateCollection && (
          <div className="modal-overlay" onClick={() => setShowCreateCollection(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Create New Collection</h3>
              <input
                type="text"
                placeholder="Collection name"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                className="modal-input"
                maxLength={50}
              />
              <textarea
                placeholder="Description (optional)"
                value={newCollectionDescription}
                onChange={(e) => setNewCollectionDescription(e.target.value)}
                className="modal-textarea"
                maxLength={200}
              />
              <div className="modal-actions">
                <button 
                  className="modal-cancel-button"
                  onClick={() => setShowCreateCollection(false)}
                >
                  Cancel
                </button>
                <button 
                  className="modal-confirm-button"
                  onClick={handleCreateCollection}
                  disabled={!newCollectionName.trim()}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;