const express = require('express');
const multer = require('multer');
const cors = require('cors');
// const compression = require('compression'); // Install with: npm install compression
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const rateLimit = require('express-rate-limit');
// const readline = require('readline'); // No longer needed with email approval
const DatabaseFactory = require('./databaseFactory');
const EmailQueue = require('./emailQueue');
const EnvironmentValidator = require('./environmentValidator');
require('dotenv').config();

// Global error handlers to prevent overnight hangs
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Promise Rejection at:', promise, 'reason:', reason);
  console.error('Stack trace:', reason?.stack || 'No stack trace available');
  // Log but don't exit - keep server running
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
  // Exit gracefully on uncaught exceptions
  setTimeout(() => {
    console.error('🔥 Server shutting down due to uncaught exception');
    process.exit(1);
  }, 1000);
});

// Rate limiting removed - no throttling

// Validate environment variables before starting
const envValidator = new EnvironmentValidator();
const envValid = envValidator.validate();

if (!envValid.critical) {
  console.error('\n🚨 CRITICAL ENVIRONMENT ISSUES DETECTED!');
  console.error('Cannot start server. Please fix the issues above and restart.');
  process.exit(1);
}

// Generate example .env file for reference
envValidator.generateExampleEnv();

const app = express();
const PORT = process.env.PORT || 3001;

// Connection limiting and performance optimizations
// Note: Install compression package with: npm install compression
// app.use(compression()); // Enable gzip compression (commented until package is installed)

// Simple connection limiting middleware
let activeConnections = 0;
const MAX_CONNECTIONS = 100; // Reasonable limit for concurrent connections

app.use((req, res, next) => {
  if (activeConnections >= MAX_CONNECTIONS) {
    res.status(503).json({ error: 'Server too busy, please try again later' });
    return;
  }
  
  activeConnections++;
  
  const cleanup = () => {
    activeConnections--;
  };
  
  res.on('finish', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
  
  next();
});

// Google OAuth setup
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `https://leoshare.dk/auth/google/callback`
);

// In-memory storage for pending requests and whitelist with memory limits
const pendingRequests = new Map();
const whitelist = new Set();

// Memory management constants
const MAX_PENDING_REQUESTS = 1000;
const MAX_FILE_METADATA = 10000;

// Helper function to send OAuth result (popup or redirect)
const sendOAuthResult = (res, status, req) => {
  const isMobile = req.query.mobile === 'true';
  const isFallback = req.query.fallback === 'true';
  
  // Use redirect for mobile or fallback cases
  if (isMobile || isFallback) {
    // Determine the correct frontend URL based on the request origin
    let frontendUrl = process.env.FRONTEND_URL || 'https://leoshare.dk';
    
    // If request came from www subdomain, redirect to www subdomain
    const referer = req.headers.referer || req.headers.origin;
    if (referer && referer.includes('www.leoshare.dk')) {
      frontendUrl = 'https://www.leoshare.dk';
    } else if (referer && referer.includes('leoshare.dk')) {
      frontendUrl = 'https://leoshare.dk';
    }
    
    return res.redirect(`${frontendUrl}?login=${status}`);
  }
  
  // Use popup communication for desktop
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Result</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          color: #e2e8f0;
        }
        .message {
          text-align: center;
          padding: 2rem;
        }
        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid rgba(100, 255, 218, 0.3);
          border-top: 4px solid #64ffda;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 1rem;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="message">
        <div class="spinner"></div>
        <p>Processing authentication result...</p>
      </div>
      <script>
        // Store result in localStorage as backup method
        try {
          localStorage.setItem('oauth_result', JSON.stringify({
            status: '${status}',
            timestamp: Date.now()
          }));
        } catch (e) {
          // Silently handle localStorage errors
        }
        
        if (window.opener) {
          // Try posting to multiple possible origins to handle www/non-www domains
          const possibleOrigins = [
            'https://leoshare.dk',
            'https://www.leoshare.dk',
            'http://localhost:3000',
            'http://localhost:3001'
          ];
          
          const message = {
            type: 'OAUTH_RESULT',
            status: '${status}',
            timestamp: Date.now()
          };
          
          // Post to all possible origins - the correct one will receive it
          possibleOrigins.forEach(origin => {
            try {
              window.opener.postMessage(message, origin);
            } catch (e) {
              // Ignore errors for incorrect origins
            }
          });
          
          // Also try wildcard as fallback (less secure but works)
          try {
            window.opener.postMessage(message, '*');
          } catch (e) {
            // Ignore wildcard errors
          }
          
          // Give a small delay to ensure message is sent
          setTimeout(() => {
            window.close();
          }, 100);
        } else {
          document.body.innerHTML = '<div class="message"><p>Authentication complete. You can close this window.</p></div>';
          // Still auto-close even without opener
          setTimeout(() => {
            window.close();
          }, 2000);
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
};

// Initialize database (JSON by default, SQLite if DATABASE_TYPE=sqlite)
const db = DatabaseFactory.create();
const emailQueue = new EmailQueue();

// Whitelist persistence
const whitelistPath = path.join(__dirname, 'whitelist.json');

// Load whitelist from file on startup
const loadWhitelist = () => {
  try {
    if (fs.existsSync(whitelistPath)) {
      const data = fs.readFileSync(whitelistPath, 'utf8');
      const emails = JSON.parse(data);
      emails.forEach(email => whitelist.add(email));
      console.log(`📋 Loaded ${emails.length} approved emails from whitelist`);
    } else {
      console.log('📋 No existing whitelist found, starting fresh');
    }
  } catch (error) {
    console.error('❌ Error loading whitelist:', error);
  }
};

// Save whitelist to file
const saveWhitelist = () => {
  try {
    const emails = Array.from(whitelist);
    fs.writeFileSync(whitelistPath, JSON.stringify(emails, null, 2));
    console.log(`💾 Saved ${emails.length} emails to whitelist`);
  } catch (error) {
    console.error('❌ Error saving whitelist:', error);
  }
};

// Load whitelist on startup
loadWhitelist();

// Note: Console input system replaced with email approval system

// Email approval system (now using queue)
const sendApprovalRequestEmail = async (email, name, requestId, userIP) => {
  console.log('📧 Queuing approval request email...');
  
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('❌ SMTP configuration not available - cannot queue approval request');
    console.error('   Make sure SMTP_HOST, SMTP_USER, and SMTP_PASS are set in environment');
    return false;
  }
  
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  const approveUrl = `${baseUrl}/api/admin/approve/${requestId}`;
  const declineUrl = `${baseUrl}/api/admin/decline/${requestId}`;
  
  const emailData = {
    type: 'approval_request',
    to: process.env.ADMIN_EMAIL || process.env.SMTP_USER || (() => {
      console.error('🚨 ADMIN_EMAIL environment variable not configured!');
      throw new Error('Admin email configuration required');
    })(),
    subject: '🔐 File Sharing Access Request',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333; text-align: center;">🔐 New Access Request</h2>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #495057;">User Details:</h3>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>IP Address:</strong> ${userIP}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <p style="margin-bottom: 20px;">Click one of the buttons below to approve or decline this request:</p>
          
          <a href="${approveUrl}" 
             style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 0 10px; display: inline-block; font-weight: bold;">
            ✅ APPROVE
          </a>
          
          <a href="${declineUrl}" 
             style="background: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 0 10px; display: inline-block; font-weight: bold;">
            ❌ DECLINE
          </a>
        </div>
        
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #856404;">
            <strong>⚠️ Security Note:</strong> Only approve users you trust. This will give them access to upload and download files on your platform.
          </p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">
          This is an automated message from LeoShare File Sharing Platform<br>
          Request ID: ${requestId}
        </p>
      </div>
    `,
    metadata: {
      requestId,
      userEmail: email,
      userName: name,
      userIP
    }
  };
  
  try {
    const emailId = emailQueue.enqueue(emailData);
    console.log(`✅ Approval request email queued successfully (ID: ${emailId})`);
    return true;
  } catch (error) {
    console.error('❌ Error queuing approval request email:', error.message);
    return false;
  }
};

// Rate limiting configurations for security
const oauthRateLimit = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 15, // Limit each IP to 15 OAuth requests per windowMs
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for local network IPs (safe for home networks)
    const clientIP = req.ip || req.connection.remoteAddress;
    const allowedAdminIPs = (process.env.ADMIN_IPS || '127.0.0.1,::1').split(',').map(ip => ip.trim());
    return allowedAdminIPs.includes(clientIP) || isPrivateIP(clientIP);
  }
});

const adminRateLimit = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 10, // Limit each IP to 10 admin requests per windowMs (stricter than OAuth)
  message: { error: 'Too many admin requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for local network IPs (safe for home networks)
    const clientIP = req.ip || req.connection.remoteAddress;
    const allowedAdminIPs = (process.env.ADMIN_IPS || '127.0.0.1,::1').split(',').map(ip => ip.trim());
    return allowedAdminIPs.includes(clientIP) || isPrivateIP(clientIP);
  }
});

// Function to check if an IP is in a private/local network range
const isPrivateIP = (ip) => {
  // Remove IPv6 prefix if present (::ffff:192.168.1.1 -> 192.168.1.1)
  const cleanIP = ip.replace(/^::ffff:/, '');
  
  // Localhost IPs
  if (cleanIP === '127.0.0.1' || cleanIP === '::1' || cleanIP === 'localhost') {
    return true;
  }
  
  // Private IPv4 ranges (RFC 1918)
  const ipv4Patterns = [
    /^10\./,                    // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
    /^192\.168\./               // 192.168.0.0/16
  ];
  
  // Link-local ranges
  const linkLocalPatterns = [
    /^169\.254\./,              // IPv4 link-local (169.254.0.0/16)
    /^fe80::/i                  // IPv6 link-local
  ];
  
  // Check all patterns
  return [...ipv4Patterns, ...linkLocalPatterns].some(pattern => pattern.test(cleanIP));
};

// IP restriction middleware for admin endpoints
const restrictToServerIP = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const allowedIPs = (process.env.ADMIN_IPS || '127.0.0.1,::1').split(',').map(ip => ip.trim());
  
  console.log(`🔍 Admin access attempt from IP: ${clientIP}`);
  
  // Check explicit allowed IPs first
  if (allowedIPs.includes(clientIP)) {
    console.log(`✅ Admin access granted to explicit IP: ${clientIP}`);
    next();
    return;
  }
  
  // Check if IP is in private/local network range (safe for home networks)
  if (isPrivateIP(clientIP)) {
    console.log(`✅ Admin access granted to local network IP: ${clientIP}`);
    next();
    return;
  }
  
  console.log(`🚫 Admin access denied from public IP: ${clientIP}`);
  res.status(403).json({ error: 'Access denied - admin endpoints only accessible from local network' });
};

// Middleware - Allow both www and non-www domains
const allowedOrigins = [
  'https://leoshare.dk',
  'https://www.leoshare.dk',
  'http://localhost:3000', // For development
  'http://localhost:3001'  // For development
];

// Add custom origins from environment
if (process.env.CORS_ORIGIN) {
  allowedOrigins.push(...process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()));
}
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    console.log(`🚫 [SECURITY] CORS blocked origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Dedicated OG image endpoint for social media scrapers (Facebook, Twitter, etc.)
// Must be BEFORE session middleware to avoid cookie/CORS issues with bots
app.get('/api/og-image/:fileId', async (req, res) => {
  const { fileId } = req.params;

  try {
    // Validate fileId format (UUID v4)
    if (!fileId || !/^[a-f0-9\-]{36}$/i.test(fileId)) {
      return res.status(404).send('File not found');
    }

    // Fetch file metadata from database
    const fileData = await db.getUploadById(fileId);

    // Check if file exists
    if (!fileData) {
      return res.status(404).send('File not found');
    }

    // CRITICAL: Only serve PUBLIC files through this endpoint
    if (fileData.isPrivate) {
      return res.status(404).send('File not found');
    }

    // Check if file has expired
    if (fileData.expiryTime && new Date() > new Date(fileData.expiryTime)) {
      return res.status(404).send('File not found');
    }

    // Get file path
    const filePath = path.join(__dirname, process.env.UPLOAD_PATH || './uploads', fileData.filename);

    // Check if file exists on disk
    if (!fs.existsSync(filePath)) {
      console.error(`File not found on disk: ${filePath}`);
      return res.status(404).send('File not found');
    }

    // Determine MIME type
    const mimeType = getMimeTypeFromFilename(fileData.originalName);

    // Set headers for social media scrapers
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year cache
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins for OG images
    res.setHeader('Accept-Ranges', 'bytes');

    // Get file stats for Content-Length
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', stat.size);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    // Handle stream errors
    fileStream.on('error', (error) => {
      console.error('Error streaming OG image:', error);
      if (!res.headersSent) {
        res.status(500).send('Error streaming file');
      }
    });

  } catch (error) {
    console.error('Error serving OG image:', error);
    return res.status(500).send('Internal server error');
  }
});

// HEAD request handler for OG images (Facebook checks with HEAD first)
app.head('/api/og-image/:fileId', async (req, res) => {
  const { fileId } = req.params;

  try {
    // Validate fileId format
    if (!fileId || !/^[a-f0-9\-]{36}$/i.test(fileId)) {
      return res.status(404).end();
    }

    // Fetch file metadata
    const fileData = await db.getUploadById(fileId);

    // Check if file exists, is public, and not expired
    if (!fileData || fileData.isPrivate || (fileData.expiryTime && new Date() > new Date(fileData.expiryTime))) {
      return res.status(404).end();
    }

    // Get file path and check existence
    const filePath = path.join(__dirname, process.env.UPLOAD_PATH || './uploads', fileData.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).end();
    }

    // Get file stats
    const stat = fs.statSync(filePath);
    const mimeType = getMimeTypeFromFilename(fileData.originalName);

    // Set headers (same as GET)
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');

    // Send 200 with headers but no body
    res.status(200).end();

  } catch (error) {
    console.error('Error handling HEAD request for OG image:', error);
    return res.status(500).end();
  }
});

