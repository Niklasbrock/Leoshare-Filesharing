import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { useFileManager } from '../hooks/useFileManager';
import { useAuth } from '../hooks/useAuth';
import MediaPlayer from './MediaPlayer';

// Inject CSS for optimized loading states
const loadingStyles = `
  .file-preview-container.media-active {
    height: auto;
    min-height: 200px;
    padding: 1rem;
    align-items: stretch;
  }
  
  .file-preview-container.media-active .media-player {
    width: 100%;
    height: auto;
  }
  
  .file-preview-container.media-active .preview-audio {
    width: 100%;
    height: 54px;
  }
  
  .file-preview-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 150px;
    background: #f8f9fa;
    border: 2px dashed #dee2e6;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .file-preview-placeholder:hover {
    background: #e9ecef;
  }
  
  .placeholder-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 8px;
  }
  
  .file-type-icon {
    font-size: 2rem;
    margin-bottom: 4px;
  }
  
  .loading-spinner-small {
    width: 20px;
    height: 20px;
    border: 2px solid #dee2e6;
    border-top: 2px solid #007bff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  .placeholder-text {
    font-size: 0.9rem;
    color: #6c757d;
    text-align: center;
  }
  
  .file-preview-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 150px;
    background: #fff5f5;
    border: 2px solid #fed7d7;
    border-radius: 8px;
    padding: 1rem;
  }
  
  .error-icon {
    font-size: 2rem;
    margin-bottom: 8px;
  }
  
  .error-text {
    font-size: 0.9rem;
    color: #e53e3e;
    margin-bottom: 8px;
    text-align: center;
  }
  
  .retry-preview-btn {
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .retry-preview-btn:hover {
    background: #0056b3;
  }
  
  .collection-actions {
    margin: 1rem 0;
    text-align: center;
  }
  
  .load-all-previews-btn {
    background: #28a745;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 12px 24px;
    font-size: 1rem;
    cursor: pointer;
    transition: background-color 0.2s;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  
  .load-all-previews-btn:hover {
    background: #218838;
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

// Inject styles into document head
if (typeof document !== 'undefined' && !document.getElementById('collection-preview-styles')) {
  const style = document.createElement('style');
  style.id = 'collection-preview-styles';
  style.textContent = loadingStyles;
  document.head.appendChild(style);
}

const CollectionPreview = () => {
  const { collectionId } = useParams();
  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  
  // Simplified media loading state - just track what should show previews
  const [showPreviews, setShowPreviews] = useState(new Set());
  
  const { 
    formatFileSize, 
    getFileType, 
    isMediaFile, 
    copyToClipboard 
  } = useFileManager();

  const { 
    user, 
    handleGoogleLogin, 
    handleLogout
  } = useAuth();

  useEffect(() => {
    fetchCollectionPreview();
  }, [collectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile detection effect
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
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  const fetchCollectionPreview = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Add timeout to prevent hanging requests
      const timeoutId = setTimeout(() => {
        setError('Request timed out. The server may be unresponsive.');
        setLoading(false);
      }, 15000); // 15 second timeout
      
      const response = await axios.get(`/api/collections/${collectionId}/preview`, {
        timeout: 12000 // 12 second axios timeout
      });
      
      clearTimeout(timeoutId);
      setCollection(response.data);
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        setError('Request timed out. The server may be experiencing issues.');
      } else if (err.response?.status === 404) {
        setError('Collection not found');
      } else if (err.response?.status === 401) {
        setError('This collection is private. Please log in to view it.');
      } else if (err.response?.status >= 500) {
        setError('Server error. Please try again later.');
      } else {
        setError('Failed to load collection. Please check your connection.');
      }
      console.error('Collection fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Simple function to enable preview for a file
  const enablePreview = useCallback((fileId) => {
    setShowPreviews(prev => new Set([...prev, fileId]));
  }, []);

  const renderFilePreview = (file) => {
    const showPreview = showPreviews.has(file.id);
    
    if (isMediaFile(file.filename)) {
      const fileType = getFileType(file.filename);
      
      // Show simple placeholder until user clicks to load
      if (!showPreview) {
        return (
          <div 
            className="file-preview-placeholder"
            onClick={() => enablePreview(file.id)}
          >
            <div className="placeholder-icon">
              <div className="file-type-icon">{fileType}</div>
            </div>
            <div className="placeholder-text">Click to preview</div>
          </div>
        );
      }
      
      // Render actual media when preview is enabled using MediaPlayer component
      return (
        <MediaPlayer
          fileId={file.id}
          originalName={file.originalName || file.originalFilename}
          getFileType={getFileType}
          isMobile={isMobile}
          onMediaClick={(e) => e.stopPropagation()}
        />
      );
    }
    
    // Non-media files (documents, etc)
    return (
      <div className="file-preview-icon">
        <div className="file-type-icon">{getFileType(file.filename)}</div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="collection-preview-container">
        <div className="loading-spinner">Loading collection...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="collection-preview-container">
        <div className="error-message">
          <svg className="error-icon" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>{error}</div>
          {(error.includes('timeout') || error.includes('Server error')) && (
            <button 
              className="retry-button"
              onClick={fetchCollectionPreview}
              style={{ 
                marginTop: '10px', 
                padding: '8px 16px', 
                backgroundColor: '#007bff', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px', 
                cursor: 'pointer' 
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`collection-preview-page ${isMobile ? 'mobile' : 'desktop'}`}>
      {/* User info in top right - outside header like main page */}
      {user && (
        <div className="user-info">
          <span>Welcome, {user?.name || user?.email || 'User'}</span>
          <button onClick={handleLogout} className="logout-button">
            Logout
          </button>
        </div>
      )}
      
      {!user && (
        <div className="user-info">
          <button onClick={handleGoogleLogin} className="login-button">
            Sign in with Google
          </button>
        </div>
      )}
      
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

      <div className="collection-preview-container">
        <div className="collection-preview-header">
        <h1 className="collection-title">{collection.name}</h1>
        {collection.description && (
          <p className="collection-description">{collection.description}</p>
        )}
        <div className="collection-meta">
          <span className={`collection-visibility ${collection.isPublic ? 'public' : 'private'}`}>
            {collection.isPublic ? 'Public' : 'Private'}
          </span>
          <span className="collection-file-count">{collection.files.length} files</span>
          <span className="collection-created">
            Created {new Date(collection.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="collection-actions">
          <button 
            className="load-all-previews-btn"
            onClick={() => {
              const mediaFileIds = collection.files
                .filter(file => isMediaFile(file.filename))
                .map(file => file.id);
              setShowPreviews(new Set(mediaFileIds));
            }}
          >
            Load All Previews ({collection.files.filter(file => isMediaFile(file.filename)).length} media files)
          </button>
        </div>
      </div>

      {collection.files.length === 0 ? (
        <div className="no-files-message">
          This collection is empty.
        </div>
      ) : (
        <div className="collection-files-grid">
          {collection.files.map((file) => (
            <div 
              key={file.id} 
              className="collection-file-card"
            >
              <div className={`file-preview-container ${showPreviews.has(file.id) && isMediaFile(file.filename) ? 'media-active' : ''}`}>
                {renderFilePreview(file)}
              </div>
              
              <div className="file-card-content">
                <div className="file-info">
                  <div className="file-name">{file.originalFilename}</div>
                  <div className="file-details">
                    <span className="file-size">{formatFileSize(file.size)}</span>
                    <span className="file-type">{getFileType(file.filename)}</span>
                    {file.isPrivate && (
                      <span className="file-visibility private">Private</span>
                    )}
                  </div>
                </div>
                
                <div className="file-actions">
                  <button
                    className="download-button"
                    onClick={() => window.open(file.downloadLink, '_blank')}
                  >
                    Download
                  </button>
                  <button
                    className="copy-link-button"
                    onClick={(e) => copyToClipboard(`${window.location.origin}${file.downloadLink}`, e.target)}
                    title="Copy download link"
                  >
                    📋
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
};

export default CollectionPreview;