import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import '../App.css';

const DirectUpload = () => {
  const { linkId } = useParams();
  const [linkInfo, setLinkInfo] = useState(null);
  const [password, setPassword] = useState('');
  const [isValidated, setIsValidated] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Validate link on component mount
  useEffect(() => {
    const validateLink = async () => {
      try {
        const response = await axios.post(`/api/direct-upload/${linkId}/validate`, {
          password: null
        }, {
          withCredentials: false // Don't send credentials for public endpoint
        });

        if (response.data.success && !response.data.requiresPassword) {
          setLinkInfo(response.data);
          setIsValidated(true);
        } else if (response.data.requiresPassword) {
          setLinkInfo(response.data);
        }
      } catch (error) {
        console.error('Validation error:', error.response || error);
        if (error.response?.status === 401 && error.response?.data?.requiresPassword) {
          // Password required - show password form
          setLinkInfo(error.response.data);
          setError('');
        } else {
          setError(error.response?.data?.error || 'Upload link not found or has been disabled');
        }
      }
    };

    validateLink();
  }, [linkId]);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await axios.post(`/api/direct-upload/${linkId}/validate`, {
        password
      }, {
        withCredentials: false // Don't send credentials for public endpoint
      });

      if (response.data.success) {
        setLinkInfo(response.data);
        setIsValidated(true);
      }
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to validate password');
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setSelectedFiles(files);
    setError('');
    setUploadResults([]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    setSelectedFiles(files);
    setError('');
    setUploadResults([]);
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one file');
      return;
    }

    setUploading(true);
    setError('');
    const results = [];

    for (const file of selectedFiles) {
      const formData = new FormData();
      formData.append('file', file);
      if (linkInfo.requiresPassword) {
        formData.append('password', password);
      }

      try {
        const response = await axios.post(`/api/direct-upload/${linkId}/upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          withCredentials: false // Don't send credentials for public endpoint
        });

        results.push({
          filename: file.name,
          success: true,
          message: response.data.message
        });
      } catch (error) {
        results.push({
          filename: file.name,
          success: false,
          message: error.response?.data?.error || 'Failed to upload file'
        });
      }
    }

    setUploadResults(results);
    setUploading(false);
    setSelectedFiles([]);

    // Reset file input
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Password prompt
  if (linkInfo && !isValidated) {
    return (
      <div className="app desktop">
        <div className="container">
          <header className="header">
            <div className="header-content">
              <h1 className="title">LeoShare<br />Direct Upload</h1>
            </div>
          </header>

          <div className="upload-card">
            <h2 style={{ marginBottom: '10px' }}>🔒 Password Required</h2>
            <p style={{ color: '#666', marginBottom: '20px' }}>
              This upload link is password protected. Please enter the password to continue.
            </p>

            {error && (
              <div className="error-message" style={{ marginBottom: '20px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '15px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  fontSize: '16px'
                }}
              />
              <button type="submit" className="upload-button" style={{ width: '100%' }}>
                Unlock Upload
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !linkInfo) {
    return (
      <div className="app desktop">
        <div className="container">
          <header className="header">
            <div className="header-content">
              <h1 className="title">LeoShare<br />Direct Upload</h1>
            </div>
          </header>

          <div className="upload-card">
            <h2 style={{ color: '#dc3545' }}>⚠️ Upload Link Not Available</h2>
            <p style={{ color: '#666', marginTop: '15px' }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (!linkInfo || !isValidated) {
    return (
      <div className="app desktop">
        <div className="container">
          <div className="loading">
            <div className="loading-spinner">
              <div className="spinner"></div>
            </div>
            <div className="loading-text">Validating upload link...</div>
          </div>
        </div>
      </div>
    );
  }

  // Main upload interface
  return (
    <div className="app desktop">
      <div className="container">
        <header className="header">
          <div className="header-content">
            <h1 className="title">LeoShare<br />Direct Upload</h1>
          </div>
        </header>

        <div className="upload-card">
          <h2 style={{ marginBottom: '10px' }}>📁 {linkInfo.folderName}</h2>
          <p style={{ color: '#666', marginBottom: '25px' }}>
            Upload your files to this secure folder. Your files will be stored safely.
          </p>

          {error && (
            <div className="error-message" style={{ marginBottom: '20px' }}>
              {error}
            </div>
          )}

          {uploadResults.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              {uploadResults.map((result, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px',
                    marginBottom: '10px',
                    borderRadius: '8px',
                    background: result.success ? '#d4edda' : '#f8d7da',
                    color: result.success ? '#155724' : '#721c24'
                  }}
                >
                  <strong>{result.success ? '✅' : '❌'} {result.filename}</strong>
                  <br />
                  <small>{result.message}</small>
                </div>
              ))}
            </div>
          )}

          <div
            className={`drop-zone ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input').click()}
            style={{
              border: isDragOver ? '3px dashed #667eea' : '3px dashed #ccc',
              borderRadius: '12px',
              padding: '40px',
              textAlign: 'center',
              cursor: 'pointer',
              marginBottom: '20px',
              background: isDragOver ? '#f0f4ff' : '#f8f9fa',
              transition: 'all 0.3s'
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '15px' }}>📤</div>
            <p style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>
              {isDragOver ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p style={{ color: '#666', marginBottom: '15px' }}>or click to browse</p>
            <input
              id="file-input"
              type="file"
              multiple
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          {selectedFiles.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ marginBottom: '10px', fontSize: '16px' }}>
                Selected Files ({selectedFiles.length})
              </h3>
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  style={{
                    padding: '10px',
                    background: '#f8f9fa',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span style={{ fontWeight: '500' }}>{file.name}</span>
                  <span style={{ color: '#666', fontSize: '14px' }}>
                    {formatFileSize(file.size)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={uploading || selectedFiles.length === 0}
            className="upload-button"
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '16px',
              fontWeight: '600'
            }}
          >
            {uploading
              ? 'Uploading...'
              : selectedFiles.length > 0
              ? `Upload ${selectedFiles.length} File${selectedFiles.length > 1 ? 's' : ''}`
              : 'Select Files to Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DirectUpload;