app.use(session({
  secret: process.env.SESSION_SECRET || (() => {
    const crypto = require('crypto');
    const randomSecret = crypto.randomBytes(64).toString('hex');
    console.warn('⚠️  WARNING: Using generated random session secret. Set SESSION_SECRET environment variable in production for consistency across restarts!');
    console.warn(`   Generated secret: ${randomSecret.substring(0, 16)}... (truncated for security)`);
    return randomSecret;
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict' // CSRF protection
  },
  name: 'sessionId' // Hide default session name
}));

// IP blocking system for unauthenticated requests
const ipRequestTracker = new Map(); // Track requests per IP
const blockedIPs = new Map(); // Track blocked IPs with expiry

const unauthenticatedIPBlocking = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const currentTime = Date.now();
  
  // Skip blocking for private IPs (local network)
  if (isPrivateIP(clientIP)) {
    return next();
  }
  
  // Skip tracking for direct upload routes (legitimate public upload links)
  if (req.path.startsWith('/direct-upload/') || req.path.startsWith('/api/direct-upload/')) {
    return next();
  }

  // ONLY track potentially abusive API endpoints that could be used maliciously
  // Includes auth flows and public endpoints that can be enumerated/abused
  const apiEndpointsToTrack = [
    '/api/upload',
    '/api/my-files',
    '/api/collections',
    '/api/download/',
    '/api/info/',
    '/api/admin/',
    '/api/subscribe/',
    // SECURITY: Authentication endpoints vulnerable to OAuth abuse
    '/auth/google',
    '/auth/cleanup-session',
    '/api/auth/status',
    '/api/auth/logout',
    // SECURITY: Public endpoints vulnerable to enumeration attacks
    '/preview/',
    '/api/health'
  ];
  
  // Only track specific API endpoints that could be abused
  const shouldTrack = apiEndpointsToTrack.some(endpoint => req.path.startsWith(endpoint));
  
  // Special handling for OAuth callback - allow legitimate flows but track suspicious activity
  if (req.path === '/auth/google/callback') {
    // Track OAuth callbacks but with higher threshold since they're part of legitimate auth
    if (!ipRequestTracker.has(clientIP + '_oauth')) {
      ipRequestTracker.set(clientIP + '_oauth', []);
    }
    const oauthRequests = ipRequestTracker.get(clientIP + '_oauth');
    const oneHourAgo = currentTime - (60 * 60 * 1000);
    const recentOAuthRequests = oauthRequests.filter(timestamp => timestamp > oneHourAgo);
    
    // Allow up to 5 OAuth callbacks per hour (legitimate users shouldn't need more)
    if (recentOAuthRequests.length >= 5) {
      console.log(`🚨 [SECURITY] IP ${clientIP} blocked - excessive OAuth callbacks: ${recentOAuthRequests.length}/5 per hour`);
      return res.status(429).json({ 
        error: 'Too many authentication attempts',
        reason: 'Excessive OAuth callback requests'
      });
    }
    
    recentOAuthRequests.push(currentTime);
    ipRequestTracker.set(clientIP + '_oauth', recentOAuthRequests);
    return next();
  }
  
  // Detect WordPress/bot scanning attempts (vulnerability probes)
  const botScanPatterns = [
    /\/wp-/i,                    // WordPress paths
    /\/xmlrpc\.php/i,            // WordPress XML-RPC
    /\/feed\//i,                 // RSS feeds
    /\/admin/i,                  // Admin panels
    /\/phpmyadmin/i,             // phpMyAdmin
    /\/wp-content/i,             // WordPress content
    /\/wp-includes/i,            // WordPress includes
    /\/wp-admin/i,               // WordPress admin
    /\/wordpress/i,              // WordPress directory
    /\.php$/i,                   // PHP files (when not expected)
    /\/cgi-bin/i,                // CGI scripts
    /\/\.env$/i,                 // Environment files
    /\/config/i,                 // Config files
    /\/backup/i,                 // Backup directories
    /\/drupal/i,                 // Drupal CMS
    /\/joomla/i,                 // Joomla CMS
    /\/magento/i                 // Magento CMS
  ];
  
  const isBotScan = botScanPatterns.some(pattern => pattern.test(req.path));
  
  // Track bot scanning attempts separately with lower threshold
  if (isBotScan) {
    if (!ipRequestTracker.has(clientIP + '_bot')) {
      ipRequestTracker.set(clientIP + '_bot', []);
    }
    const botRequests = ipRequestTracker.get(clientIP + '_bot');
    const fiveMinutesAgo = currentTime - (5 * 60 * 1000); // 5 minutes
    const recentBotRequests = botRequests.filter(timestamp => timestamp > fiveMinutesAgo);
    
    // Block after just 3 bot scan attempts in 5 minutes
    if (recentBotRequests.length >= 3) {
      const twoHoursFromNow = currentTime + (2 * 60 * 60 * 1000); // 2 hours
      blockedIPs.set(clientIP, { 
        expiresAt: twoHoursFromNow,
        blockedAt: currentTime,
        requestCount: recentBotRequests.length,
        reason: 'WordPress/CMS vulnerability scanning'
      });
      
      ipRequestTracker.delete(clientIP + '_bot');
      
      console.log(`🤖 [SECURITY] IP ${clientIP} blocked for 2 hours - WordPress/bot scanning: ${recentBotRequests.length} attempts in 5 minutes`);
      console.log(`🤖 [SECURITY] Scan pattern detected: ${req.path}`);
      return res.status(429).json({ 
        error: 'IP blocked for suspicious scanning activity',
        blockedUntil: new Date(twoHoursFromNow).toISOString(),
        reason: 'WordPress/CMS vulnerability scanning detected'
      });
    }
    
    recentBotRequests.push(currentTime);
    ipRequestTracker.set(clientIP + '_bot', recentBotRequests);
    
    console.log(`🤖 [SECURITY] Bot scan detected from ${clientIP}: ${req.path} - ${recentBotRequests.length}/3 in last 5 minutes`);
    
    // Return 404 for bot scans to not reveal server info
    return res.status(404).end();
  }
  
  // Always allow static assets and UI navigation
  if (!shouldTrack) {
    return next();
  }
  
  // Check if IP is currently blocked
  if (blockedIPs.has(clientIP)) {
    const blockInfo = blockedIPs.get(clientIP);
    if (currentTime < blockInfo.expiresAt) {
      const remainingTime = Math.ceil((blockInfo.expiresAt - currentTime) / 1000 / 60);
      console.log(`🚫 [SECURITY] Blocked IP ${clientIP} attempted access - ${remainingTime} minutes remaining`);
      return res.status(429).json({ 
        error: 'IP temporarily blocked due to suspicious activity',
        blockedUntil: new Date(blockInfo.expiresAt).toISOString(),
        remainingMinutes: remainingTime
      });
    } else {
      // Block expired, remove from blocked list
      blockedIPs.delete(clientIP);
      console.log(`✅ [SECURITY] IP block expired for ${clientIP}`);
    }
  }
  
  // Check if this request is authenticated
  const isAuthenticated = !!req.session?.user;
  
  // Only track unauthenticated requests
  if (!isAuthenticated) {
    if (!ipRequestTracker.has(clientIP)) {
      ipRequestTracker.set(clientIP, []);
    }
    
    const requests = ipRequestTracker.get(clientIP);
    const fifteenMinutesAgo = currentTime - (15 * 60 * 1000); // 15 minutes
    
    // Clean old requests (older than 15 minutes)
    const recentRequests = requests.filter(timestamp => timestamp > fifteenMinutesAgo);
    ipRequestTracker.set(clientIP, recentRequests);
    
    // Add current request
    recentRequests.push(currentTime);
    
    // Check if IP should be blocked (10 unauthenticated requests in 15 minutes)
    if (recentRequests.length >= 10) {
      const oneHourFromNow = currentTime + (60 * 60 * 1000); // 1 hour
      blockedIPs.set(clientIP, { 
        expiresAt: oneHourFromNow,
        blockedAt: currentTime,
        requestCount: recentRequests.length
      });
      
      // Clear the request tracker for this IP
      ipRequestTracker.delete(clientIP);
      
      console.log(`🚨 [SECURITY] IP ${clientIP} blocked for 1 hour - ${recentRequests.length} unauthenticated requests in 15 minutes`);
      return res.status(429).json({ 
        error: 'IP temporarily blocked due to excessive unauthenticated requests',
        blockedUntil: new Date(oneHourFromNow).toISOString(),
        reason: 'Too many unauthenticated requests in a short period'
      });
    }
    
    console.log(`⚠️  [SECURITY] Unauthenticated request from ${clientIP} - ${recentRequests.length}/10 in last 15 minutes`);
  }
  
  next();
};

// Clean up expired tracking data every 15 minutes
setInterval(() => {
  const currentTime = Date.now();
  const fifteenMinutesAgo = currentTime - (15 * 60 * 1000);
  
  // Clean IP request tracker
  for (const [ip, requests] of ipRequestTracker.entries()) {
    const recentRequests = requests.filter(timestamp => timestamp > fifteenMinutesAgo);
    if (recentRequests.length === 0) {
      ipRequestTracker.delete(ip);
    } else {
      ipRequestTracker.set(ip, recentRequests);
    }
  }
  
  // Clean expired IP blocks
  for (const [ip, blockInfo] of blockedIPs.entries()) {
    if (currentTime >= blockInfo.expiresAt) {
      blockedIPs.delete(ip);
      console.log(`✅ [SECURITY] Automatic cleanup - IP block expired for ${ip}`);
    }
  }
  
  if (ipRequestTracker.size > 0 || blockedIPs.size > 0) {
    console.log(`📊 [SECURITY] Tracking ${ipRequestTracker.size} IPs, ${blockedIPs.size} blocked`);
  }
}, 15 * 60 * 1000); // Every 15 minutes

// Apply IP blocking middleware
app.use(unauthenticatedIPBlocking);

