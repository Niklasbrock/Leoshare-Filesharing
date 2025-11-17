import React, { useState, useCallback } from 'react';

const MediaPlayer = ({ 
  fileId, 
  originalName, 
  getFileType, 
  isMobile,
  onMediaClick 
}) => {
  const [mediaLoadingStates, setMediaLoadingStates] = useState(new Map());
  const [mediaErrorStates, setMediaErrorStates] = useState(new Map());

  const handleMediaLoadStart = useCallback((fileId) => {
    setMediaLoadingStates(prev => new Map(prev.set(fileId, true)));
    setMediaErrorStates(prev => new Map(prev.set(fileId, false)));
  }, []);

  const handleMediaCanPlay = useCallback((fileId) => {
    setMediaLoadingStates(prev => new Map(prev.set(fileId, false)));
  }, []);

  const handleMediaError = useCallback((fileId, error) => {
    console.error(`Media error for file ${fileId}:`, error);
    setMediaLoadingStates(prev => new Map(prev.set(fileId, false)));
    setMediaErrorStates(prev => new Map(prev.set(fileId, true)));
  }, []);

  const toggleFullscreen = useCallback((element) => {
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
  }, []);

  const renderLoadingState = () => (
    <div className="media-loading">
      <div className="spinner"></div>
      <span>Loading {getFileType(originalName)}...</span>
    </div>
  );

  const renderErrorState = () => (
    <div className="media-error">
      <svg fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      <span>Failed to load {getFileType(originalName)}</span>
    </div>
  );

  const renderFullscreenButton = () => (
    !isMobile && (
      <button 
        className="fullscreen-button"
        onClick={(e) => toggleFullscreen(e.target)}
        title="Toggle fullscreen"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
        </svg>
      </button>
    )
  );

  const fileType = getFileType(originalName);

  if (fileType === 'image') {
    return (
      <div className="media-player">
        <div className="image-container">
          {!!mediaLoadingStates.get(fileId) && renderLoadingState()}
          {!!mediaErrorStates.get(fileId) && renderErrorState()}
          <img 
            src={`/api/stream/${fileId}`} 
            alt={originalName}
            className="preview-image"
            onClick={(e) => {toggleFullscreen(e.target); onMediaClick && onMediaClick(e);}}
            onLoadStart={() => handleMediaLoadStart(fileId)}
            onLoad={() => handleMediaCanPlay(fileId)}
            onError={(e) => handleMediaError(fileId, e)}
          />
          {renderFullscreenButton()}
        </div>
      </div>
    );
  }

  if (fileType === 'video') {
    return (
      <div className="media-player">
        <div className="video-container">
          {!!mediaLoadingStates.get(fileId) && renderLoadingState()}
          {!!mediaErrorStates.get(fileId) && renderErrorState()}
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
            onClick={onMediaClick}
            onLoadStart={() => handleMediaLoadStart(fileId)}
            onCanPlay={() => handleMediaCanPlay(fileId)}
            onError={(e) => handleMediaError(fileId, e)}
          >
            <source src={`/api/stream/${fileId}`} type="video/mp4" />
            <p>Your browser doesn't support this video format. 
              <a href={`/api/download/${fileId}`}>Download the video</a> to play it locally.
            </p>
          </video>
          {renderFullscreenButton()}
        </div>
      </div>
    );
  }

  if (fileType === 'audio') {
    return (
      <div className="media-player">
        <div className="audio-container">
          {!!mediaLoadingStates.get(fileId) && renderLoadingState()}
          {!!mediaErrorStates.get(fileId) && renderErrorState()}
          <audio 
            src={`/api/stream/${fileId}`}
            controls
            preload="metadata"
            crossOrigin="anonymous"
            className="preview-audio"
            onClick={onMediaClick}
            onLoadStart={() => handleMediaLoadStart(fileId)}
            onCanPlay={() => handleMediaCanPlay(fileId)}
            onError={(e) => handleMediaError(fileId, e)}
          />
        </div>
      </div>
    );
  }

  return null;
};

export default React.memo(MediaPlayer);