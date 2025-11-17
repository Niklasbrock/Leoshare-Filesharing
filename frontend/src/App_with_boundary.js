import React from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App';

function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;