// Security headers and request logging middleware
app.use((req, res, next) => {
  // COMPREHENSIVE SECURITY LOGGING
  console.log(`🔍 [SECURITY] ${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log(`🔍 [SECURITY] IP: ${req.ip || req.connection.remoteAddress}`);
  console.log(`🔍 [SECURITY] User-Agent: ${req.headers['user-agent']?.substring(0, 100)}`);
  console.log(`🔍 [SECURITY] Authenticated: ${!!req.session?.user} ${req.session?.user ? `(${req.session.user.email})` : ''}`);
  
  // Prevent XSS attacks
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Allow popup communication for OAuth (more permissive for auth flows)
  if (req.path.includes('/auth/') || req.path.includes('/oauth')) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  } else {
    // Main pages need same-origin-allow-popups to communicate with OAuth popup
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  }
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "media-src 'self' blob:; " +
    "object-src 'none'; " +
    "base-uri 'self';" +
    "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com;"
  );
  
  next();
});

// Serve React build files in production
const frontendBuildPath = path.join(__dirname, '../frontend/build');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
}

// Create uploads directory if it doesn't exist
const uploadsDir = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// In-memory storage for file metadata (deprecated - using database now)
const fileMetadata = new Map();

// Memory management helper functions
function enforceMemoryLimits() {
  // Limit pending requests
  if (pendingRequests.size > MAX_PENDING_REQUESTS) {
    const oldestEntries = Array.from(pendingRequests.entries())
      .sort(([,a], [,b]) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(0, pendingRequests.size - MAX_PENDING_REQUESTS);
    
    for (const [key, request] of oldestEntries) {
      if (request.resolve) {
        request.resolve(false);
      }
      pendingRequests.delete(key);
    }
    console.log(`🧹 Cleaned ${oldestEntries.length} old pending requests`);
  }
  
  // Limit file metadata
  if (fileMetadata.size > MAX_FILE_METADATA) {
    const oldestEntries = Array.from(fileMetadata.entries())
      .sort(([,a], [,b]) => new Date(a.uploadedAt || 0) - new Date(b.uploadedAt || 0))
      .slice(0, fileMetadata.size - MAX_FILE_METADATA);
    
    for (const [key] of oldestEntries) {
      fileMetadata.delete(key);
    }
    console.log(`🧹 Cleaned ${oldestEntries.length} old file metadata entries`);
  }
}

// Load existing data from database on startup
const loadFileMetadataFromDatabase = async () => {
  try {
    const allUploads = await db.getAllUploads();
    for (const [fileId, metadata] of allUploads.entries()) {
      fileMetadata.set(fileId, metadata);
    }
    console.log(`📋 Loaded ${fileMetadata.size} files from database into memory`);
  } catch (error) {
    console.error('Error loading file metadata:', error);
  }
};

// Migration function to handle existing in-memory data (legacy - not needed for fresh SQLite)
const migrateExistingData = async () => {
  try {
    const stats = await db.getStats();
    if (fileMetadata.size > 0 && stats.total_files === 0) {
      console.log('📋 No need to migrate - fresh database with SQLite');
    }
  } catch (error) {
    console.log('📋 Starting with fresh SQLite database');
  }
};

// Initialize database and load metadata
(async () => {
  await loadFileMetadataFromDatabase();
  await migrateExistingData();
})();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const extension = path.extname(file.originalname);
    const filename = `${fileId}${extension}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 1073741824, // Default 1GB if not set
    fieldSize: 10 * 1024 * 1024, // 10MB for form fields
    files: 1, // Only allow 1 file per request
    fields: 10 // Limit number of form fields
  },
  fileFilter: (req, file, cb) => {
    // Additional file size check (redundant but safer)
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 1073741824;
    if (file.size && file.size > maxSize) {
      const error = new Error(`File size exceeds limit of ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
      error.code = 'LIMIT_FILE_SIZE';
      return cb(error);
    }
    cb(null, true);
  }
});

// Email transporter setup
const validateEmailConfig = () => {
  console.log('📧 Validating email configuration...');
  console.log(`   SMTP_HOST: ${process.env.SMTP_HOST || 'NOT SET'}`);
  console.log(`   SMTP_USER: ${process.env.SMTP_USER || 'NOT SET'}`);
  console.log(`   SMTP_PASS: ${process.env.SMTP_PASS ? '***SET***' : 'NOT SET'}`);
  console.log(`   SMTP_PORT: ${process.env.SMTP_PORT || '587 (default)'}`);
  console.log(`   SMTP_FROM: ${process.env.SMTP_FROM || 'NOT SET'}`);
  
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('❌ Email configuration incomplete - email features will be limited');
    return false;
  }
  
  console.log('✅ Email configuration is complete');
  return true;
};

// Note: Email transporter removed - now using EmailQueue for reliability

// Security helper function to prevent path traversal attacks
const validateFilePath = (fileId, filename) => {
  // Check if fileId contains dangerous characters
  if (!fileId || typeof fileId !== 'string') {
    throw new Error('Invalid file ID');
  }
  
  // Strict UUID v4 validation pattern
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(fileId)) {
    throw new Error('Invalid file ID format - must be valid UUID v4');
  }
  
  // Check if filename contains path traversal attempts (including encoded variants)
  if (filename) {
    const decodedFilename = decodeURIComponent(filename);
    const dangerous = ['..', '/', '\\', '%2e%2e', '%2f', '%5c', '\0'];
    for (const danger of dangerous) {
      if (filename.toLowerCase().includes(danger) || decodedFilename.toLowerCase().includes(danger)) {
        throw new Error('Invalid filename - path traversal detected');
      }
    }
  }
  
  // Ensure the resolved path stays within uploads directory
  const resolvedPath = path.resolve(uploadsDir, filename || '');
  const uploadsPath = path.resolve(uploadsDir);
  
  if (!resolvedPath.startsWith(uploadsPath)) {
    throw new Error('Path traversal attack detected');
  }
  
  return resolvedPath;
};

// Input validation utilities
const validateInput = {
  // Validate email format
  email: (email) => {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  },
  
  // Validate collection name
  collectionName: (name) => {
    if (!name || typeof name !== 'string') return false;
    return name.length >= 1 && name.length <= 100 && !name.includes('<') && !name.includes('>');
  },
  
  // Validate collection description
  collectionDescription: (desc) => {
    if (!desc) return true; // Optional field
    if (typeof desc !== 'string') return false;
    return desc.length <= 500 && !desc.includes('<script') && !desc.includes('javascript:');
  },
  
  // Validate file retention time
  retentionTime: (time) => {
    const validTimes = ['1hour', '5hours', '24hours', '7days', '30days', 'permanent'];
    return validTimes.includes(time);
  },
  
  // Sanitize string input
  sanitizeString: (str) => {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[<>'"&]/g, (match) => {
      const entities = {'<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '&': '&amp;'};
      return entities[match];
    }).slice(0, 1000); // Limit length
  },
  
  // No file type restrictions - allow all file types
  fileType: (filename, mimeType) => {
    return true; // Accept all file types
  }
};

// File type detection based on extension
const getFileType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(ext)) return 'audio';
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return 'image';
  if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.ogv'].includes(ext)) return 'video';
  if (['.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.zip'].includes(ext)) return 'document';
  return 'other';
};

// Helper function to calculate expiry time
const calculateExpiryTime = (retentionTime) => {
  if (retentionTime === 'permanent') return null;
  
  const hours = {
    '1hour': 1,
    '5hours': 5,
    '12hours': 12,
    '24hours': 24
  };
  
  const hoursToAdd = hours[retentionTime] || 24;
  return new Date(Date.now() + hoursToAdd * 60 * 60 * 1000);
};

// Helper function to send file upload email notification (now using queue)
const sendEmailNotification = async (email, downloadLink, filename, expiryTime) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('📧 SMTP not configured, skipping file upload notification');
    return;
  }
  
  const expiryText = expiryTime ? 
    `This file will expire on ${expiryTime.toLocaleString()}.` : 
    'This file is stored permanently.';
  
  const emailData = {
    type: 'file_upload_notification',
    to: email,
    subject: `File Upload: ${filename}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Your file has been uploaded successfully!</h2>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>File:</strong> ${filename}</p>
          <p><strong>Download Link:</strong> <a href="${downloadLink}" style="color: #007bff;">${downloadLink}</a></p>
          <p style="color: #666;">${expiryText}</p>
        </div>
        <p>Best regards,<br><strong>Leo's File Sharing</strong></p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999;">This is an automated message from leoshare.dk</p>
      </div>
    `,
    metadata: {
      filename,
      downloadLink,
      expiryTime: expiryTime ? expiryTime.toISOString() : null
    }
  };
  
  try {
    const emailId = emailQueue.enqueue(emailData);
    console.log(`📧 File upload email queued for ${email} (ID: ${emailId})`);
  } catch (error) {
    console.error('❌ Error queuing file upload email:', error.message);
  }
};

// Helper function to send login approval email notification (now using queue)
const sendLoginApprovalEmail = async (userEmail, approved) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('📧 SMTP not configured, skipping login approval notification');
    return;
  }
  
  const subject = approved ? '✅ Access Granted - Leo\'s file sharing' : '❌ Access Denied - Leo\'s file sharing';
  const statusColor = approved ? '#28a745' : '#dc3545';
  const statusText = approved ? 'APPROVED' : 'DENIED';
  const message = approved ? 
    'Your login request has been approved! You can now access the file sharing platform.' :
    'Your login request has been denied. Please contact the administrator if you believe this is an error.';
  
  const emailData = {
    type: 'login_approval',
    to: userEmail,
    subject: subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Login Request Update</h2>
        <div style="background: ${statusColor}; color: white; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
          <h3 style="margin: 0;">${statusText}</h3>
        </div>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Email:</strong> ${userEmail}</p>
          <p>${message}</p>
          ${approved ? `<p><a href="https://leoshare.dk" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Access File Sharing</a></p>` : ''}
        </div>
        <p>Best regards,<br><strong>Leo's file sharing Administrator</strong></p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999;">This is an automated message from leoshare.dk</p>
      </div>
    `,
    metadata: {
      userEmail,
      approved,
      statusText
    }
  };
  
  try {
    const emailId = emailQueue.enqueue(emailData);
    console.log(`📧 Login ${approved ? 'approval' : 'denial'} email queued for ${userEmail} (ID: ${emailId})`);
  } catch (error) {
    console.error('❌ Error queuing login approval email:', error.message);
  }
};

// Authentication middleware
const requireAuth = async (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const userStatus = await db.getUserApprovalStatus(req.session.user.email);
    if (!userStatus || !userStatus.approved) {
      return res.status(403).json({ error: 'Access denied - approval required' });
    }
    next();
  } catch (error) {
    console.error('[SECURITY] Auth check failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Admin authentication middleware
const requireAdmin = async (req, res, next) => {
  if (!req.session.user) {
    console.log('🚫 Admin access denied - not authenticated');
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const userStatus = await db.getUserApprovalStatus(req.session.user.email);
    if (!userStatus || !userStatus.approved) {
      console.log(`🚫 Admin access denied for ${req.session.user.email} - not approved`);
      return res.status(403).json({ error: 'Access denied - approval required' });
    }
    
    // Support multiple admin emails
    const adminEmails = process.env.ADMIN_EMAILS ? 
      process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : 
      [process.env.ADMIN_EMAIL || process.env.SMTP_USER || (() => {
        console.error('🚨 No admin emails configured!');
        throw new Error('Admin email configuration required');
      })()];
    
    if (!adminEmails.includes(req.session.user.email)) {
      console.log(`🚫 Admin access denied for ${req.session.user.email} - not admin (allowed: ${adminEmails.join(', ')})`);
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log(`✅ Admin access granted for ${req.session.user.email}`);
    next();
  } catch (error) {
    console.error('[SECURITY] Admin auth check failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Conditional authentication middleware for files (checks if file is public)
const requireAuthForFile = async (req, res, next) => {
  const { fileId } = req.params;
  
  try {
    const fileData = await db.getUploadById(fileId);
    
    if (!fileData) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check if file has expired
    if (fileData.expiryTime && new Date() > new Date(fileData.expiryTime)) {
      return res.status(404).json({ error: 'File has expired' });
    }
    
    // If file is not private, allow access
    const isProtected = fileData.isPrivate;
    console.log(`🔐 Auth check for ${fileId}: isPrivate=${fileData.isPrivate} -> isProtected=${isProtected}, hasUser=${!!req.session.user}`);
    if (!isProtected) {
      console.log(`✅ Public file ${fileId} - allowing access`);
      return next();
    }
    
    // Otherwise require authentication
    console.log(`🔒 Private file ${fileId} - requiring authentication`);
    return requireAuth(req, res, next);
  } catch (error) {
    console.error('[SECURITY] File auth check failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Session cleanup endpoint for debugging OAuth issues
app.get('/auth/cleanup-session', (req, res) => {
  if (req.session.oauthCsrfToken) {
    delete req.session.oauthCsrfToken;
    console.log('🧹 Cleaned up OAuth CSRF token from session');
  }
  res.json({ message: 'OAuth session cleaned up', timestamp: new Date().toISOString() });
});

// Google OAuth routes
app.get('/auth/google', oauthRateLimit, (req, res) => {
  // Clean up any existing OAuth CSRF tokens to prevent conflicts
  if (req.session.oauthCsrfToken) {
    delete req.session.oauthCsrfToken;
    console.log('🧹 Cleaned up existing OAuth CSRF token before new auth flow');
  }
  
  // Pass mobile/fallback state through OAuth process
  const isMobile = req.query.mobile === 'true';
  const isFallback = req.query.fallback === 'true';
  
  // Generate CSRF token for OAuth security
  const crypto = require('crypto');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  
  // Store CSRF token in session for verification
  req.session.oauthCsrfToken = csrfToken;
  
  const state = JSON.stringify({
    mobile: isMobile,
    fallback: isFallback,
    csrf: csrfToken
  });
  
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email'],
    state: state
  });
  res.redirect(authUrl);
});

app.get('/auth/google/callback', oauthRateLimit, async (req, res) => {
  const { code, state } = req.query;
  
  // Parse state parameter to get mobile/fallback info and verify CSRF token
  let isMobile = false;
  let isFallback = false;
  let csrfToken = null;
  
  if (state) {
    try {
      const parsedState = JSON.parse(state);
      isMobile = parsedState.mobile || false;
      isFallback = parsedState.fallback || false;
      csrfToken = parsedState.csrf;
    } catch (error) {
      console.warn('Could not parse OAuth state parameter:', error.message);
      return sendOAuthResult(res, 'error', req);
    }
  }
  
  // Verify CSRF token to prevent OAuth CSRF attacks (with backward compatibility)
  if (csrfToken && req.session.oauthCsrfToken) {
    // If both tokens exist, they must match
    if (csrfToken !== req.session.oauthCsrfToken) {
      console.error('[SECURITY] OAuth CSRF token verification failed - tokens do not match');
      delete req.session.oauthCsrfToken;
      return sendOAuthResult(res, 'error', req);
    }
    // Clear the CSRF token after successful verification
    delete req.session.oauthCsrfToken;
  } else if (csrfToken && !req.session.oauthCsrfToken) {
    // Token provided but no session token (expired session)
    console.warn('[SECURITY] OAuth CSRF token provided but no session token - possible expired session');
    // Allow but log the event - could be legitimate expired session
  } else if (!csrfToken && req.session.oauthCsrfToken) {
    // Session token exists but no token in callback (backward compatibility)
    console.warn('[SECURITY] OAuth callback without CSRF token - backward compatibility mode for existing user flow');
    delete req.session.oauthCsrfToken;
    // Allow for backward compatibility with existing bookmarks/cached URLs
  } else {
    // Neither token exists - legacy flow or direct access
    console.warn('[SECURITY] OAuth callback without CSRF protection - legacy flow');
    // Allow for backward compatibility but this should be rare
  }
  
  // Add to req.query for sendOAuthResult
  req.query.mobile = isMobile.toString();
  req.query.fallback = isFallback.toString();
  
  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    
    console.log(`🔐 OAuth Login Attempt: ${name} (${email})`);
    
    // Regenerate session to prevent session fixation attacks
    req.session.regenerate(async (err) => {
      if (err) {
        console.error('[SECURITY] Session regeneration failed:', err);
        // Determine the correct frontend URL based on the request origin
        let frontendUrl = process.env.FRONTEND_URL || 'https://leoshare.dk';
        const referer = req.headers.referer || req.headers.origin;
        if (referer && referer.includes('www.leoshare.dk')) {
          frontendUrl = 'https://www.leoshare.dk';
        } else if (referer && referer.includes('leoshare.dk')) {
          frontendUrl = 'https://leoshare.dk';
        }
        
        return res.redirect(`${frontendUrl}?login=failed`);
      }
      
      // Always log the user into their Google account and create session
      req.session.user = { email, name };
      
      // Check user status in database
      let userStatus = await db.getUserApprovalStatus(email);
      
      if (!userStatus) {
        // New user - add to database as unapproved
        console.log(`👤 New user signing up: ${email}`);
        await db.addUser(email, name, false);
        userStatus = { exists: true, approved: false, name: name };
        
        // Send approval request email to admin
        const userIP = req.headers['x-forwarded-for'] || 
                       req.headers['x-real-ip'] || 
                       req.connection.remoteAddress || 
                       req.socket.remoteAddress || 
                       (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
                       req.ip || 'Unknown';
        
        const requestId = uuidv4();
        console.log(`📧 Sending approval request for new user: ${email}`);
        await sendApprovalRequestEmail(email, name, requestId, userIP);
        
        // Store request for admin approval links (simplified)
        pendingRequests.set(requestId, { email, name, userIP, timestamp: new Date() });
        
        return sendOAuthResult(res, 'pending', req);
      } else if (userStatus.approved) {
        // Existing approved user
        console.log(`✅ Approved user logged in: ${email}`);
        // Ensure they're in the whitelist (legacy compatibility)
        if (!whitelist.has(email)) {
          whitelist.add(email);
          saveWhitelist();
        }
        return sendOAuthResult(res, 'success', req);
      } else {
        // Existing but unapproved user
        console.log(`⏳ Unapproved user logged in: ${email}`);
        return sendOAuthResult(res, 'pending', req);
      }
    
    }); // Close session regeneration callback
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    sendOAuthResult(res, 'error', req);
  }
});

app.get('/api/auth/status', async (req, res) => {
  try {
    if (req.session.user) {
      const email = req.session.user.email;
      const userStatus = await db.getUserApprovalStatus(email);
      
      // Check if user is admin
      const adminEmails = process.env.ADMIN_EMAILS ? 
        process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : 
        [process.env.ADMIN_EMAIL || process.env.SMTP_USER || ''].filter(Boolean);
      
      const isAdmin = adminEmails.includes(email);
      
      if (userStatus && userStatus.approved) {
        res.json({ 
          authenticated: true, 
          approved: true,
          user: { ...req.session.user, isAdmin }
        });
      } else if (userStatus) {
        res.json({ 
          authenticated: true, 
          approved: false,
          user: { ...req.session.user, isAdmin },
          createdAt: userStatus.createdAt
        });
      } else {
        // User session exists but not in database (shouldn't happen)
        console.error(`[SECURITY] User session exists but not in database: ${email}`);
        res.json({ authenticated: false });
      }
    } else {
      res.json({ authenticated: false });
    }
  } catch (error) {
    console.error('[SECURITY] Auth status check failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json({ success: true });
  });
});

// Get user's uploaded files
app.get('/api/my-files', requireAuth, (req, res) => {
  const userEmail = req.session.user.email;
  const userFiles = [];
  
  for (const [fileId, metadata] of fileMetadata.entries()) {
    if (metadata.uploadedBy === userEmail) {
      // Check if file has expired
      if (metadata.expiryTime && new Date() > metadata.expiryTime) {
        continue; // Skip expired files
      }
      
      const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
      userFiles.push({
        id: fileId,
        originalName: metadata.originalName,
        size: metadata.size,
        uploadTime: metadata.uploadTime,
        expiryTime: metadata.expiryTime,
        downloadCount: metadata.downloadCount,
        isPrivate: metadata.isPrivate !== false && metadata.loginProtected !== false, // Support both field names
        downloadLink: `${baseUrl}/preview/${fileId}`
      });
    }
  }
  
  // Sort by upload time (newest first)
  userFiles.sort((a, b) => new Date(b.uploadTime) - new Date(a.uploadTime));
  
  res.json({ files: userFiles });
});

// Delete user's file endpoint
app.delete('/api/files/:fileId', requireAuth, (req, res) => {
  const { fileId } = req.params;
  const userEmail = req.session.user.email;
  
  try {
    // Validate fileId for security
    validateFilePath(fileId);
  } catch (error) {
    console.warn(`🚨 Path traversal attempt blocked: ${error.message} (fileId: ${fileId})`);
    return res.status(400).json({ error: 'Invalid file ID' });
  }
  
  // Get file metadata to verify ownership
  const metadata = fileMetadata.get(fileId);
  if (!metadata) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Check if user owns this file
  if (metadata.uploadedBy !== userEmail) {
    return res.status(403).json({ error: 'You can only delete your own files' });
  }
  
  // Delete file from disk with secure path validation
  let filePath;
  try {
    filePath = validateFilePath(fileId, metadata.filename);
  } catch (error) {
    console.warn(`🚨 Path traversal attempt blocked during delete: ${error.message} (filename: ${metadata.filename})`);
    return res.status(400).json({ error: 'Invalid file request' });
  }
  
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted file from disk: ${metadata.originalName}`);
    } catch (error) {
      console.error(`❌ Error deleting file from disk: ${error}`);
      return res.status(500).json({ error: 'Delete operation failed' });
    }
  }
  
  // Remove from database and memory
  db.removeUpload(fileId);
  fileMetadata.delete(fileId);
  
  console.log(`🗑️ User ${userEmail} deleted file: ${metadata.originalName}`);
  res.json({ success: true, message: 'File deleted successfully' });
});

// Collections API endpoints
app.get('/api/collections', requireAuth, async (req, res) => {
  try {
    const userEmail = req.session.user.email;
    const userCollections = await db.getUserCollections(userEmail);
    res.json(userCollections);
  } catch (error) {
    console.error('Error fetching collections:', error);
    res.status(500).json({ error: 'Unable to load collections' });
  }
});

app.post('/api/collections', requireAuth, async (req, res) => {
  const { name, description, isPrivate } = req.body;
  const userEmail = req.session.user.email;
  
  // Comprehensive input validation
  if (!validateInput.collectionName(name)) {
    return res.status(400).json({ error: 'Invalid collection name. Must be 1-100 characters and contain no HTML tags.' });
  }
  
  if (!validateInput.collectionDescription(description)) {
    return res.status(400).json({ error: 'Invalid collection description. Must be under 500 characters and contain no scripts.' });
  }
  
  try {
    // Sanitize inputs before storing
    const sanitizedName = validateInput.sanitizeString(name.trim());
    const sanitizedDescription = validateInput.sanitizeString(description || '');
    
    const collection = await db.createCollection(userEmail, sanitizedName, sanitizedDescription, Boolean(isPrivate));
    res.json(collection);
  } catch (err) {
    console.error(`[SECURITY] Collection creation failed for user ${userEmail}:`, err.message);
    res.status(500).json({ error: 'Unable to create collection' });
  }
});

app.delete('/api/collections/:collectionId', requireAuth, async (req, res) => {
  const { collectionId } = req.params;
  const userEmail = req.session.user.email;
  
  try {
    const success = await db.deleteCollection(collectionId, userEmail);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Collection not found or access denied' });
    }
  } catch (err) {
    console.error('Error deleting collection:', err);
    res.status(500).json({ error: 'Unable to delete collection' });
  }
});

app.post('/api/collections/:collectionId/files', requireAuth, async (req, res) => {
  const { collectionId } = req.params;
  const { fileId } = req.body;
  const userEmail = req.session.user.email;
  
  try {
    // Verify the collection belongs to the user
    const collection = await db.getCollection(collectionId);
    if (!collection || collection.createdBy !== userEmail) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Verify the file belongs to the user
    const fileData = await db.getUploadById(fileId);
    if (!fileData || fileData.uploadedBy !== userEmail) {
      return res.status(403).json({ error: 'File not found or access denied' });
    }
    
    const wasAdded = await db.addFileToCollection(collectionId, fileId);
    // Always return success - whether file was newly added or already existed
    res.json({ success: true, wasAdded });
  } catch (err) {
    console.error('Error adding file to collection:', err);
    res.status(500).json({ error: 'Unable to add file to collection' });
  }
});

app.delete('/api/collections/:collectionId/files/:fileId', requireAuth, async (req, res) => {
  const { collectionId, fileId } = req.params;
  const userEmail = req.session.user.email;
  
  try {
    // Verify the collection belongs to the user
    const collection = await db.getCollection(collectionId);
    if (!collection || collection.createdBy !== userEmail) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const success = await db.removeFileFromCollection(collectionId, fileId);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'File not found in collection' });
    }
  } catch (err) {
    console.error('Error removing file from collection:', err);
    res.status(500).json({ error: 'Unable to remove file from collection' });
  }
});

// Subscription API endpoints
app.post('/api/subscribe/file/:fileId', requireAuth, async (req, res) => {
  const { fileId } = req.params;
  const userEmail = req.session.user.email;
  
  // Verify file exists
  const fileData = db.getUploadById(fileId);
  if (!fileData) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Don't allow subscribing to your own files
  if (fileData.uploadedBy === userEmail) {
    return res.status(400).json({ error: 'Cannot subscribe to your own files' });
  }
  
  try {
    const success = await db.subscribeToFile(userEmail, fileId);
    if (success) {
      res.json({ success: true, message: 'Subscribed to file' });
    } else {
      res.status(400).json({ error: 'Already subscribed to this file' });
    }
  } catch (err) {
    console.error('Error subscribing to file:', err);
    res.status(500).json({ error: 'Unable to subscribe to file' });
  }
});

app.delete('/api/subscribe/file/:fileId', requireAuth, async (req, res) => {
  const { fileId } = req.params;
  const userEmail = req.session.user.email;
  
  try {
    const success = await db.unsubscribeFromFile(userEmail, fileId);
    if (success) {
      res.json({ success: true, message: 'Unsubscribed from file' });
    } else {
      res.status(404).json({ error: 'Not subscribed to this file' });
    }
  } catch (err) {
    console.error('Error unsubscribing from file:', err);
    res.status(500).json({ error: 'Unable to unsubscribe from file' });
  }
});

app.get('/api/subscribed-files', requireAuth, async (req, res) => {
  try {
    const userEmail = req.session.user.email;
    const subscribedFiles = await db.getSubscribedFiles(userEmail);
    res.json(subscribedFiles);
  } catch (error) {
    console.error('Error fetching subscribed files:', error);
    res.status(500).json({ error: 'Unable to load subscribed files' });
  }
});

app.post('/api/subscribe/collection/:collectionId', requireAuth, async (req, res) => {
  const { collectionId } = req.params;
  const userEmail = req.session.user.email;
  
  try {
    // Verify collection exists
    const collection = await db.getCollection(collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    // Don't allow subscribing to your own collections
    if (collection.createdBy === userEmail) {
      return res.status(400).json({ error: 'Cannot subscribe to your own collections' });
    }
    
    const success = await db.subscribeToCollection(userEmail, collectionId);
    if (success) {
      res.json({ success: true, message: 'Subscribed to collection' });
    } else {
      res.status(400).json({ error: 'Already subscribed to this collection' });
    }
  } catch (err) {
    console.error('Error subscribing to collection:', err);
    res.status(500).json({ error: 'Unable to subscribe to collection' });
  }
});

app.delete('/api/subscribe/collection/:collectionId', requireAuth, async (req, res) => {
  const { collectionId } = req.params;
  const userEmail = req.session.user.email;
  
  try {
    const success = await db.unsubscribeFromCollection(userEmail, collectionId);
    if (success) {
      res.json({ success: true, message: 'Unsubscribed from collection' });
    } else {
      res.status(404).json({ error: 'Not subscribed to this collection' });
    }
  } catch (err) {
    console.error('Error unsubscribing from collection:', err);
    res.status(500).json({ error: 'Unable to unsubscribe from collection' });
  }
});

// Collection preview endpoint (public access for shareable links)
app.get('/api/collections/:collectionId/preview', async (req, res) => {
  const { collectionId } = req.params;
  
  // Add request timeout to prevent hanging
  const requestTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error(`Collection preview request timed out for ${collectionId}`);
      res.status(504).json({ error: 'Request timed out. Please try again.' });
    }
  }, 15000); // 15 second timeout
  
  try {
    // Validate collection ID format for security
    if (!collectionId || typeof collectionId !== 'string' || !/^[a-f0-9\-]{36}$/i.test(collectionId)) {
      clearTimeout(requestTimeout);
      return res.status(400).json({ error: 'Invalid collection ID format' });
    }
    
    console.log(`🔍 Fetching collection preview for: ${collectionId}`);
    const startTime = Date.now();
    
    // Use Promise.race to add an additional timeout layer for database operations
    const collection = await Promise.race([
      db.getCollection(collectionId),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database getCollection timeout')), 8000)
      )
    ]);
    
    if (!collection) {
      clearTimeout(requestTimeout);
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    // If collection is private, require authentication
    if (!collection.isPublic) {
      if (!req.session.user) {
        clearTimeout(requestTimeout);
        return res.status(401).json({ error: 'Authentication required for private collection' });
      }
    }
    
    console.log(`✅ Collection found: ${collection.name}, fetching files...`);
    
    // Get all files in the collection with their metadata using additional timeout
    const files = await Promise.race([
      db.getCollectionFiles(collectionId),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database getCollectionFiles timeout')), 8000)
      )
    ]);
    
    const loadTime = Date.now() - startTime;
    console.log(`📁 Collection ${collection.name} loaded with ${files.length} files in ${loadTime}ms`);
    
    clearTimeout(requestTimeout);
    
    res.json({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      createdBy: collection.createdBy,
      createdAt: collection.createdAt,
      isPublic: collection.isPublic,
      files: files.map(file => ({
        id: file.id,
        filename: file.filename,
        originalFilename: file.originalFilename,
        size: file.size,
        uploadDate: file.uploadDate,
        fileType: file.fileType,
        downloadLink: `/api/download/${file.id}`,
        isPrivate: file.isPrivate
      }))
    });
  } catch (err) {
    clearTimeout(requestTimeout);
    console.error(`Error fetching collection preview for ${collectionId}:`, err.message);
    
    if (!res.headersSent) {
      if (err.message.includes('timeout')) {
        res.status(504).json({ error: 'Database operation timed out. Please try again.' });
      } else {
        res.status(500).json({ error: 'Unable to load collection preview' });
      }
    }
  }
});

// Login approval endpoints
app.get('/api/admin/approve/:requestId', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  const { requestId } = req.params;
  const pendingRequest = pendingRequests.get(requestId);
  
  if (!pendingRequest) {
    return res.status(404).send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2>❌ Request Not Found</h2>
        <p>This approval request has expired or doesn't exist.</p>
      </body></html>
    `);
  }
  
  // Approve the user in database
  await db.approveUser(pendingRequest.email);
  
  // Also add to whitelist for legacy compatibility
  whitelist.add(pendingRequest.email);
  saveWhitelist();
  
  console.log(`✅ Email approved via link: ${pendingRequest.email}`);
  
  // Send approval notification email to user
  await sendLoginApprovalEmail(pendingRequest.email, true);
  
  pendingRequests.delete(requestId);
  
  res.send(`
    <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
      <h2 style="color: #28a745;">✅ User Approved</h2>
      <p><strong>${pendingRequest.name}</strong> (${pendingRequest.email}) has been approved for access.</p>
      <p>They can now log in to the file sharing platform.</p>
    </body></html>
  `);
});

app.get('/api/admin/decline/:requestId', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  const { requestId } = req.params;
  const pendingRequest = pendingRequests.get(requestId);
  
  if (!pendingRequest) {
    return res.status(404).send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2>❌ Request Not Found</h2>
        <p>This approval request has expired or doesn't exist.</p>
      </body></html>
    `);
  }
  
  console.log(`❌ Email declined via link: ${pendingRequest.email}`);
  
  // Send denial notification email to user
  await sendLoginApprovalEmail(pendingRequest.email, false);
  
  // Resolve the promise to deny login
  if (pendingRequest.resolve) {
    pendingRequest.resolve(false);
  }
  
  pendingRequests.delete(requestId);
  
  res.send(`
    <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
      <h2 style="color: #dc3545;">❌ User Declined</h2>
      <p><strong>${pendingRequest.name}</strong> (${pendingRequest.email}) has been declined access.</p>
      <p>They will not be able to log in to the file sharing platform.</p>
    </body></html>
  `);
});

// Test email endpoint (for debugging)
app.get('/api/admin/test-email', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  console.log('🧪 Testing email configuration...');
  
  // Check if email configuration is available via environment validation
  const emailConfig = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS
  };
  
  const missingConfig = Object.keys(emailConfig).filter(key => !emailConfig[key]);
  if (missingConfig.length > 0) {
    return res.json({
      success: false,
      error: 'Email configuration incomplete',
      details: {
        SMTP_HOST: process.env.SMTP_HOST ? 'Set' : 'Missing',
        SMTP_USER: process.env.SMTP_USER ? 'Set' : 'Missing',
        SMTP_PASS: process.env.SMTP_PASS ? 'Set' : 'Missing',
        SMTP_FROM: process.env.SMTP_FROM ? process.env.SMTP_FROM : 'Not set'
      }
    });
  }
  
  const testEmail = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.ADMIN_EMAIL || process.env.SMTP_USER || (() => {
      console.error('🚨 ADMIN_EMAIL environment variable not configured!');
      throw new Error('Admin email configuration required');
    })(),
    subject: '🧪 Test Email - File Sharing Platform',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>✅ Email Configuration Test</h2>
        <p>This is a test email from your file sharing platform.</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        <p>If you received this email, your SMTP configuration is working correctly!</p>
      </div>
    `
  };
  
  try {
    // Use email queue to send test email
    emailQueue.enqueue({
      type: 'test-email',
      to: process.env.ADMIN_EMAIL || 'test@example.com',
      subject: testEmail.subject,
      html: testEmail.html
    });
    const result = { messageId: 'queued-' + Date.now(), response: 'Email queued successfully' };
    res.json({
      success: true,
      messageId: result.messageId,
      response: result.response
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      code: error.code,
      details: error
    });
  }
});

// Admin endpoint to view whitelist (for debugging)
app.get('/api/admin/whitelist', restrictToServerIP, adminRateLimit, requireAdmin, (req, res) => {
  const emails = Array.from(whitelist);
  res.json({ 
    count: emails.length,
    emails: emails.sort() 
  });
});

// Admin endpoint to check email queue status
app.get('/api/admin/email-queue', restrictToServerIP, adminRateLimit, requireAdmin, (req, res) => {
  const status = emailQueue.getStatus();
  res.json({
    ...status,
    message: status.queueLength === 0 ? 'Email queue is empty' : `${status.queueLength} emails in queue`
  });
});

// ============================================
// Direct Upload Link Management Endpoints
// ============================================

// Admin endpoint to view and manage direct upload links
app.get('/api/admin/direct-upload', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  console.log(`🔍 [SECURITY] Direct upload admin endpoint accessed by: ${req.session.user?.email}`);

  try {
    const userEmail = req.session.user.email;
    const links = await db.getUserDirectUploadLinks(userEmail);

    // Check if request wants JSON or HTML
    const acceptHeader = req.headers.accept;
    if (acceptHeader && acceptHeader.includes('application/json')) {
      return res.json({ links });
    }

    // Return HTML interface
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Direct Upload Links - Admin Panel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          }
          h1 { color: #333; margin-bottom: 10px; font-size: 28px; }
          .subtitle { color: #666; margin-bottom: 30px; font-size: 14px; }
          .create-section {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
          }
          .form-group {
            margin-bottom: 15px;
          }
          label {
            display: block;
            font-weight: 600;
            margin-bottom: 5px;
            color: #333;
            font-size: 14px;
          }
          input[type="text"], input[type="password"] {
            width: 100%;
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.2s;
          }
          input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: #667eea;
          }
          .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s;
          }
          .btn-primary {
            background: #667eea;
            color: white;
          }
          .btn-primary:hover {
            background: #5568d3;
            transform: translateY(-1px);
          }
          .btn-danger {
            background: #dc3545;
            color: white;
            padding: 6px 12px;
            font-size: 12px;
          }
          .btn-danger:hover {
            background: #c82333;
          }
          .btn-toggle {
            background: #28a745;
            color: white;
            padding: 6px 12px;
            font-size: 12px;
            margin-right: 10px;
          }
          .btn-toggle:hover {
            background: #218838;
          }
          .btn-toggle.disabled {
            background: #6c757d;
          }
          .links-section {
            margin-top: 30px;
          }
          .link-card {
            background: #f8f9fa;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 15px;
            transition: all 0.2s;
          }
          .link-card:hover {
            border-color: #667eea;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
          }
          .link-card.disabled {
            opacity: 0.6;
            background: #f0f0f0;
          }
          .link-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          .link-title {
            font-size: 18px;
            font-weight: 600;
            color: #333;
          }
          .link-status {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
          }
          .status-enabled {
            background: #d4edda;
            color: #155724;
          }
          .status-disabled {
            background: #f8d7da;
            color: #721c24;
          }
          .link-info {
            font-size: 13px;
            color: #666;
            margin-bottom: 10px;
          }
          .link-url {
            background: white;
            border: 1px solid #dee2e6;
            padding: 10px;
            border-radius: 6px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            word-break: break-all;
            margin-bottom: 15px;
          }
          .link-actions {
            display: flex;
            gap: 10px;
          }
          .copy-button {
            background: #17a2b8;
            color: white;
            padding: 6px 12px;
            font-size: 12px;
          }
          .copy-button:hover {
            background: #138496;
          }
          .no-links {
            text-align: center;
            padding: 40px;
            color: #999;
          }
          .success-message {
            background: #d4edda;
            color: #155724;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            display: none;
          }
          .error-message {
            background: #f8d7da;
            color: #721c24;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            display: none;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📤 Direct Upload Links</h1>
          <p class="subtitle">Create secure upload links for receiving files from external users</p>

          <div id="successMessage" class="success-message"></div>
          <div id="errorMessage" class="error-message"></div>

          <div class="create-section">
            <h2 style="margin-bottom: 15px; font-size: 18px;">Create New Upload Link</h2>
            <form id="createLinkForm">
              <div class="form-group">
                <label for="folderName">Folder Name *</label>
                <input type="text" id="folderName" name="folderName" placeholder="e.g., Client Documents, Project Files" required>
              </div>
              <div class="form-group">
                <label for="password">Password (optional)</label>
                <input type="password" id="password" name="password" placeholder="Leave empty for no password">
              </div>
              <button type="submit" class="btn btn-primary">🔗 Create Upload Link</button>
            </form>
          </div>

          <div class="links-section">
            <h2 style="margin-bottom: 20px; font-size: 20px;">Your Upload Links (${links.length})</h2>
            <div id="linksContainer">
              ${links.length === 0 ? '<div class="no-links">No upload links created yet. Create one above!</div>' :
                links.map(link => `
                  <div class="link-card ${!link.enabled ? 'disabled' : ''}" data-link-id="${link.id}">
                    <div class="link-header">
                      <div>
                        <div class="link-title">📁 ${link.folderName}</div>
                        <span class="link-status ${link.enabled ? 'status-enabled' : 'status-disabled'}">
                          ${link.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                    </div>
                    <div class="link-info">
                      ${link.password ? '🔒 Password protected' : '🔓 No password'} •
                      ${link.uploadCount} uploads •
                      Created ${new Date(link.createdAt).toLocaleDateString()}
                    </div>
                    <div class="link-url">${baseUrl}/direct-upload/${link.id}</div>
                    <div class="link-actions">
                      <button class="btn copy-button" onclick="copyLink('${baseUrl}/direct-upload/${link.id}')">
                        📋 Copy Link
                      </button>
                      <button class="btn btn-toggle ${!link.enabled ? 'disabled' : ''}" onclick="toggleLink('${link.id}', ${!link.enabled})">
                        ${link.enabled ? '⏸️ Disable' : '▶️ Enable'}
                      </button>
                      <button class="btn btn-danger" onclick="deleteLink('${link.id}')">
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                `).join('')}
            </div>
          </div>
        </div>

        <script>
          function showMessage(message, isError = false) {
            const successEl = document.getElementById('successMessage');
            const errorEl = document.getElementById('errorMessage');

            if (isError) {
              errorEl.textContent = message;
              errorEl.style.display = 'block';
              successEl.style.display = 'none';
            } else {
              successEl.textContent = message;
              successEl.style.display = 'block';
              errorEl.style.display = 'none';
            }

            setTimeout(() => {
              successEl.style.display = 'none';
              errorEl.style.display = 'none';
            }, 5000);
          }

          document.getElementById('createLinkForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {
              folderName: formData.get('folderName'),
              password: formData.get('password') || null
            };

            try {
              const response = await fetch('/api/admin/direct-upload/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });

              if (response.ok) {
                showMessage('✅ Upload link created successfully!');
                setTimeout(() => window.location.reload(), 1500);
              } else {
                const error = await response.json();
                showMessage('❌ ' + error.error, true);
              }
            } catch (error) {
              showMessage('❌ Failed to create link: ' + error.message, true);
            }
          });

          async function copyLink(url) {
            try {
              await navigator.clipboard.writeText(url);
              showMessage('✅ Link copied to clipboard!');
            } catch (error) {
              showMessage('❌ Failed to copy link', true);
            }
          }

          async function toggleLink(linkId, enable) {
            try {
              const response = await fetch(\`/api/admin/direct-upload/\${linkId}/toggle\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: enable })
              });

              if (response.ok) {
                showMessage(\`✅ Link \${enable ? 'enabled' : 'disabled'} successfully!\`);
                setTimeout(() => window.location.reload(), 1000);
              } else {
                const error = await response.json();
                showMessage('❌ ' + error.error, true);
              }
            } catch (error) {
              showMessage('❌ Failed to toggle link: ' + error.message, true);
            }
          }

          async function deleteLink(linkId) {
            if (!confirm('Are you sure you want to delete this upload link? This cannot be undone.')) {
              return;
            }

            try {
              const response = await fetch(\`/api/admin/direct-upload/\${linkId}\`, {
                method: 'DELETE'
              });

              if (response.ok) {
                showMessage('✅ Link deleted successfully!');
                setTimeout(() => window.location.reload(), 1000);
              } else {
                const error = await response.json();
                showMessage('❌ ' + error.error, true);
              }
            } catch (error) {
              showMessage('❌ Failed to delete link: ' + error.message, true);
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error loading direct upload links:', error);
    res.status(500).json({ error: 'Failed to load direct upload links' });
  }
});

// Create new direct upload link
app.post('/api/admin/direct-upload/create', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const { folderName, password } = req.body;
    const userEmail = req.session.user.email;

    if (!folderName || !folderName.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const link = await db.createDirectUploadLink(userEmail, folderName.trim(), password || null);
    res.json({ success: true, link });
  } catch (error) {
    console.error('Error creating direct upload link:', error);
    res.status(500).json({ error: 'Failed to create upload link' });
  }
});

// Toggle direct upload link status
app.post('/api/admin/direct-upload/:linkId/toggle', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const { linkId } = req.params;
    const { enabled } = req.body;
    const userEmail = req.session.user.email;

    const link = await db.getDirectUploadLink(linkId);
    if (!link) {
      return res.status(404).json({ error: 'Upload link not found' });
    }

    if (link.createdBy !== userEmail) {
      return res.status(403).json({ error: 'You do not have permission to modify this link' });
    }

    await db.updateDirectUploadLinkStatus(linkId, enabled);
    res.json({ success: true });
  } catch (error) {
    console.error('Error toggling direct upload link:', error);
    res.status(500).json({ error: 'Failed to toggle upload link' });
  }
});

// Delete direct upload link
app.delete('/api/admin/direct-upload/:linkId', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const { linkId } = req.params;
    const userEmail = req.session.user.email;

    const success = await db.deleteDirectUploadLink(linkId, userEmail);
    if (!success) {
      return res.status(404).json({ error: 'Upload link not found or you do not have permission to delete it' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting direct upload link:', error);
    res.status(500).json({ error: 'Failed to delete upload link' });
  }
});

// Admin endpoint to view all users (approved and unapproved)
app.get('/api/admin/users', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  // SECURITY LOGGING - Track admin endpoint access
  console.log(`🔍 [SECURITY] Admin users endpoint accessed by: ${req.session.user?.email} from IP: ${req.ip || req.connection.remoteAddress}`);
  
  try {
    const users = await db.getAllUsers();
    const pendingRequestsArray = Array.from(pendingRequests.values());
    
    // Check if request wants JSON or HTML
    const acceptHeader = req.headers.accept;
    if (acceptHeader && acceptHeader.includes('application/json')) {
      // Return JSON for API clients
      return res.json({
        users: users.map(user => ({
          email: user.email,
          name: user.name,
          approved: Boolean(user.approved),
          createdAt: user.created_at,
          approvedAt: user.approved_at,
          status: user.approved ? 'approved' : 'unapproved'
        })),
        pendingRequests: pendingRequestsArray.map(req => ({
          email: req.email,
          name: req.name,
          timestamp: req.timestamp,
          status: 'pending_approval'
        })),
        summary: {
          total: users.length,
          approved: users.filter(u => u.approved).length,
          unapproved: users.filter(u => !u.approved).length,
          pendingRequests: pendingRequestsArray.length
        }
      });
    }
    
    // Return HTML for browser viewing
    const approvedCount = users.filter(u => u.approved).length;
    const unapprovedCount = users.filter(u => !u.approved).length;
    
    let html = `
      <html>
      <head>
        <title>User Management - LeoShare Admin</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          .section { margin-bottom: 30px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background-color: #f8f9fa; }
          .approved { color: #28a745; font-weight: bold; }
          .unapproved { color: #dc3545; font-weight: bold; }
          .pending { color: #ffc107; font-weight: bold; }
          .actions { white-space: nowrap; }
          .btn { padding: 5px 10px; margin: 0 2px; text-decoration: none; border-radius: 3px; font-size: 0.85em; }
          .btn-approve { background: #28a745; color: white; }
          .btn-decline { background: #dc3545; color: white; }
          .btn:hover { opacity: 0.8; }
        </style>
      </head>
      <body>
        <h1>🛡️ User Management Panel</h1>
        
        <div class="summary">
          <h3>📊 Summary</h3>
          <p><strong>Total Users:</strong> ${users.length} | 
             <span class="approved">Approved: ${approvedCount}</span> | 
             <span class="unapproved">Unapproved: ${unapprovedCount}</span> | 
             <span class="pending">Pending: ${pendingRequestsArray.length}</span>
          </p>
        </div>
    `;

    // Pending requests section
    if (pendingRequestsArray.length > 0) {
      html += `
        <div class="section">
          <h3>⏳ Pending Approval Requests</h3>
          <table>
            <tr><th>Name</th><th>Email</th><th>Requested</th><th>Actions</th></tr>
      `;
      
      pendingRequestsArray.forEach(req => {
        const requestId = Array.from(pendingRequests.entries()).find(([id, data]) => data === req)?.[0];
        html += `
          <tr>
            <td>${req.name}</td>
            <td>${req.email}</td>
            <td>${new Date(req.timestamp).toLocaleString()}</td>
            <td class="actions">
              <a href="/api/admin/approve/${requestId}" class="btn btn-approve">✅ Approve</a>
              <a href="/api/admin/decline/${requestId}" class="btn btn-decline">❌ Decline</a>
            </td>
          </tr>
        `;
      });
      
      html += `</table></div>`;
    }

    // All users section
    html += `
      <div class="section">
        <h3>👥 All Users</h3>
        <table>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Status</th>
            <th>Created</th>
            <th>Approved</th>
            <th>Actions</th>
          </tr>
    `;
    
    users.forEach(user => {
      const status = user.approved ? 'approved' : 'unapproved';
      const statusClass = user.approved ? 'approved' : 'unapproved';
      const approvedDate = user.approved_at ? new Date(user.approved_at).toLocaleString() : 'N/A';
      
      html += `
        <tr>
          <td>${user.name}</td>
          <td>${user.email}</td>
          <td class="${statusClass}">${status.toUpperCase()}</td>
          <td>${new Date(user.created_at).toLocaleString()}</td>
          <td>${approvedDate}</td>
          <td class="actions">
      `;
      
      if (user.approved) {
        html += `<a href="/api/admin/decline-user/${encodeURIComponent(user.email)}" class="btn btn-decline">❌ Unapprove</a>`;
      } else {
        html += `<a href="/api/admin/approve-user/${encodeURIComponent(user.email)}" class="btn btn-approve">✅ Approve</a>`;
      }
      
      html += ` <a href="/api/admin/remove-user/${encodeURIComponent(user.email)}" class="btn btn-decline" onclick="return confirm('⚠️ DANGER: This will permanently delete ${user.name} (${user.email}) and ALL their files from the system. This cannot be undone. Are you sure?')" style="background: #6c757d;">🗑️ Remove</a>`;
      
      html += `</td></tr>`;
    });
    
    html += `
          </table>
        </div>
        
        <div class="section">
          <h3>🔗 Other Admin Actions</h3>
          <p>
            <a href="/api/admin/whitelist" class="btn btn-approve">View Whitelist</a>
            <a href="/api/admin/email-queue" class="btn btn-approve">Email Queue Status</a>
            <a href="/api/admin/test-email" class="btn btn-approve">Test Email</a>
          </p>
        </div>
      </body>
      </html>
    `;
    
    res.send(html);
    
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc3545;">❌ Error</h2>
        <p>Failed to fetch users: ${error.message}</p>
      </body></html>
    `);
  }
});

// Admin endpoint to approve user directly by email (bypasses requestId system)
// GET version for browser convenience
app.get('/api/admin/approve-user/:email', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    
    // Validate email format to prevent injection
    if (!validateInput.email(email)) {
      return res.status(400).send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>❌ Invalid Email Format</h2>
          <p>The provided email address is not valid.</p>
        </body></html>
      `);
    }
    
    // Check if user exists in database
    const userStatus = await db.getUserApprovalStatus(email);
    if (!userStatus) {
      return res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">❌ User Not Found</h2>
          <p>Email <strong>${email}</strong> was not found in the database.</p>
          <p><a href="/api/admin/users">← Back to User List</a></p>
        </body></html>
      `);
    }
    
    if (userStatus.approved) {
      return res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #ffc107;">⚠️ Already Approved</h2>
          <p><strong>${userStatus.name}</strong> (${email}) is already approved.</p>
          <p><a href="/api/admin/users">← Back to User List</a></p>
        </body></html>
      `);
    }
    
    // Approve the user in database
    await db.approveUser(email);
    
    // Also add to whitelist for legacy compatibility
    whitelist.add(email);
    saveWhitelist();
    
    console.log(`✅ User approved directly by admin: ${email}`);
    
    // Send approval notification email to user
    await sendLoginApprovalEmail(email, true);
    
    res.send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #28a745;">✅ User Approved</h2>
        <p><strong>${userStatus.name}</strong> (${email}) has been approved for access.</p>
        <p>✉️ Approval notification email sent to user.</p>
        <p>They can now log in to the file sharing platform.</p>
        <p><a href="/api/admin/users">← Back to User List</a></p>
      </body></html>
    `);
    
  } catch (error) {
    console.error('Error approving user:', error);
    res.send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc3545;">❌ Error</h2>
        <p>Failed to approve user: ${error.message}</p>
        <p><a href="/api/admin/users">← Back to User List</a></p>
      </body></html>
    `);
  }
});

// POST version for API usage
app.post('/api/admin/approve-user/:email', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    
    // Validate email format to prevent injection
    if (!validateInput.email(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Check if user exists in database
    const userStatus = await db.getUserApprovalStatus(email);
    if (!userStatus) {
      return res.status(404).json({ 
        error: 'User not found in database',
        email: email 
      });
    }
    
    if (userStatus.approved) {
      return res.status(400).json({ 
        error: 'User is already approved',
        email: email 
      });
    }
    
    // Approve the user in database
    await db.approveUser(email);
    
    // Also add to whitelist for legacy compatibility
    whitelist.add(email);
    saveWhitelist();
    
    console.log(`✅ User approved directly by admin: ${email}`);
    
    // Send approval notification email to user
    await sendLoginApprovalEmail(email, true);
    
    res.json({
      success: true,
      message: `User ${email} has been approved`,
      email: email,
      approvedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error approving user:', error);
    res.status(500).json({ 
      error: 'Failed to approve user',
      details: error.message 
    });
  }
});

// Admin endpoint to decline/unapprove user directly by email
// GET version for browser convenience
app.get('/api/admin/decline-user/:email', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    
    // Validate email format to prevent injection
    if (!validateInput.email(email)) {
      return res.status(400).send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>❌ Invalid Email Format</h2>
          <p>The provided email address is not valid.</p>
        </body></html>
      `);
    }
    
    // Check if user exists in database
    const userStatus = await db.getUserApprovalStatus(email);
    if (!userStatus) {
      return res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">❌ User Not Found</h2>
          <p>Email <strong>${email}</strong> was not found in the database.</p>
          <p><a href="/api/admin/users">← Back to User List</a></p>
        </body></html>
      `);
    }
    
    if (!userStatus.approved) {
      return res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #ffc107;">⚠️ Already Unapproved</h2>
          <p><strong>${userStatus.name}</strong> (${email}) is already unapproved.</p>
          <p><a href="/api/admin/users">← Back to User List</a></p>
        </body></html>
      `);
    }
    
    // Unapprove the user in database (set approved = false)
    await db.unapproveUser(email);
    
    // Remove from whitelist
    whitelist.delete(email);
    saveWhitelist();
    
    console.log(`❌ User unapproved directly by admin: ${email}`);
    
    // Send denial notification email to user
    await sendLoginApprovalEmail(email, false);
    
    res.send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc3545;">❌ User Declined</h2>
        <p><strong>${userStatus.name}</strong> (${email}) has been unapproved.</p>
        <p>✉️ Denial notification email sent to user.</p>
        <p>They will no longer be able to log in to the file sharing platform.</p>
        <p><a href="/api/admin/users">← Back to User List</a></p>
      </body></html>
    `);
    
  } catch (error) {
    console.error('Error unapproving user:', error);
    res.send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc3545;">❌ Error</h2>
        <p>Failed to unapprove user: ${error.message}</p>
        <p><a href="/api/admin/users">← Back to User List</a></p>
      </body></html>
    `);
  }
});

// POST version for API usage  
app.post('/api/admin/decline-user/:email', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    
    // Validate email format to prevent injection
    if (!validateInput.email(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Check if user exists in database
    const userStatus = await db.getUserApprovalStatus(email);
    if (!userStatus) {
      return res.status(404).json({ 
        error: 'User not found in database',
        email: email 
      });
    }
    
    if (!userStatus.approved) {
      return res.status(400).json({ 
        error: 'User is already unapproved',
        email: email 
      });
    }
    
    // Unapprove the user in database (set approved = false)
    await db.unapproveUser(email);
    
    // Remove from whitelist
    whitelist.delete(email);
    saveWhitelist();
    
    console.log(`❌ User unapproved directly by admin: ${email}`);
    
    // Send denial notification email to user
    await sendLoginApprovalEmail(email, false);
    
    res.json({
      success: true,
      message: `User ${email} has been unapproved`,
      email: email,
      unapprovedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error unapproving user:', error);
    res.status(500).json({ 
      error: 'Failed to unapprove user',
      details: error.message 
    });
  }
});

// Admin endpoint to completely remove user from database (with file cleanup)
// GET version for browser convenience
app.get('/api/admin/remove-user/:email', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    
    // Validate email format to prevent injection
    if (!validateInput.email(email)) {
      return res.status(400).send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>❌ Invalid Email Format</h2>
          <p>The provided email address is not valid.</p>
        </body></html>
      `);
    }
    
    // Check if user exists in database
    const userStatus = await db.getUserApprovalStatus(email);
    if (!userStatus) {
      return res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">❌ User Not Found</h2>
          <p>Email <strong>${email}</strong> was not found in the database.</p>
          <p><a href="/api/admin/users">← Back to User List</a></p>
        </body></html>
      `);
    }
    
    console.log(`🗑️ Admin removing user completely: ${email}`);
    
    // Remove user from database (this returns files that need physical deletion)
    const result = await db.removeUser(email);
    
    if (!result.success) {
      return res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">❌ Error</h2>
          <p>${result.message}</p>
          <p><a href="/api/admin/users">← Back to User List</a></p>
        </body></html>
      `);
    }
    
    // Clean up physical files
    const fs = require('fs');
    const path = require('path');
    let filesDeleted = 0;
    let fileErrors = 0;
    
    if (result.userFiles && result.userFiles.length > 0) {
      for (const file of result.userFiles) {
        try {
          const filePath = path.join(process.env.UPLOAD_PATH || './uploads', file.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            filesDeleted++;
            console.log(`🗑️ Deleted file: ${file.filename}`);
          }
        } catch (error) {
          fileErrors++;
          console.error(`❌ Error deleting file ${file.filename}:`, error.message);
        }
      }
    }
    
    // Remove from whitelist
    whitelist.delete(email);
    saveWhitelist();
    
    console.log(`✅ User completely removed: ${email} (${filesDeleted} files deleted, ${fileErrors} file errors)`);
    
    res.send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc3545;">🗑️ User Completely Removed</h2>
        <p><strong>${userStatus.name}</strong> (${email}) has been completely removed from the system.</p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: left; max-width: 500px; margin-left: auto; margin-right: auto;">
          <h4>📊 Cleanup Summary:</h4>
          <ul>
            <li>✅ User record deleted from database</li>
            <li>✅ All collections deleted</li>
            <li>✅ All file records deleted</li>
            <li>✅ Physical files deleted: ${filesDeleted}</li>
            ${fileErrors > 0 ? `<li>⚠️ File deletion errors: ${fileErrors}</li>` : ''}
            <li>✅ Removed from whitelist</li>
          </ul>
        </div>
        <p><strong>⚠️ This action cannot be undone.</strong></p>
        <p><a href="/api/admin/users">← Back to User List</a></p>
      </body></html>
    `);
    
  } catch (error) {
    console.error('Error removing user:', error);
    res.send(`
      <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc3545;">❌ Error</h2>
        <p>Failed to remove user: ${error.message}</p>
        <p><a href="/api/admin/users">← Back to User List</a></p>
      </body></html>
    `);
  }
});

// POST version for API usage
app.post('/api/admin/remove-user/:email', restrictToServerIP, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    
    // Validate email format to prevent injection
    if (!validateInput.email(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Check if user exists in database
    const userStatus = await db.getUserApprovalStatus(email);
    if (!userStatus) {
      return res.status(404).json({ 
        error: 'User not found in database',
        email: email 
      });
    }
    
    console.log(`🗑️ Admin removing user completely: ${email}`);
    
    // Remove user from database (this returns files that need physical deletion)
    const result = await db.removeUser(email);
    
    if (!result.success) {
      return res.status(400).json({ 
        error: result.message,
        email: email 
      });
    }
    
    // Clean up physical files
    const fs = require('fs');
    const path = require('path');
    let filesDeleted = 0;
    let fileErrors = 0;
    
    if (result.userFiles && result.userFiles.length > 0) {
      for (const file of result.userFiles) {
        try {
          const filePath = path.join(process.env.UPLOAD_PATH || './uploads', file.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            filesDeleted++;
            console.log(`🗑️ Deleted file: ${file.filename}`);
          }
        } catch (error) {
          fileErrors++;
          console.error(`❌ Error deleting file ${file.filename}:`, error.message);
        }
      }
    }
    
    // Remove from whitelist
    whitelist.delete(email);
    saveWhitelist();
    
    console.log(`✅ User completely removed: ${email} (${filesDeleted} files deleted, ${fileErrors} file errors)`);
    
    res.json({
      success: true,
      message: `User ${email} completely removed from system`,
      email: email,
      cleanup: {
        filesDeleted: filesDeleted,
        fileErrors: fileErrors,
        totalFiles: result.userFiles ? result.userFiles.length : 0
      },
      removedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error removing user:', error);
    res.status(500).json({ 
      error: 'Failed to remove user',
      details: error.message 
    });
  }
});

// Admin endpoint to remove user from whitelist
app.delete('/api/admin/whitelist/:email', restrictToServerIP, adminRateLimit, requireAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  if (whitelist.has(email)) {
    whitelist.delete(email);
    saveWhitelist();
    console.log(`🗑️ Removed ${email} from whitelist`);
    res.json({ success: true, message: `Removed ${email} from whitelist` });
  } else {
    res.status(404).json({ error: 'Email not found in whitelist' });
  }
});

// Multer error handling middleware
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    // Clean up any uploaded file on multer errors
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
          console.log(`🧹 Cleaned up file after multer error: ${req.file.filename}`);
        }
      } catch (cleanupError) {
        console.error('Failed to cleanup file after multer error:', cleanupError.message);
      }
    }
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        const maxSizeMB = Math.floor((parseInt(process.env.MAX_FILE_SIZE) || 1073741824) / 1024 / 1024);
        return res.status(413).json({ 
          error: `File size exceeds the maximum limit of ${maxSizeMB}MB`,
          maxSize: maxSizeMB
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({ error: 'Only one file can be uploaded at a time' });
      case 'LIMIT_FIELD_COUNT':
        return res.status(400).json({ error: 'Too many form fields' });
      case 'LIMIT_FIELD_SIZE':
        return res.status(400).json({ error: 'Form field size too large' });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({ error: 'Unexpected file field' });
      default:
        return res.status(400).json({ error: 'File upload error: ' + error.message });
    }
  }
  next(error);
};

// ============================================
// Public Direct Upload Endpoints (No Auth Required)
// ============================================

// Public endpoint to get direct upload link info (validates password)
app.post('/api/direct-upload/:linkId/validate', async (req, res) => {
  try {
    const { linkId } = req.params;
    const { password } = req.body;

    const link = await db.getDirectUploadLink(linkId);

    if (!link) {
      return res.status(404).json({ error: 'Upload link not found' });
    }

    if (!link.enabled) {
      return res.status(403).json({ error: 'This upload link has been disabled' });
    }

    // Check if link requires password (non-null and non-empty string)
    const requiresPassword = link.password !== null && link.password !== '';

    // Check password if required
    if (requiresPassword) {
      if (!password || password !== link.password) {
        return res.status(401).json({
          error: 'Incorrect password',
          requiresPassword: true,
          folderName: link.folderName
        });
      }
    }

    // Return link info without sensitive data
    res.json({
      success: true,
      folderName: link.folderName,
      requiresPassword: requiresPassword
    });
  } catch (error) {
    console.error('Error validating direct upload link:', error);
    res.status(500).json({ error: 'Failed to validate upload link' });
  }
});

// Public endpoint to upload files via direct upload link
app.post('/api/direct-upload/:linkId/upload', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    const { linkId } = req.params;
    const { password } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const link = await db.getDirectUploadLink(linkId);

    if (!link) {
      // Clean up uploaded file
      const filePath = path.join(uploadsDir, req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.status(404).json({ error: 'Upload link not found' });
    }

    if (!link.enabled) {
      // Clean up uploaded file
      const filePath = path.join(uploadsDir, req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.status(403).json({ error: 'This upload link has been disabled' });
    }

    // Check password if required
    if (link.password) {
      if (!password || password !== link.password) {
        // Clean up uploaded file
        const filePath = path.join(uploadsDir, req.file.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return res.status(401).json({ error: 'Incorrect password' });
      }
    }

    // Check if file is a folder
    const isFolder = (
      req.file.size === 0 ||
      req.file.mimetype === 'application/x-directory' ||
      req.file.mimetype === 'text/directory' ||
      !req.file.mimetype ||
      req.file.originalname.endsWith('/') ||
      (req.file.size === 0 && !path.extname(req.file.originalname))
    );

    if (isFolder) {
      const filePath = path.join(uploadsDir, req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.status(400).json({
        error: 'Folder uploads are not supported. Please zip the folder first or upload individual files.'
      });
    }

    // Move file to subfolder based on folder name
    const folderPath = path.join(uploadsDir, link.folderName);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const oldPath = path.join(uploadsDir, req.file.filename);
    const newPath = path.join(folderPath, req.file.filename);

    // Move file to folder
    fs.renameSync(oldPath, newPath);

    // Helper function to determine file type
    const getFileType = (filename) => {
      const ext = path.extname(filename).toLowerCase();
      if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(ext)) return 'audio';
      if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return 'image';
      if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'].includes(ext)) return 'video';
      return 'other';
    };

    const fileId = req.file.filename.replace(path.extname(req.file.filename), '');
    const fileData = {
      id: fileId,
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      fileType: getFileType(req.file.originalname),
      mimeType: req.file.mimetype || null,
      uploadTime: new Date().toISOString(),
      expiryTime: null, // No expiration for direct uploads
      downloadCount: 0,
      isPrivate: true, // Direct uploads are private by default
      folderName: link.folderName,
      uploadedVia: 'direct-upload',
      directUploadLinkId: linkId
    };

    // Add to database under the link creator's account
    await db.addUpload(link.createdBy, fileData);

    // Increment upload count for link
    await db.incrementDirectUploadCount(linkId);

    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

    res.json({
      success: true,
      message: 'File uploaded successfully',
      filename: req.file.originalname,
      size: req.file.size,
      folderName: link.folderName
    });

    console.log(`📤 File uploaded via direct link ${linkId}: ${req.file.originalname} to folder "${link.folderName}"`);
  } catch (error) {
    console.error('Error uploading file via direct link:', error);

    // Clean up file on error
    if (req.file) {
      try {
        // Try original location first
        const originalPath = path.join(uploadsDir, req.file.filename);
        if (fs.existsSync(originalPath)) {
          fs.unlinkSync(originalPath);
        }
      } catch (e) {
        console.error('Error cleaning up file:', e);
      }
    }

    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Serve public direct upload page (no auth required)
app.get('/direct-upload/:linkId', (req, res) => {
  // Always serve the React app and let the frontend handle validation
  const frontendBuildPath = path.join(__dirname, '../frontend/build');
  if (fs.existsSync(frontendBuildPath)) {
    res.sendFile(path.join(frontendBuildPath, 'index.html'));
  } else {
    res.status(503).send('Frontend build not found. Please build the frontend first.');
  }
});

// Upload endpoint (now requires authentication)
app.post('/api/upload', requireAuth, upload.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Check if user tried to upload a folder/directory
    const isFolder = (
      req.file.size === 0 || // Empty files are often directories
      req.file.mimetype === 'application/x-directory' || // Some browsers set this
      req.file.mimetype === 'text/directory' || // Alternative directory mimetype
      !req.file.mimetype || // No mimetype often indicates a directory
      req.file.originalname.endsWith('/') || // Folder names often end with /
      (req.file.size === 0 && !path.extname(req.file.originalname)) // No extension and no size
    );
    
    if (isFolder) {
      // Clean up the uploaded empty file/directory
      const filePath = path.join(uploadsDir, req.file.filename);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (cleanupError) {
        console.warn('Could not clean up directory upload:', cleanupError.message);
      }
      
      return res.status(400).json({ 
        error: 'Folder uploads are not supported. Please zip the folder first or upload individual files.',
        details: 'To upload a folder, please compress it as a ZIP file first.'
      });
    }
    
    // File type validation removed - all file types allowed
    
    const { sendEmailReceipt, isPrivate, retentionTime } = req.body;
    
    // Validate retention time
    const validatedRetentionTime = retentionTime || '24hours';
    if (!validateInput.retentionTime(validatedRetentionTime)) {
      return res.status(400).json({ error: 'Invalid retention time specified' });
    }
    
    const fileId = path.parse(req.file.filename).name;
    const expiryTime = calculateExpiryTime(validatedRetentionTime);
    
    // Parse isPrivate - it comes as string from FormData
    const isFilePrivate = isPrivate === 'true';
    console.log(`📁 Upload: isPrivate=${isPrivate} (${typeof isPrivate}) -> ${isFilePrivate}`);
    
    const fileData = {
      id: fileId,
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      fileType: getFileType(req.file.originalname),
      mimeType: req.file.mimetype,
      uploadTime: new Date(),
      expiryTime: expiryTime,
      downloadCount: 0,
      uploadedBy: req.session.user.email,
      isPrivate: isFilePrivate
    };
    
    // Store in database first - this is critical for data integrity
    try {
      await db.addUpload(req.session.user.email, fileData);
      console.log(`📁 Successfully saved upload ${req.file.originalname} to database for user ${req.session.user.email}`);
    } catch (err) {
      console.error('Failed to save upload to database:', err);
      // Clean up uploaded file if database save fails
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ 
        error: 'Failed to save file metadata to database. Upload aborted.' 
      });
    }
    
    // Store metadata in memory for compatibility
    fileMetadata.set(fileId, fileData);
    
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const downloadLink = `${baseUrl}/preview/${fileId}`;
    
    // Send email notification if checkbox is checked
    // Check if email configuration is available before queuing
    const emailConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
    if (sendEmailReceipt === 'true' && emailConfigured) {
      await sendEmailNotification(req.session.user.email, downloadLink, req.file.originalname, expiryTime);
    }
    
    res.json({
      success: true,
      downloadLink: downloadLink,
      filename: req.file.originalname,
      size: req.file.size,
      expiryTime: expiryTime
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up uploaded file on any error to prevent orphaned files
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
          console.log(`🧹 Cleaned up orphaned file: ${req.file.filename}`);
        }
      } catch (cleanupError) {
        console.error('Failed to cleanup orphaned file:', cleanupError.message);
      }
    }
    
    // Handle specific multer errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maxSizeMB = Math.floor((parseInt(process.env.MAX_FILE_SIZE) || 1073741824) / 1024 / 1024);
      return res.status(413).json({ 
        error: `File size exceeds the maximum limit of ${maxSizeMB}MB`,
        maxSize: maxSizeMB
      });
    }
    
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Only one file can be uploaded at a time' });
    }
    
    if (error.code === 'LIMIT_FIELD_COUNT') {
      return res.status(400).json({ error: 'Too many form fields' });
    }
    
    if (error.code === 'LIMIT_FIELD_SIZE') {
      return res.status(400).json({ error: 'Form field size too large' });
    }
    
    res.status(500).json({ error: 'Upload could not be completed' });
  }
});

