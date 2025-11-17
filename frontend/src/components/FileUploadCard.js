import React from 'react';

const FileUploadCard = ({
  selectedFiles,
  isPrivate,
  retentionTime,
  uploading,
  uploadProgress,
  uploadResults,
  error,
  isDragOver,
  onFileChange,
  onIsPrivateChange,
  onRetentionTimeChange,
  onUpload,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  formatFileSize,
  copyToClipboard
}) => {
  // The drag handlers are now passed directly from the hook
  // No need for wrapper functions since they already handle preventDefault and stopPropagation

  return (
    <div 
      className={`upload-card ${isDragOver ? 'drag-over' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="upload-section">
        <div className="file-input-wrapper">
          <input
            id="file-input"
            type="file"
            onChange={onFileChange}
            className="file-input"
            multiple
          />
          <label htmlFor="file-input" className="file-input-label">
            <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {selectedFiles.length > 0 ? 
              (selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} files selected`) 
              : 'Choose Files'}
          </label>
        </div>

        <div className="controls-row">
          <label className="checkbox-wrapper">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => onIsPrivateChange(e.target.checked)}
              className="checkbox-input"
            />
            <span className="checkbox-label">Private (approved users only)</span>
          </label>
          
          <div className="retention-wrapper">
            <label htmlFor="retention-select" className="retention-label">Expire in:</label>
            <select
              id="retention-select"
              value={retentionTime}
              onChange={(e) => onRetentionTimeChange(e.target.value)}
              className="retention-select"
            >
              <option value="1hour">1 Hour</option>
              <option value="5hours">5 Hours</option>
              <option value="12hours">12 Hours</option>
              <option value="24hours">24 Hours</option>
              <option value="permanent">Permanent</option>
            </select>
          </div>
        </div>

        <button
          onClick={onUpload}
          disabled={uploading || selectedFiles.length === 0}
          className="upload-button"
        >
          {uploading ? (
            <>
              <div className="spinner"></div>
              Uploading... {uploadProgress}%
            </>
          ) : (
            selectedFiles.length > 1 ? `Upload ${selectedFiles.length} Files` : 'Upload File'
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

      {uploadResults && uploadResults.length > 0 && (
        <div className="success-section">
          <div className="success-message">
            <svg className="success-icon" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {uploadResults.length === 1 ? 'File uploaded successfully!' : `${uploadResults.length} files processed!`}
          </div>

          {uploadResults.map((result, index) => (
            <div key={index} className={`file-result ${result.success ? 'success' : 'error'}`}>
              {!result.success ? (
                <div className="error-result">
                  <div className="error-header">
                    <svg className="error-icon" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Failed: {result.originalFileName}
                  </div>
                  <div className="error-message">{result.error}</div>
                </div>
              ) : (
                <>
                  <div className="file-info">
                    <div className="info-row">
                      <span className="info-label">File:</span>
                      <span className="info-value">{result.filename}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Size:</span>
                      <span className="info-value">{formatFileSize(result.size)}</span>
                    </div>
                    {result.expiryTime && (
                      <div className="info-row">
                        <span className="info-label">Expires:</span>
                        <span className="info-value">
                          {result.expiryTime ? new Date(result.expiryTime).toLocaleString() : 'No expiry'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="download-link-section">
                    <label className="download-label">Download Link:</label>
                    <div className="link-wrapper">
                      <input
                        type="text"
                        value={result.downloadLink}
                        readOnly
                        className="download-link-input"
                      />
                      <button
                        onClick={(e) => copyToClipboard(result.downloadLink, e.target)}
                        className="copy-button"
                        title="Copy to clipboard"
                      >
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        
                        </svg>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(FileUploadCard);