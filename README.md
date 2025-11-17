# LeoShare File Sharing

A minimalistic file sharing web application with a sci-fi aesthetic, built for personal use on Windows 11 server.

Built for personal use and to showcase a prompt engineered solution. Not intended or built for easy use if cloned, but you are welcome to.

## Features

- **Simple Upload**: Drag and drop or click to upload files
- **Flexible Retention**: Choose from 1 hour to permanent storage
- **Email Notifications**: Optional email notifications with download links
- **Automatic Cleanup**: Files are automatically deleted when expired
- **Direct Downloads**: Secure direct download links with path traversal protection
- **File Size Limits**: Configurable maximum file size (default 1GB)
- **Minimalist Design**: Clean sci-fi inspired interface
- **OAuth Authentication**: Google OAuth integration with email approval system
- **Security Hardened**: Environment-based configuration and comprehensive path validation

## Tech Stack

- **Frontend**: React with minimalist CSS styling
- **Backend**: Node.js with Express
- **Authentication**: Google OAuth 2.0 with email approval workflow
- **Database**: JSON-based file database with in-memory caching
- **File Storage**: Local disk storage with UUID-based filenames
- **Email**: Nodemailer for SMTP notifications and approval requests
- **Scheduling**: node-cron for automated cleanup and maintenance
- **Security**: Path traversal protection and environment-based configuration

## Installation