// Simplified download endpoint - minimal processing for performance
app.get('/api/download/:fileId', requireAuthForFile, (req, res) => {
  const { fileId } = req.params;
  
  // Basic fileId validation only
  if (!fileId || !/^[a-f0-9\-]{36}$/i.test(fileId)) {
    return res.status(400).json({ error: 'Invalid file ID' });
  }
  
  const metadata = fileMetadata.get(fileId);
  if (!metadata) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Skip expiry check for performance during downloads
  // (expiry will be enforced elsewhere)
  
  // Secure file path construction with validation
  const filePath = validateFilePath(fileId, metadata.filename);
  
  // Skip fs.existsSync - let stream handle file errors
  
  // Update download count asynchronously (don't block download)
  setImmediate(async () => {
    try {
      await db.updateDownloadCount(fileId);
      // Also update in-memory metadata for immediate consistency
      if (metadata) {
        metadata.downloadCount = (metadata.downloadCount || 0) + 1;
        fileMetadata.set(fileId, metadata);
      }
    } catch (error) {
      console.error('Failed to update download count:', error.message);
    }
  });
  
  // Minimal headers for fast downloads
  res.setHeader('Content-Disposition', `attachment; filename="${metadata.originalName}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  
  // Simple file streaming without error handling overhead
  const fileStream = fs.createReadStream(filePath);
  res.on('close', () => fileStream.destroy());
  fileStream.pipe(res);
});

// File info endpoint (conditional auth based on file protection)
app.get('/api/info/:fileId', requireAuthForFile, (req, res) => {
  const { fileId } = req.params;
  
  try {
    // Validate fileId for security
    validateFilePath(fileId);
  } catch (error) {
    console.warn(`🚨 Path traversal attempt blocked: ${error.message} (fileId: ${fileId})`);
    return res.status(400).json({ error: 'Invalid file ID' });
  }
  
  const metadata = fileMetadata.get(fileId);
  
  if (!metadata) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Check if file has expired
  if (metadata.expiryTime && new Date() > metadata.expiryTime) {
    return res.status(404).json({ error: 'File has expired' });
  }
  
  res.json({
    originalName: metadata.originalName,
    size: metadata.size,
    uploadTime: metadata.uploadTime,
    expiryTime: metadata.expiryTime,
    downloadCount: metadata.downloadCount,
    isPrivate: metadata.isPrivate !== false && metadata.loginProtected !== false // Support both field names
  });
});

// Cleanup expired pending requests and files every hour
cron.schedule('0 * * * *', async () => {
  console.log('🧹 Running cleanup task...');
  let cleanedCount = 0;
  
  try {
    // Clean up expired pending requests (older than 30 minutes)
    const now = new Date();
    let expiredRequestsCount = 0;
    
    for (const [requestId, request] of pendingRequests.entries()) {
      const timeDiff = now - new Date(request.timestamp);
      if (timeDiff > 30 * 60 * 1000) { // 30 minutes
        console.log(`🗑️ Removing expired pending request: ${request.email}`);
        if (request.resolve) {
          request.resolve(false);
        }
        pendingRequests.delete(requestId);
        expiredRequestsCount++;
      }
    }
    
    if (expiredRequestsCount > 0) {
      console.log(`🧹 Cleaned up ${expiredRequestsCount} expired pending requests`);
    }
    
    // Enforce memory limits
    enforceMemoryLimits();
  
    // Clean from database first
    const dbCleanedCount = await db.removeExpiredFiles();
    
    // Clean from memory and disk with path validation
    for (const [fileId, metadata] of fileMetadata.entries()) {
      if (metadata.expiryTime && new Date() > metadata.expiryTime) {
        // Delete file from disk with secure path validation
        try {
          const secureFilePath = validateFilePath(fileId, metadata.filename);
          if (fs.existsSync(secureFilePath)) {
            try {
              fs.unlinkSync(secureFilePath);
              console.log(`🗑️ Deleted expired file: ${metadata.originalName}`);
              cleanedCount++;
            } catch (error) {
              console.error(`❌ Error deleting file ${secureFilePath}:`, error);
            }
          }
        } catch (error) {
          console.warn(`🚨 Skipping cleanup of potentially malicious file path: ${error.message} (fileId: ${fileId}, filename: ${metadata.filename})`);
        }
        
        // Remove from memory
        fileMetadata.delete(fileId);
      }
    }
    
    const totalCleaned = Math.max(cleanedCount, dbCleanedCount);
    if (totalCleaned > 0) {
      console.log(`🧹 Cleanup completed. Removed ${totalCleaned} expired files.`);
    }
  } catch (error) {
    console.error('❌ Error during cleanup task:', error);
  }
});

// Helper function to escape HTML entities (prevent XSS)
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper function to determine file type from filename
function getFileTypeFromFilename(filename) {
  if (!filename) return 'document';
  const ext = path.extname(filename).toLowerCase();

  const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'];
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.ogv'];

  if (audioExts.includes(ext)) return 'audio';
  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  return 'document';
}

// Helper function to get MIME type from filename (for Open Graph tags)
function getMimeTypeFromFilename(filename) {
  if (!filename) return 'image/jpeg';
  const ext = path.extname(filename).toLowerCase();

  // Image MIME types
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    // Video MIME types (for og:video)
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.flv': 'video/x-flv',
    '.wmv': 'video/x-ms-wmv',
    // Audio MIME types
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4'
  };

  return mimeTypes[ext] || 'image/jpeg';
}

// Preview endpoint with Open Graph meta tags for rich link previews
app.get('/preview/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const frontendBuildPath = path.join(__dirname, '../frontend/build');
  const indexPath = path.join(frontendBuildPath, 'index.html');

  // Check if frontend build exists
  if (!fs.existsSync(frontendBuildPath)) {
    return res.status(500).send('Frontend not available');
  }

  // Helper function to serve default HTML (fallback)
  const serveDefaultHtml = () => {
    return res.sendFile(indexPath);
  };

  try {
    // Validate fileId format (UUID v4)
    if (!fileId || !/^[a-f0-9\-]{36}$/i.test(fileId)) {
      return serveDefaultHtml();
    }

    // Fetch file metadata from database
    const fileData = await db.getUploadById(fileId);

    // If file doesn't exist, serve default HTML
    if (!fileData) {
      return serveDefaultHtml();
    }

    // If file is private, serve default HTML (protect metadata)
    if (fileData.isPrivate) {
      return serveDefaultHtml();
    }

    // Check if file has expired
    if (fileData.expiryTime && new Date() > new Date(fileData.expiryTime)) {
      return serveDefaultHtml();
    }

    // PUBLIC FILE - Generate Open Graph meta tags
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const fileType = getFileTypeFromFilename(fileData.originalName);

    // Determine OG image/media URL and properties
    let ogImage = `${baseUrl}/logo192.png`; // Default fallback
    let ogImageType = 'image/png'; // Default for fallback
    let ogImageWidth = '192';
    let ogImageHeight = '192';
    let ogVideoTag = '';

    // For images and videos, use the dedicated OG image endpoint (optimized for social media scrapers)
    if (fileType === 'image') {
      ogImage = `${baseUrl}/api/og-image/${fileId}`;
      ogImageType = getMimeTypeFromFilename(fileData.originalName);
      // Use Facebook's recommended dimensions for images
      ogImageWidth = '1200';
      ogImageHeight = '630';
    } else if (fileType === 'video') {
      ogImage = `${baseUrl}/api/og-image/${fileId}`;
      // For videos, og:image is still an image type (the thumbnail/poster)
      ogImageType = 'image/jpeg';
      ogImageWidth = '1280';
      ogImageHeight = '720';

      // Add video-specific OG tags for better embedding (still use /api/stream for actual video)
      const videoMimeType = getMimeTypeFromFilename(fileData.originalName);
      ogVideoTag = `
    <meta property="og:video" content="${baseUrl}/api/stream/${fileId}" />
    <meta property="og:video:secure_url" content="${baseUrl}/api/stream/${fileId}" />
    <meta property="og:video:type" content="${videoMimeType}" />
    <meta property="og:video:width" content="1280" />
    <meta property="og:video:height" content="720" />`;
    }

    // Build Open Graph meta tags with explicit image properties (required by Facebook)
    const ogTags = `
    <!-- Open Graph Meta Tags for Rich Previews -->
    <meta property="og:title" content="${escapeHtml(fileData.originalName)}" />
    <meta property="og:description" content="Shared via Leo's File Sharing" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:width" content="${ogImageWidth}" />
    <meta property="og:image:height" content="${ogImageHeight}" />
    <meta property="og:image:type" content="${ogImageType}" />
    <meta property="og:image:alt" content="${escapeHtml(fileData.originalName)}" />
    <meta property="og:url" content="${baseUrl}/preview/${fileId}" />
    <meta property="og:type" content="${fileType === 'video' ? 'video.other' : 'website'}" />
    <meta property="og:site_name" content="Leo's' File Sharing" />${ogVideoTag}

    <!-- Twitter Card Meta Tags -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(fileData.originalName)}" />
    <meta name="twitter:description" content="Shared via Leo's' File Sharing" />
    <meta name="twitter:image" content="${ogImage}" />
    `;

    // Read the index.html file
    let html = fs.readFileSync(indexPath, 'utf8');

    // Inject OG tags before </head>
    html = html.replace('</head>', `${ogTags}</head>`);

    // Also update the page title for better UX
    const titleTag = `<title>${escapeHtml(fileData.originalName)} - Leo's File Sharing</title>`;
    html = html.replace(/<title>.*?<\/title>/, titleTag);

    // Set cache headers (social media bots cache preview data)
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    // Send the modified HTML
    res.send(html);

  } catch (error) {
    console.error('Error generating preview with OG tags:', error);
    // Fallback to default HTML on any error
    return serveDefaultHtml();
  }
});

