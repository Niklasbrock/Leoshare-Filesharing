import React, { useEffect, useCallback, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './App.css';

// Import components
import CreateCollectionModal from './components/CreateCollectionModal';
import DirectUpload from './components/DirectUpload';

// Import custom hooks
import { useAuth } from './hooks/useAuth';
import { useFileUpload } from './hooks/useFileUpload';
import { useFileManager } from './hooks/useFileManager';
import { useClipboard } from './hooks/useClipboard';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { usePreviewFile } from './hooks/usePreviewFile';

// Import components
import LoginPage from './components/LoginPage';
import FileUploadCard from './components/FileUploadCard';
import MediaPlayer from './components/MediaPlayer';
import CollectionPreview from './components/CollectionPreview';

// Import icons
import iconAll from './assets/images/icon_all.png';


// Configure axios to include credentials
axios.defaults.withCredentials = true;

// Main page component with auth check
const MainPage = () => {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);

  // Auth state
  const {
    user,
    authLoading,
    requestStatus,
    loginMessage,
    handleLogout
  } = useAuth();

  // File upload state
  const {
    selectedFiles,
    isPrivate,
    retentionTime,
    uploading,
    uploadProgress,
    uploadResults,
    error: uploadError,
    setSelectedFiles,
    setIsPrivate,
    setRetentionTime,
    setError: setUploadError,
    handleFileChange,
    handleUpload: performUpload,
    resetUploadState
  } = useFileUpload();

  // File management state
  const {
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
  } = useFileManager();

  // Utility hooks
  const { copyToClipboard } = useClipboard();
  const { previewFile } = usePreviewFile(authLoading, user, requestStatus);

  // Collections state
  const [collections, setCollections] = useState([]);
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [newCollectionIsPrivate, setNewCollectionIsPrivate] = useState(false);
  const [expandedCollections, setExpandedCollections] = useState(new Set());
  const [expandedCollectionFiles, setExpandedCollectionFiles] = useState(new Set());
  const [collectionsExpanded, setCollectionsExpanded] = useState(false);



  // Enhanced upload handler with error handling
  const handleUpload = useCallback(async () => {
    const result = await performUpload();
    if (result) {
      // Refresh file list after successful upload
      fetchUserFiles();
    }
  }, [performUpload, fetchUserFiles]);

  // Enhanced delete handler with error handling
  const handleDeleteFileWithFeedback = useCallback(async (fileId, filename) => {
    try {
      await handleDeleteFile(fileId, filename);
    } catch (error) {
      setUploadError(error.message);
    }
  }, [handleDeleteFile, setUploadError]);

  // Enhanced logout handler
  const handleLogoutWithCleanup = useCallback(async () => {
    const success = await handleLogout();
    if (success) {
      resetUploadState();
      setCollections([]);
      // Clear any file input
      const fileInput = document.getElementById('file-input');
      if (fileInput) {
        fileInput.value = '';
      }
    }
  }, [handleLogout, resetUploadState]);

  // Drag and drop handler with file selection
  const handleFileDropped = useCallback((files) => {
    console.log('handleFileDropped called with:', files);
    // Clear any previous errors and upload results, then set the files
    setUploadError('');
    
    // Trigger the file input change event to ensure consistency with manual file selection
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      // Create a DataTransfer object and add all the files
      const dataTransfer = new DataTransfer();
      files.forEach(file => dataTransfer.items.add(file));
      fileInput.files = dataTransfer.files;
      
      // Trigger the change event
      const event = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(event);
    } else {
      // Fallback if file input not found
      setSelectedFiles(files);
    }
    
    console.log('Files selection should be updated to:', files?.map(f => f.name));
  }, [setSelectedFiles, setUploadError]);

  const { isDragOver, handleDragEnter, handleDragLeave, handleDragOver, handleDrop } = useDragAndDrop(handleFileDropped);

  // Media player click handler
  const handleMediaClick = useCallback((e) => {
    e.stopPropagation();
  }, []);

  // Collections management functions
  const fetchCollections = useCallback(async () => {
    try {
      const response = await axios.get('/api/collections');
      setCollections(response.data);
    } catch (err) {
      console.error('Error fetching collections:', err);
    }
  }, []);

  const handleCreateCollection = useCallback(async () => {
    if (!newCollectionName.trim()) return;
    
    try {
      const response = await axios.post('/api/collections', {
        name: newCollectionName,
        description: newCollectionDescription,
        isPrivate: newCollectionIsPrivate
      });
      
      setCollections(prevCollections => [...prevCollections, response.data]);
      setNewCollectionName('');
      setNewCollectionDescription('');
      setNewCollectionIsPrivate(false);
      setShowCreateCollection(false);
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Failed to create collection');
    }
  }, [newCollectionName, newCollectionDescription, newCollectionIsPrivate, setUploadError]);

  const handleDeleteCollection = useCallback(async (collectionId) => {
    if (!window.confirm('Are you sure you want to delete this collection?')) return;
    
    try {
      await axios.delete(`/api/collections/${collectionId}`);
      setCollections(prevCollections => prevCollections.filter(c => c.id !== collectionId));
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Failed to delete collection');
    }
  }, [setUploadError]);

  const handleAddFileToCollection = useCallback(async (collectionId, fileId) => {
    try {
      await axios.post(`/api/collections/${collectionId}/files`, { fileId });
      await fetchCollections(); // Refresh collections
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Failed to add file to collection');
    }
  }, [fetchCollections, setUploadError]);

  const handleRemoveFileFromCollection = useCallback(async (collectionId, fileId) => {
    try {
      await axios.delete(`/api/collections/${collectionId}/files/${fileId}`);
      await fetchCollections(); // Refresh collections
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Failed to remove file from collection');
    }
  }, [fetchCollections, setUploadError]);


  // Helper function to find which collections contain a file
  const getFileCollections = useCallback((fileId) => {
    return collections.filter(collection => 
      collection.files.some(file => file.id === fileId)
    );
  }, [collections]);

  // Toggle collection expansion
  const toggleCollectionExpansion = useCallback((collectionId) => {
    setExpandedCollections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(collectionId)) {
        newSet.delete(collectionId);
      } else {
        newSet.add(collectionId);
      }
      return newSet;
    });
  }, []);

  // Toggle collection file expansion
  const toggleCollectionFileExpansion = useCallback((fileId) => {
    setExpandedCollectionFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);


  // Mobile detection effect
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const screenWidth = window.innerWidth;
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const mobile = /android|iPad|iPhone|iPod|blackberry|iemobile|opera mini/i.test(userAgent) || 
                    (screenWidth <= 768 && isTouchDevice);
      
      setIsMobile(mobile);
      // Mobile detection logging (disabled to reduce console noise)
      // console.log('📱 Mobile detection:', {
      //   mobile,
      //   userAgent: userAgent.substring(0, 50) + '...',
      //   screenWidth,
      //   isTouchDevice,
      //   timestamp: new Date().toISOString()
      // });
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

  // Auth check and redirect logic
  useEffect(() => {
    if (!authLoading) {
      // If user is not authenticated or not approved, redirect to login
      // BUT only for the main page, not for file preview, collection, or direct-upload routes
      const isPreviewRoute = window.location.pathname.startsWith('/preview/');
      const isCollectionRoute = window.location.pathname.startsWith('/collection/');
      const isDirectUploadRoute = window.location.pathname.startsWith('/direct-upload/');

      if ((!user || requestStatus === 'pending') && !isPreviewRoute && !isCollectionRoute && !isDirectUploadRoute) {
        navigate('/login', { replace: true });
      }
    }
  }, [user, requestStatus, authLoading, navigate]);

  // Load user data when authenticated and approved
  useEffect(() => {
    if (user && requestStatus === null && !authLoading) {
      // Only load files when user is authenticated, approved (requestStatus === null), and auth loading is complete
      fetchUserFiles();
      fetchCollections();
    }
  }, [user, requestStatus, authLoading, fetchUserFiles, fetchCollections]);

  // Cleanup effect for potential memory leaks
  useEffect(() => {
    const handleFullscreenChange = () => {
      // Handle fullscreen state changes if needed
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Auto-expand media player for preview files
  useEffect(() => {
    if (previewFile && previewFile.originalName && isMediaFile(previewFile.originalName) && !previewFile.requiresAuth) {
      setExpandedFile(previewFile.id);
    }
  }, [previewFile, isMediaFile, setExpandedFile]);


  // Loading state with mobile-aware styling
  if (authLoading) {
    return (
      <div className={`app ${isMobile ? 'mobile-loading' : 'desktop-loading'}`}>
        <div className="container">
          <div className="loading">
            <div className="loading-spinner">
              <div className="spinner"></div>
            </div>
            <div className="loading-text">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  // Debug logging for render conditions (disabled to prevent infinite logging)
  // console.log('🎯 App render state:', {
  //   authLoading,
  //   user: !!user,
  //   userName: user?.name,
  //   requestStatus,
  //   isMobile,
  //   previewFile: !!previewFile,
  //   timestamp: new Date().toISOString()
  // });

  // Show loading while checking auth status
  if (authLoading) {
    return (
      <div className={`app ${isMobile ? 'mobile' : 'desktop'}`}>
        <div className="container">
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Main interface component 
  const MainInterface = () => (
    <div className={`app ${isMobile ? 'mobile' : 'desktop'}`}>
      {user && (
        <div className="user-info">
          <span>Welcome, {user?.name || user?.email || 'User'}</span>
          {user?.isAdmin && (
            <div className="admin-buttons">
              <button
                onClick={() => window.open('/api/admin/users', '_blank')}
                className="admin-button"
                title="User Management - Approve/Decline Users"
              >
                👥 User Management
              </button>
              <button
                onClick={() => window.open('/api/admin/test-email', '_blank')}
                className="admin-button"
                title="Test Email Configuration"
              >
                📧 Test Email
              </button>
              <button
                onClick={() => window.open('/api/admin/email-queue', '_blank')}
                className="admin-button"
                title="View Email Queue Status"
              >
                📤 Email Queue
              </button>
              <button
                onClick={() => window.open('/api/admin/direct-upload', '_blank')}
                className="admin-button"
                title="Direct Upload - Create Upload Links for External Users"
              >
                📥 Direct Upload
              </button>
            </div>
          )}
          <button onClick={handleLogoutWithCleanup} className="logout-button">
            Logout
          </button>
        </div>
      )}
      
      <div className="container">
        <header className="header">
          <div className="header-content">
            <a href="https://leoshare.dk" className="title-link">
              <h1 className="title">
                LeoShare<br />
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
              
              {user && requestStatus === null && !authLoading && !previewFile.requiresAuth && (
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
                </div>
              )}
              
              {expandedFile === previewFile.id && previewFile.originalName && isMediaFile(previewFile.originalName) && !previewFile.requiresAuth && (
                <MediaPlayer
                  fileId={previewFile.id}
                  originalName={previewFile.originalName}
                  getFileType={getFileType}
                  isMobile={isMobile}
                  onMediaClick={handleMediaClick}
                />
              )}
            </div>
          </div>
        ) : (
          <>
            <FileUploadCard
              selectedFiles={selectedFiles}
              isPrivate={isPrivate}
              retentionTime={retentionTime}
              uploading={uploading}
              uploadProgress={uploadProgress}
              uploadResults={uploadResults}
              error={uploadError}
              isDragOver={isDragOver}
              onFileChange={handleFileChange}
              onIsPrivateChange={setIsPrivate}
              onRetentionTimeChange={setRetentionTime}
              onUpload={handleUpload}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              formatFileSize={formatFileSize}
              copyToClipboard={copyToClipboard}
            />

            {/* Collections Section */}
            <div 
              className="collections-section"
              onClick={(e) => {
                // Don't trigger if clicking on buttons
                if (!e.target.closest('button')) {
                  setCollectionsExpanded(!collectionsExpanded);
                }
              }}
              style={{ cursor: 'pointer' }}
              title={collectionsExpanded ? 'Collapse Collections' : 'Expand Collections'}
            >
              <div className="collections-header">
                <div className="collections-title-row">
                  <button
                    className="collections-expand-button"
                    onClick={() => setCollectionsExpanded(!collectionsExpanded)}
                    title={collectionsExpanded ? 'Collapse Collections' : 'Expand Collections'}
                  >
                    <svg 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                      className={collectionsExpanded ? 'expanded' : 'collapsed'}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <h3>Collections ({collections.length})</h3>
                </div>
                <button 
                  className="create-collection-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCreateCollection(true);
                  }}
                >
                  + Create Collection
                </button>
              </div>
              
              {collectionsExpanded && (
                <>
                  {collections.length === 0 ? (
                    <div className="no-collections">No collections yet. Create one to organize your files!</div>
                  ) : (
                    <div className="collections-list">
                  {collections.map((collection) => (
                    <div 
                      key={collection.id} 
                      className="collection-item"
                      onClick={(e) => {
                        // Don't trigger if clicking on buttons or links
                        if (!e.target.closest('button') && !e.target.closest('a')) {
                          toggleCollectionExpansion(collection.id);
                        }
                        // Prevent this click from bubbling up to the Collections section
                        e.stopPropagation();
                      }}
                      style={{ cursor: 'pointer' }}
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
                            <a 
                              href={`/collection/${collection.id}`} 
                              className="collection-name-link"
                              title="View collection preview"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {collection.name}
                            </a>
                            <span className={`collection-visibility ${collection.isPublic ? 'public' : 'private'}`}>
                              {collection.isPublic ? 'Public' : 'Private'}
                            </span>
                            <span className="collection-count">{collection.files?.length || 0} files</span>
                          </div>
                        </div>
                        <div className="collection-actions">
                          <button 
                            className="share-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(`${window.location.origin}/collection/${collection.id}`, e.target);
                            }}
                            title="Copy collection link"
                            data-original-text="Copy"
                          >
                            Copy
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
                          {(!collection.files || collection.files.length === 0) ? (
                            <div className="no-files-in-collection">No files in this collection</div>
                          ) : (
                            collection.files.map((file) => (
                              <div 
                                key={file.id} 
                                className="collection-file-item"
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
                                  <MediaPlayer
                                    fileId={file.id}
                                    originalName={file.originalName}
                                    getFileType={getFileType}
                                    isMobile={isMobile}
                                    onMediaClick={handleMediaClick}
                                  />
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
                </>
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
                    <span className="filter-icon">
                      <img src={iconAll} alt="All files icon" style={{ width: '25px', height: '25px' }} />
                    </span>
                    <span className="filter-text"> All ({userFiles.length})</span>
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'audio' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('audio')}
                  >
                    <span className="filter-icon">🎵</span>
                    <span className="filter-text"> Audio ({userFiles.filter(f => getFileType(f.originalName) === 'audio').length})</span>
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'image' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('image')}
                  >
                    <span className="filter-icon">🖼️</span>
                    <span className="filter-text"> Pictures ({userFiles.filter(f => getFileType(f.originalName) === 'image').length})</span>
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'video' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('video')}
                  >
                    <span className="filter-icon">🎬</span>
                    <span className="filter-text"> Videos ({userFiles.filter(f => getFileType(f.originalName) === 'video').length})</span>
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'document' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('document')}
                  >
                    <span className="filter-icon">📄</span>
                    <span className="filter-text"> Documents ({userFiles.filter(f => getFileType(f.originalName) === 'document').length})</span>
                  </button>
                  <button 
                    className={`filter-button ${fileTypeFilter === 'other' ? 'active' : ''}`}
                    onClick={() => setFileTypeFilter('other')}
                  >
                    <span className="filter-icon">📁</span>
                    <span className="filter-text"> Other ({userFiles.filter(f => getFileType(f.originalName) === 'other').length})</span>
                  </button>
                </div>
              )}
              
              {filesLoading ? (
                <div className="loading">Loading your files...</div>
              ) : userFiles.length === 0 ? (
                <div className="no-files">No files uploaded yet</div>
              ) : (
                <div className="files-list">
                  {filterFiles(userFiles, fileTypeFilter).map((file) => (
                    <div key={file.id} className="file-item">
                      <div 
                        className="file-info-row"
                      >
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
                          <div className="collection-select-container">
                            <div className="collection-select-icon">+</div>
                            <select
                              className="collection-select"
                              defaultValue=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleAddFileToCollection(e.target.value, file.id);
                                  e.target.value = ""; // Reset select
                                }
                              }}
                              title="Add to collection"
                            >
                              <option value="" disabled>Add to Collection</option>
                              {collections.length === 0 ? (
                                <option value="" disabled>No collections available</option>
                              ) : (
                                collections
                                  .filter(collection => !getFileCollections(file.id).find(fc => fc.id === collection.id))
                                  .map(collection => (
                                    <option key={collection.id} value={collection.id}>
                                      {collection.name}
                                    </option>
                                  ))
                              )}
                            </select>
                          </div>
                          <button
                            onClick={() => handleDeleteFileWithFeedback(file.id, file.originalName)}
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
                        <MediaPlayer
                          fileId={file.id}
                          originalName={file.originalName}
                          getFileType={getFileType}
                          isMobile={isMobile}
                          onMediaClick={handleMediaClick}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        
        {/* Create Collection Modal */}
        <CreateCollectionModal
          showCreateCollection={showCreateCollection}
          setShowCreateCollection={setShowCreateCollection}
          newCollectionName={newCollectionName}
          setNewCollectionName={setNewCollectionName}
          newCollectionDescription={newCollectionDescription}
          setNewCollectionDescription={setNewCollectionDescription}
          newCollectionIsPrivate={newCollectionIsPrivate}
          setNewCollectionIsPrivate={setNewCollectionIsPrivate}
          handleCreateCollection={handleCreateCollection}
        />
      </div>
    </div>
  );

  return <MainInterface />;
};

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainPage />} />
      <Route path="/preview/:fileId" element={<MainPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/collection/:collectionId" element={<CollectionPreview />} />
      <Route path="/direct-upload/:linkId" element={<DirectUpload />} />
    </Routes>
  );
}

export default App;