### Prerequisites
- Node.js (v16 or higher) - Download from [nodejs.org](https://nodejs.org/)
- npm (comes with Node.js)

### Quick Setup (Windows)

1. **Copy the project files** to your Windows 11 server

2. **Run the setup script**
   ```cmd
   setup.bat
   ```
   This will:
   - Check for Node.js and npm
   - Install all dependencies
   - Build the frontend for production

3. **Configure environment variables**
   Create `backend\.env` with your configuration:
   ```env
   # Server Configuration
   PORT=80
   BASE_URL=https://leoshare.dk
   FRONTEND_URL=https://leoshare.dk
   
   # Security Configuration (REQUIRED for production)
   SESSION_SECRET=your-secure-random-session-secret
   CORS_ORIGIN=https://leoshare.dk
   ADMIN_EMAIL=your-admin@example.com
   
   # Google OAuth (REQUIRED)
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   GOOGLE_REDIRECT_URI=https://leoshare.dk/auth/google/callback
   
   # SMTP Configuration (REQUIRED for user approvals)
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   SMTP_FROM=your-email@gmail.com
   
   # File Storage
   UPLOAD_PATH=./uploads
   MAX_FILE_SIZE=1073741824
   ```

### Manual Installation

If you prefer manual setup:

1. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   ```

3. **Build frontend**
   ```bash
   npm run build
   ```

## Running the Application

### Production Mode (Recommended)
```cmd
start-production.bat
```
This serves both the backend API and frontend from the same server on port 80.

### Development Mode
1. **Start the backend server**
   ```bash
   cd backend
   node server.js
   ```

2. **Start the frontend development server** (in a new terminal)
   ```bash
   cd frontend
   npm start
   ```

### Alternative Start Scripts
- `start.bat` - Development mode on port 3001
- `start-production-port80.bat` - Production mode on port 80 (requires admin privileges)
- `shutdown.bat` - Stop all running processes

## Configuration

### Environment Variables

#### Server Configuration
- `PORT`: Backend server port (default: 80)
- `BASE_URL`: Public URL for download links (e.g., https://leoshare.dk)
- `FRONTEND_URL`: Frontend URL for redirects (e.g., https://leoshare.dk)

#### Security Configuration (REQUIRED for production)
- `SESSION_SECRET`: Random string for session encryption
- `CORS_ORIGIN`: Allowed CORS origin (e.g., https://leoshare.dk)
- `ADMIN_EMAIL`: Admin email for approval notifications

#### Authentication (REQUIRED)
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `GOOGLE_REDIRECT_URI`: OAuth callback URL

#### Email (REQUIRED for user approvals)
- `SMTP_HOST`: SMTP server hostname
- `SMTP_PORT`: SMTP server port (default: 587)
- `SMTP_USER`: SMTP username
- `SMTP_PASS`: SMTP password (use app passwords for Gmail)
- `SMTP_FROM`: From email address

#### File Storage
- `UPLOAD_PATH`: Directory to store uploaded files (default: ./uploads)
- `MAX_FILE_SIZE`: Maximum file size in bytes (default: 1GB)

### File Retention Options

- 1 hour
- 5 hours  
- 12 hours
- 24 hours
- Permanent

## API Endpoints

### File Operations
- `POST /api/upload` - Upload a file (requires authentication)
- `GET /api/download/:fileId` - Download a file (conditional auth based on file privacy)
- `GET /api/info/:fileId` - Get file information (conditional auth)
- `GET /api/stream/:fileId` - Stream media files (conditional auth)
- `DELETE /api/files/:fileId` - Delete user's file (requires authentication)

### Authentication
- `GET /auth/google` - Initiate Google OAuth login
- `GET /auth/google/callback` - OAuth callback endpoint
- `GET /api/auth/status` - Check authentication status
- `POST /api/auth/logout` - Logout user

### User Management
- `GET /api/my-files` - Get user's uploaded files (requires authentication)

### Admin Endpoints
- `GET /api/admin/approve/:requestId` - Approve user access (email link)
- `GET /api/admin/decline/:requestId` - Decline user access (email link)
- `GET /api/admin/whitelist` - View approved users
- `DELETE /api/admin/whitelist/:email` - Remove user from whitelist
- `GET /api/admin/test-email` - Test email configuration

### System
- `GET /api/health` - Health check and system status
- `GET /preview/:fileId` - File preview page (public)

## Security Features

### 🔒 Authentication & Authorization
- **Google OAuth 2.0** integration for secure user authentication
- **Email approval workflow** - admin must approve new users via email links
- **Session-based authentication** with configurable session secrets
- **Whitelist system** - only approved users can upload files

### 🛡️ Path Traversal Protection
- **UUID validation** - file IDs must match UUID patterns only
- **Filename sanitization** - prevents `../` and other dangerous patterns
- **Directory boundary enforcement** - all operations confined to uploads directory
- **Security logging** - all path traversal attempts are logged with warnings

### 🔐 Environment-Based Security
- **Configurable admin email** - no hardcoded administrator contacts
- **CORS origin control** - configurable allowed origins
- **Session secret management** - proper session encryption in production
- **Security warnings** - alerts when using fallback/development settings

### 🗃️ File Security
- **UUID-based filenames** - prevents filename enumeration attacks
- **Conditional authentication** - public/private file access control
- **Automatic expiry cleanup** - prevents unauthorized access to expired files
- **No directory listing** - prevents file system exploration

## Production Deployment

### Windows 11 Server Setup

1. **Prerequisites**
   - Install Node.js (v16+) and npm
   - Configure Windows Firewall to allow port 80
   - Set up port forwarding on router for external access
   - Create Google OAuth 2.0 credentials

2. **Security Setup**
   - Generate a strong `SESSION_SECRET` (use a password generator)
   - Configure `ADMIN_EMAIL` for approval notifications
   - Set proper `CORS_ORIGIN` for your domain
   - Use app passwords for Gmail SMTP authentication

3. **Process Management**
   For production reliability, use PM2:
   ```bash
   npm install -g pm2
   pm2 start backend/server.js --name "leoshare-filesharing"
   pm2 startup
   pm2 save
   ```

4. **Monitoring & Logs**
   ```bash
   pm2 logs leoshare-filesharing
   pm2 monit
   ```

### Security Checklist

- [ ] Generate random `SESSION_SECRET` (not the default)
- [ ] Set `ADMIN_EMAIL` to your actual admin email
- [ ] Configure `CORS_ORIGIN` to match your domain
- [ ] Enable SMTP for user approval emails
- [ ] Set up Google OAuth with your domain
- [ ] Test email notifications work
- [ ] Monitor logs for security warnings (`🚨` messages)
- [ ] Set up regular backups of user database and whitelist

### Files to Monitor

- `backend/database.json` - User and file database
- `backend/whitelist.json` - Approved user list
- `backend/uploads/` - Uploaded files directory
- Server logs for security events

## License

Private use only.