// Simplified high-performance stream endpoint for media files
app.get('/api/stream/:fileId', requireAuthForFile, (req, res) => {
  const { fileId } = req.params;
  
  // Minimal validation - just check fileId format
  if (!fileId || !/^[a-f0-9\-]{36}$/i.test(fileId)) {
    return res.status(400).json({ error: 'Invalid file ID' });
  }
  
  // Quick metadata check (no database operations)
  const metadata = fileMetadata.get(fileId);
  if (!metadata) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Skip expiry check during playback for performance
  // (expiry will be checked on initial file access)
  
  // Secure file path construction with validation
  const filePath = validateFilePath(fileId, metadata.filename);
  
  // Skip fs.existsSync check - let stream handle file not found
  // This eliminates blocking I/O operation during concurrent playbacks
  
  let fileSize;
  try {
    // Only get file size when needed for range requests
    const stat = fs.statSync(filePath);
    fileSize = stat.size;
  } catch (err) {
    return res.status(404).json({ error: 'File not accessible' });
  }
  
  const range = req.headers.range;
  
  // Quick MIME type lookup
  const extension = path.extname(metadata.filename).toLowerCase();
  const mimeType = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/x-wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'
  }[extension] || 'application/octet-stream';
  
  // Headers for cross-platform streaming compatibility
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Additional headers for audio compatibility on desktop browsers
  if (mimeType.startsWith('audio/')) {
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  }
  
  // Simplified range handling for high-performance streaming
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10) || 0;
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    
    // Basic range validation
    if (start >= fileSize || start < 0) {
      res.status(416).end();
      return;
    }
    
    const actualEnd = Math.min(end, fileSize - 1);
    const chunksize = (actualEnd - start) + 1;
    
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${actualEnd}/${fileSize}`);
    res.setHeader('Content-Length', chunksize);
    
    const stream = fs.createReadStream(filePath, { start, end: actualEnd });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } else {
    // Serve full file
    res.setHeader('Content-Length', fileSize);
    const stream = fs.createReadStream(filePath);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbStats = db.getStats();
  res.json({ 
    status: 'ok', 
    filesStored: fileMetadata.size,
    emailEnabled: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    database: {
      totalUsers: dbStats.totalUsers,
      totalUploads: dbStats.totalUploads,
      totalSize: dbStats.totalSize,
      lastSaved: dbStats.lastSaved
    }
  });
});

// Serve React app for all other routes in production
if (fs.existsSync(frontendBuildPath)) {
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      // ADDITIONAL SECURITY CHECK - Block admin-related paths for unauthenticated users
      const isAdminPath = req.path.includes('admin') || req.path.includes('users') || req.path.startsWith('/admin');
      
      if (isAdminPath && !req.session.user) {
        console.log(`🚫 [SECURITY] Blocked unauthenticated access to admin path: ${req.path} from IP: ${req.ip || req.connection.remoteAddress}`);
        return res.status(401).json({ error: 'Authentication required for admin paths' });
      }
      
      // Additional check for admin users on admin paths
      if (isAdminPath && req.session.user) {
        const adminEmails = process.env.ADMIN_EMAILS ? 
          process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : 
          [process.env.ADMIN_EMAIL || ''].filter(Boolean);
        
        if (!adminEmails.includes(req.session.user.email)) {
          console.log(`🚫 [SECURITY] Blocked non-admin user ${req.session.user.email} from admin path: ${req.path}`);
          return res.status(403).json({ error: 'Admin access required' });
        }
      }
      
      res.sendFile(path.join(frontendBuildPath, 'index.html'));
    }
  });
}

// SSL Configuration
let httpsServer, httpServer;

// Check if SSL certificates exist
const sslCertPath = process.env.SSL_CERT_PATH || './ssl/certificate.crt';
const sslKeyPath = process.env.SSL_KEY_PATH || './ssl/private.key';
const sslCaPath = process.env.SSL_CA_PATH || './ssl/ca_bundle.crt';

const sslCertExists = fs.existsSync(sslCertPath);
const sslKeyExists = fs.existsSync(sslKeyPath);

if (sslCertExists && sslKeyExists) {
  console.log('🔒 SSL certificates found, starting HTTPS server...');
  
  // Read SSL certificates
  const sslOptions = {
    cert: fs.readFileSync(sslCertPath),
    key: fs.readFileSync(sslKeyPath)
  };
  
  // Add CA bundle if it exists
  if (fs.existsSync(sslCaPath)) {
    sslOptions.ca = fs.readFileSync(sslCaPath);
  }
  
  // Start HTTPS server
  httpsServer = https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`\n🚀 LeoShare File Sharing Server (HTTPS)`);
    console.log(`📍 Running securely on: https://leoshare.dk:${PORT === 443 ? '' : PORT}`);
    console.log(`📁 Upload directory: ${uploadsDir}`);
    const emailConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
    console.log(`📧 Email notifications: ${emailConfigured ? 'enabled' : 'DISABLED - Check SMTP settings'}`);
  });
  
  // HTTP to HTTPS redirect server
  const httpPort = process.env.HTTP_PORT || 80;
  httpServer = http.createServer((req, res) => {
    const host = req.headers.host?.replace(/:\d+$/, ''); // Remove port from host
    const httpsUrl = `https://${host}${req.url}`;
    console.log(`🔀 Redirecting HTTP to HTTPS: ${req.url} -> ${httpsUrl}`);
    res.writeHead(301, { Location: httpsUrl });
    res.end();
  }).listen(httpPort, () => {
    console.log(`🔀 HTTP redirect server running on port ${httpPort}`);
  });
  
} else {
  console.log('⚠️  SSL certificates not found, starting HTTP server...');
  console.log(`⚠️  Expected certificate at: ${sslCertPath}`);
  console.log(`⚠️  Expected private key at: ${sslKeyPath}`);
  
  // Fallback to HTTP
  httpServer = app.listen(PORT, () => {
    console.log(`\n🚀 LeoShare File Sharing Server (HTTP - No SSL)`);
    console.log(`📍 Running on: http://leoshare.dk:${PORT}`);
    console.log(`📁 Upload directory: ${uploadsDir}`);
    const emailConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
    console.log(`📧 Email notifications: ${emailConfigured ? 'enabled' : 'DISABLED - Check SMTP settings'}`);
  console.log(`👥 Approved users: ${whitelist.size}`);
  console.log(`💾 Whitelist file: ${whitelistPath}`);
  if (fs.existsSync(frontendBuildPath)) {
    console.log('🎨 Serving React frontend from build folder');
  }
  console.log('\n📋 Admin endpoints:');
  console.log(`   GET /api/admin/users - View all users (approved/unapproved)`);
  console.log(`   GET /api/admin/whitelist - View approved users`);
  console.log(`   POST /api/admin/approve-user/:email - Approve user directly`);
  console.log(`   POST /api/admin/decline-user/:email - Unapprove user directly`);
  console.log(`   POST /api/admin/remove-user/:email - PERMANENTLY remove user & files`);
  console.log(`   DELETE /api/admin/whitelist/:email - Remove user from whitelist only`);
  console.log(`   GET /api/admin/test-email - Test email configuration`);
  
  // Check email configuration
  const emailConfigValid = validateEmailConfig();
  if (emailConfigValid) {
    console.log('\n📧 Email system enabled with queue');
    console.log(`   Approval emails will be sent to: ${process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'NOT CONFIGURED - PLEASE SET ADMIN_EMAIL'}`);
    console.log(`   Queue status endpoint: GET /api/admin/email-queue`);
  } else {
    console.log('\n❌ EMAIL SYSTEM LIMITED');
    console.log('   Set SMTP_HOST, SMTP_USER, and SMTP_PASS in environment variables');
    console.log('   Users will not be able to request access until email is configured');
  }
  
  console.log('\n⏳ Waiting for login requests...\n');
  });
}

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, shutting down gracefully...');
  if (httpsServer) {
    httpsServer.close(() => {
      console.log('✅ HTTPS server closed');
      if (httpServer) {
        httpServer.close(() => {
          console.log('✅ HTTP redirect server closed');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
  } else if (httpServer) {
    httpServer.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received, shutting down gracefully...');
  if (httpsServer) {
    httpsServer.close(() => {
      console.log('✅ HTTPS server closed');
      if (httpServer) {
        httpServer.close(() => {
          console.log('✅ HTTP redirect server closed');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
  } else if (httpServer) {
    httpServer.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
  }
});