import React from 'react';

const LoadingSpinner = ({ 
  size = 'medium', 
  text = 'Loading...', 
  overlay = false,
  className = '' 
}) => {
  const sizeClasses = {
    small: 'loading-spinner-small',
    medium: 'loading-spinner-medium',
    large: 'loading-spinner-large'
  };

  const spinnerClass = sizeClasses[size] || sizeClasses.medium;

  const content = (
    <div className={`loading-spinner-container ${className}`}>
      <div className={`loading-spinner ${spinnerClass}`}>
        <div className="spinner"></div>
      </div>
      {text && <div className="loading-text">{text}</div>}
    </div>
  );

  if (overlay) {
    return (
      <div className="loading-overlay">
        {content}
      </div>
    );
  }

  return content;
};

export default React.memo(LoadingSpinner);