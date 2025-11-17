const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

class EmailQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.retryAttempts = 3;
    this.retryDelay = 5000; // 5 seconds
    this.maxRetryDelay = 300000; // 5 minutes
    this.maxConcurrentEmails = 3; // Process up to 3 emails simultaneously
    this.activeProcesses = new Set(); // Track active email processes
    this.queueFile = path.join(__dirname, 'email-queue.json');
    
    // Load persisted queue on startup
    this.loadQueue();
    
    // Start processing queue
    this.startQueueProcessor();
    
    console.log('📧 Email queue initialized');
  }

  // Load queue from disk (for persistence across restarts)
  loadQueue() {
    try {
      if (fs.existsSync(this.queueFile)) {
        const data = fs.readFileSync(this.queueFile, 'utf8');
        this.queue = JSON.parse(data);
        console.log(`📥 Loaded ${this.queue.length} emails from persistent queue`);
      }
    } catch (error) {
      console.warn('⚠️  Could not load email queue from disk:', error.message);
      this.queue = [];
    }
  }

  // Save queue to disk
  saveQueue() {
    try {
      fs.writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
    } catch (error) {
      console.error('❌ Could not save email queue to disk:', error.message);
    }
  }

  // Add email to queue
  enqueue(emailData) {
    const emailItem = {
      id: this.generateId(),
      ...emailData,
      attempts: 0,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    this.queue.push(emailItem);
    this.saveQueue();
    
    console.log(`📧 Email queued: ${emailItem.type} to ${emailItem.to} (ID: ${emailItem.id})`);
    
    // Process immediately if not already processing
    if (!this.processing) {
      this.processQueue();
    }

    return emailItem.id;
  }

  // Generate unique ID for email items
  generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  // Start the queue processor
  startQueueProcessor() {
    // Process queue every 30 seconds
    setInterval(() => {
      if (!this.processing && this.queue.length > 0) {
        this.processQueue();
      }
    }, 30000);
  }

  // Process the email queue with parallel processing
  async processQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    
    try {
      // Process emails in parallel batches
      while (this.queue.length > 0 && this.activeProcesses.size < this.maxConcurrentEmails) {
        const availableSlots = this.maxConcurrentEmails - this.activeProcesses.size;
        const emailsToProcess = this.queue.splice(0, Math.min(availableSlots, this.queue.length));
        
        if (emailsToProcess.length === 0) {
          break;
        }
        
        console.log(`📬 Processing ${emailsToProcess.length} emails concurrently (${this.queue.length} remaining in queue)`);
        
        // Process emails in parallel
        const processingPromises = emailsToProcess.map(emailItem => this.processSingleEmail(emailItem));
        
        // Wait for current batch to complete before processing next batch
        await Promise.allSettled(processingPromises);
        
        // Small delay between batches to avoid overwhelming SMTP server
        if (this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
    } finally {
      this.processing = false;
    }

    if (this.queue.length === 0 && this.activeProcesses.size === 0) {
      console.log('📭 Email queue is empty');
    }
  }

  // Process a single email with retry logic
  async processSingleEmail(emailItem) {
    const processId = `${emailItem.id}-${Date.now()}`;
    this.activeProcesses.add(processId);
    
    try {
      await this.sendEmail(emailItem);
      
      console.log(`✅ Email sent successfully: ${emailItem.type} to ${emailItem.to}`);
      this.saveQueue();
      
    } catch (error) {
      console.error(`❌ Email failed: ${emailItem.type} to ${emailItem.to}:`, error.message);
      
      emailItem.attempts++;
      emailItem.lastError = error.message;
      emailItem.lastAttempt = new Date().toISOString();

      if (emailItem.attempts >= this.retryAttempts) {
        // Max retries reached, move to failed
        console.error(`💀 Email permanently failed after ${this.retryAttempts} attempts: ${emailItem.id}`);
        emailItem.status = 'failed';
        this.saveFailedEmail(emailItem);
        
      } else {
        // Schedule retry with exponential backoff
        emailItem.status = 'retrying';
        const delay = Math.min(this.retryDelay * Math.pow(2, emailItem.attempts - 1), this.maxRetryDelay);
        
        console.log(`🔄 Retrying email in ${delay/1000}s (attempt ${emailItem.attempts}/${this.retryAttempts})`);
        
        // Add back to queue after delay
        setTimeout(() => {
          emailItem.status = 'pending';
          this.queue.push(emailItem);
          this.saveQueue();
          
          // Trigger processing if not already running
          if (!this.processing) {
            this.processQueue();
          }
        }, delay);
      }
      
      this.saveQueue();
    } finally {
      this.activeProcesses.delete(processId);
    }
  }

  // Save failed emails for debugging
  saveFailedEmail(emailItem) {
    try {
      const failedDir = path.join(__dirname, 'failed-emails');
      if (!fs.existsSync(failedDir)) {
        fs.mkdirSync(failedDir);
      }
      
      const failedFile = path.join(failedDir, `failed-${emailItem.id}.json`);
      fs.writeFileSync(failedFile, JSON.stringify(emailItem, null, 2));
      
    } catch (error) {
      console.error('Could not save failed email:', error.message);
    }
  }

  // Send individual email
  async sendEmail(emailItem) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error('SMTP configuration not available');
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      // Add timeout settings to prevent hanging
      connectionTimeout: 30000, // 30 seconds
      greetingTimeout: 30000,   // 30 seconds
      socketTimeout: 30000      // 30 seconds
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: emailItem.to,
      subject: emailItem.subject,
      html: emailItem.html
    };

    // Wrap in timeout promise to prevent indefinite hanging
    const emailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Email sending timed out after 60 seconds')), 60000);
    });

    const result = await Promise.race([emailPromise, timeoutPromise]);
    return result;
  }

  // Get queue status
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      activeProcesses: this.activeProcesses.size,
      maxConcurrentEmails: this.maxConcurrentEmails,
      pendingEmails: this.queue.filter(item => item.status === 'pending').length,
      retryingEmails: this.queue.filter(item => item.status === 'retrying').length
    };
  }

  // Clear the queue (admin function)
  clearQueue() {
    this.queue = [];
    this.saveQueue();
    console.log('🗑️ Email queue cleared');
  }
}

module.exports = EmailQueue;