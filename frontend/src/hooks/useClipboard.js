import { useCallback } from 'react';

export const useClipboard = () => {
  const copyToClipboard = useCallback(async (text, button) => {
    // Prevent page scrolling by stopping propagation
    if (button && button.closest) {
      const event = window.event;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    const showSuccess = (btn) => {
      const originalText = btn.getAttribute('data-original-text') || btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.style.background = 'rgba(34, 197, 94, 0.2)';
      btn.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      btn.style.color = '#86efac';
      
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = 'rgba(100, 255, 218, 0.1)';
        btn.style.borderColor = 'rgba(100, 255, 218, 0.3)';
        btn.style.color = '#64ffda';
      }, 2000);
    };

    try {
      // Check if we're in a secure context and clipboard API is available
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        if (button) showSuccess(button);
        return;
      }
      
      // Fallback method using textarea
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        if (button) showSuccess(button);
      } else {
        throw new Error('Copy command failed');
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      
      // Last resort: show the text in a prompt
      const userAgent = navigator.userAgent.toLowerCase();
      if (userAgent.includes('mobile') || userAgent.includes('android') || userAgent.includes('iphone')) {
        // On mobile, show an alert with the text
        alert(`Copy this link:\n${text}`);
      } else {
        // On desktop, try to select the text for manual copying
        const div = document.createElement('div');
        div.style.position = 'fixed';
        div.style.top = '50%';
        div.style.left = '50%';
        div.style.transform = 'translate(-50%, -50%)';
        div.style.background = '#1e293b';
        div.style.color = '#e2e8f0';
        div.style.padding = '1rem';
        div.style.borderRadius = '8px';
        div.style.border = '1px solid #64ffda';
        div.style.zIndex = '10000';
        // Create elements safely without innerHTML to prevent XSS
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Please copy this link manually:';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = text; // Safe assignment, not HTML injection
        input.style.cssText = 'width: 100%; padding: 0.5rem; margin: 0.5rem 0; background: #0f172a; color: #e2e8f0; border: 1px solid #64ffda; border-radius: 4px;';
        input.readOnly = true;
        
        const closeButton = document.createElement('button');
        closeButton.textContent = 'Close';
        closeButton.style.cssText = 'background: #ef4444; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;';
        closeButton.onclick = () => div.remove();
        
        div.appendChild(paragraph);
        div.appendChild(input);
        div.appendChild(closeButton);
        document.body.appendChild(div);
        
        // Auto-select the input text
        input.focus();
        input.select();
        
        // Remove after 10 seconds
        setTimeout(() => {
          if (div.parentElement) {
            div.remove();
          }
        }, 10000);
      }
    }
  }, []);

  return { copyToClipboard };
};