const fs = require('fs');
const path = require('path');

class FileDatabase {
  constructor(dbPath = path.join(__dirname, 'database.json')) {
    this.dbPath = dbPath;
    this.lockPath = `${dbPath}.lock`;
    this.writeQueue = [];
    this.isWriting = false;
    this.data = {
      users: {},
      collections: {},
      directUploadLinks: {},
      metadata: {
        version: '2.0',
        lastSaved: new Date().toISOString()
      }
    };
    this.loadDatabase();
  }

  loadDatabase() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const fileContent = fs.readFileSync(this.dbPath, 'utf8');
        this.data = JSON.parse(fileContent);
        console.log(`📋 Loaded database with ${Object.keys(this.data.users).length} users`);
        
        // Migrate existing users to new schema
        this.migrateToNewSchema();
      } else {
        console.log('📋 No existing database found, starting fresh');
        // Save database will be called when first data is added
      }
    } catch (error) {
      console.error('❌ Error loading database:', error);
      this.data = {
        users: {},
        collections: {},
        metadata: {
          version: '2.0',
          lastSaved: new Date().toISOString()
        }
      };
    }
  }

  migrateToNewSchema() {
    let migrationNeeded = false;

    // Initialize collections if not present
    if (!this.data.collections) {
      this.data.collections = {};
      migrationNeeded = true;
      console.log('🔄 Added collections to database schema');
    }

    // Initialize directUploadLinks if not present
    if (!this.data.directUploadLinks) {
      this.data.directUploadLinks = {};
      migrationNeeded = true;
      console.log('🔄 Added directUploadLinks to database schema');
    }
    
    // Migrate users to new schema
    Object.entries(this.data.users).forEach(([email, user]) => {
      // Add approval fields if missing
      if (!user.hasOwnProperty('approved')) {
        user.approved = true; // Existing users are considered pre-approved
        user.createdAt = user.createdAt || new Date().toISOString();
        user.approvedAt = new Date().toISOString();
        migrationNeeded = true;
        console.log(`🔄 Migrated existing user to new schema: ${email}`);
      }
      
      // Add new fields for social features
      if (!user.hasOwnProperty('collections')) {
        user.collections = [];
        migrationNeeded = true;
      }
      if (!user.hasOwnProperty('subscribedFiles')) {
        user.subscribedFiles = [];
        migrationNeeded = true;
      }
      if (!user.hasOwnProperty('subscribedCollections')) {
        user.subscribedCollections = [];
        migrationNeeded = true;
      }
      if (!user.hasOwnProperty('profilePublic')) {
        user.profilePublic = true; // Default to public profiles
        migrationNeeded = true;
      }
      
      // Add file type to existing uploads
      if (user.uploads) {
        user.uploads.forEach(upload => {
          if (!upload.fileType) {
            upload.fileType = this.getFileType(upload.originalName);
            migrationNeeded = true;
          }
        });
      }
    });
    
    // Update version if needed
    if (!this.data.metadata.version || this.data.metadata.version !== '2.0') {
      this.data.metadata.version = '2.0';
      migrationNeeded = true;
    }
    
    if (migrationNeeded) {
      this.saveDatabase().catch(err => 
        console.error('❌ Error saving database after migration:', err)
      );
      console.log('✅ Database migration to v2.0 completed');
    }
  }
  
  getFileType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(ext)) return 'audio';
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return 'image';
    if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'].includes(ext)) return 'video';
    return 'other';
  }

  async saveDatabase() {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ resolve, reject });
      this.processWriteQueue();
    });
  }

  async processWriteQueue() {
    if (this.isWriting || this.writeQueue.length === 0) {
      return;
    }

    this.isWriting = true;
    const currentWrite = this.writeQueue.shift();

    try {
      // Check for lock file and wait if necessary
      await this.waitForLock();
      
      // Create lock file
      fs.writeFileSync(this.lockPath, process.pid.toString());
      
      // Reload data before writing to get latest changes
      if (fs.existsSync(this.dbPath)) {
        try {
          const fileContent = fs.readFileSync(this.dbPath, 'utf8');
          const diskData = JSON.parse(fileContent);
          
          // Merge any new users from disk that aren't in memory
          Object.keys(diskData.users || {}).forEach(email => {
            if (!this.data.users[email]) {
              this.data.users[email] = diskData.users[email];
            }
          });
        } catch (error) {
          console.warn('⚠️ Could not read existing database for merge, proceeding with in-memory data');
        }
      }

      // Update metadata and write
      this.data.metadata.lastSaved = new Date().toISOString();
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
      
      // Remove lock file
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
      
      console.log(`💾 Database saved with ${Object.keys(this.data.users).length} users`);
      currentWrite.resolve();
    } catch (error) {
      // Clean up lock on error
      if (fs.existsSync(this.lockPath)) {
        try {
          fs.unlinkSync(this.lockPath);
        } catch (unlinkError) {
          console.error('❌ Error removing lock file:', unlinkError);
        }
      }
      console.error('❌ Error saving database:', error);
      currentWrite.reject(error);
    } finally {
      this.isWriting = false;
      // Process next item in queue
      setImmediate(() => this.processWriteQueue());
    }
  }

  async waitForLock(maxWait = 5000) {
    const startTime = Date.now();
    while (fs.existsSync(this.lockPath) && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // If lock still exists after timeout, force remove it (might be stale)
    if (fs.existsSync(this.lockPath)) {
      console.warn('⚠️ Database lock timeout, force removing stale lock file');
      try {
        fs.unlinkSync(this.lockPath);
      } catch (error) {
        console.error('❌ Could not remove stale lock file:', error.message);
        throw new Error('Database lock timeout - could not acquire lock');
      }
    }
    
  }

  async addUser(email, name, approved = false) {
    if (!this.data.users[email]) {
      this.data.users[email] = {
        name: name,
        uploads: [],
        collections: [],
        subscribedFiles: [],
        subscribedCollections: [],
        profilePublic: true,
        approved: approved,
        createdAt: new Date().toISOString(),
        approvedAt: approved ? new Date().toISOString() : null
      };
      await this.saveDatabase();
      console.log(`👤 Added new user: ${email} (${approved ? 'approved' : 'pending approval'})`);
    }
    return this.data.users[email];
  }

  async approveUser(email) {
    if (this.data.users[email]) {
      this.data.users[email].approved = true;
      this.data.users[email].approvedAt = new Date().toISOString();
      await this.saveDatabase();
      console.log(`✅ User approved: ${email}`);
      return true;
    }
    return false;
  }

  getUserApprovalStatus(email) {
    const user = this.data.users[email];
    if (!user) return null; // User doesn't exist
    return {
      exists: true,
      approved: user.approved,
      name: user.name,
      createdAt: user.createdAt,
      approvedAt: user.approvedAt
    };
  }

  getUnapprovedUsers() {
    return Object.entries(this.data.users)
      .filter(([email, user]) => !user.approved)
      .map(([email, user]) => ({
        email,
        name: user.name,
        createdAt: user.createdAt
      }));
  }

  async addUpload(userEmail, fileData) {
    if (!this.data.users[userEmail]) {
      await this.addUser(userEmail, 'Unknown User');
    }

    this.data.users[userEmail].uploads.push({
      id: fileData.id,
      originalName: fileData.originalName,
      filename: fileData.filename,
      size: fileData.size,
      uploadTime: fileData.uploadTime,
      expiryTime: fileData.expiryTime,
      downloadCount: fileData.downloadCount || 0,
      isPrivate: fileData.isPrivate,
      fileType: this.getFileType(fileData.originalName)
    });

    await this.saveDatabase();
    console.log(`📁 Added upload ${fileData.originalName} for user ${userEmail}`);
  }

  getUploadById(fileId) {
    for (const email in this.data.users) {
      const upload = this.data.users[email].uploads.find(upload => upload.id === fileId);
      if (upload) {
        return { ...upload, uploadedBy: email };
      }
    }
    return null;
  }

  getUserUploads(userEmail) {
    if (!this.data.users[userEmail]) {
      return [];
    }
    return this.data.users[userEmail].uploads.map(upload => ({
      ...upload,
      uploadedBy: userEmail
    }));
  }

  getAllUploads() {
    const allUploads = new Map();
    for (const email in this.data.users) {
      this.data.users[email].uploads.forEach(upload => {
        allUploads.set(upload.id, { ...upload, uploadedBy: email });
      });
    }
    return allUploads;
  }

  async updateDownloadCount(fileId) {
    for (const email in this.data.users) {
      const uploadIndex = this.data.users[email].uploads.findIndex(upload => upload.id === fileId);
      if (uploadIndex !== -1) {
        this.data.users[email].uploads[uploadIndex].downloadCount++;
        await this.saveDatabase();
        return this.data.users[email].uploads[uploadIndex].downloadCount;
      }
    }
    return 0;
  }

  async removeUpload(fileId) {
    for (const email in this.data.users) {
      const uploadIndex = this.data.users[email].uploads.findIndex(upload => upload.id === fileId);
      if (uploadIndex !== -1) {
        const removedUpload = this.data.users[email].uploads.splice(uploadIndex, 1)[0];
        await this.saveDatabase();
        console.log(`🗑️ Removed upload ${removedUpload.originalName} for user ${email}`);
        return removedUpload;
      }
    }
    return null;
  }

  async removeExpiredFiles() {
    let removedCount = 0;
    const now = new Date();

    for (const email in this.data.users) {
      const user = this.data.users[email];
      const initialLength = user.uploads.length;
      
      user.uploads = user.uploads.filter(upload => {
        if (upload.expiryTime && new Date(upload.expiryTime) <= now) {
          console.log(`🗑️ Removing expired file: ${upload.originalName} (${email})`);
          return false;
        }
        return true;
      });

      removedCount += initialLength - user.uploads.length;
    }

    if (removedCount > 0) {
      await this.saveDatabase();
      console.log(`🧹 Cleanup: Removed ${removedCount} expired files from database`);
    }

    return removedCount;
  }

  getStats() {
    let totalUsers = 0;
    let totalUploads = 0;
    let totalSize = 0;

    for (const email in this.data.users) {
      totalUsers++;
      const uploads = this.data.users[email].uploads;
      totalUploads += uploads.length;
      totalSize += uploads.reduce((sum, upload) => sum + (upload.size || 0), 0);
    }

    return {
      totalUsers,
      totalUploads,
      totalSize,
      lastSaved: this.data.metadata.lastSaved
    };
  }

  async migrateFromMemory(fileMetadata) {
    console.log('🔄 Migrating in-memory data to database...');
    let migratedCount = 0;

    for (const [fileId, metadata] of fileMetadata.entries()) {
      const userEmail = metadata.uploadedBy;
      if (userEmail) {
        if (!this.data.users[userEmail]) {
          await this.addUser(userEmail, 'Migrated User');
        }

        const existingUpload = this.data.users[userEmail].uploads.find(upload => upload.id === fileId);
        if (!existingUpload) {
          this.data.users[userEmail].uploads.push({
            id: fileId,
            originalName: metadata.originalName,
            filename: metadata.filename,
            size: metadata.size,
            uploadTime: metadata.uploadTime,
            expiryTime: metadata.expiryTime,
            downloadCount: metadata.downloadCount || 0,
            isPrivate: metadata.isPrivate
          });
          migratedCount++;
        }
      }
    }

    await this.saveDatabase();
    console.log(`✅ Migration complete: ${migratedCount} files migrated to database`);
    return migratedCount;
  }

  // Collection management methods
  async createCollection(userEmail, name, description = '') {
    const collectionId = require('uuid').v4();
    const collection = {
      id: collectionId,
      name: name,
      description: description,
      createdBy: userEmail,
      createdAt: new Date().toISOString(),
      files: [],
      isPublic: true
    };
    
    this.data.collections[collectionId] = collection;
    
    if (!this.data.users[userEmail].collections) {
      this.data.users[userEmail].collections = [];
    }
    this.data.users[userEmail].collections.push(collectionId);
    
    await this.saveDatabase();
    console.log(`📚 Created collection: ${name} for user ${userEmail}`);
    return collection;
  }
  
  async addFileToCollection(collectionId, fileId) {
    if (this.data.collections[collectionId] && !this.data.collections[collectionId].files.includes(fileId)) {
      this.data.collections[collectionId].files.push(fileId);
      await this.saveDatabase();
      return true;
    }
    return false;
  }
  
  async removeFileFromCollection(collectionId, fileId) {
    if (this.data.collections[collectionId]) {
      const index = this.data.collections[collectionId].files.indexOf(fileId);
      if (index > -1) {
        this.data.collections[collectionId].files.splice(index, 1);
        await this.saveDatabase();
        return true;
      }
    }
    return false;
  }
  
  async deleteCollection(collectionId, userEmail) {
    const collection = this.data.collections[collectionId];
    if (collection && collection.createdBy === userEmail) {
      delete this.data.collections[collectionId];
      
      // Remove from user's collections list
      if (this.data.users[userEmail].collections) {
        const index = this.data.users[userEmail].collections.indexOf(collectionId);
        if (index > -1) {
          this.data.users[userEmail].collections.splice(index, 1);
        }
      }
      
      // Remove from all users' subscribed collections
      Object.values(this.data.users).forEach(user => {
        if (user.subscribedCollections) {
          const subIndex = user.subscribedCollections.indexOf(collectionId);
          if (subIndex > -1) {
            user.subscribedCollections.splice(subIndex, 1);
          }
        }
      });
      
      await this.saveDatabase();
      console.log(`🗑️ Deleted collection: ${collection.name}`);
      return true;
    }
    return false;
  }
  
  getCollection(collectionId) {
    const collection = this.data.collections[collectionId];
    if (!collection) return null;
    
    // Expand file IDs into full file objects
    const expandedFiles = collection.files.map(fileId => {
      const fileData = this.getUploadById(fileId);
      return fileData; // This already includes uploadedBy and other metadata
    }).filter(Boolean); // Remove any files that no longer exist
    
    return {
      ...collection,  
      files: expandedFiles
    };
  }
  
  getUserCollections(userEmail) {
    if (!this.data.users[userEmail] || !this.data.users[userEmail].collections) {
      return [];
    }
    
    return this.data.users[userEmail].collections.map(collectionId => {
      const collection = this.data.collections[collectionId];
      if (!collection) return null;
      
      // Expand file IDs into full file objects
      const expandedFiles = collection.files.map(fileId => {
        const fileData = this.getUploadById(fileId);
        return fileData; // This already includes uploadedBy and other metadata
      }).filter(Boolean); // Remove any files that no longer exist
      
      return {
        ...collection,
        files: expandedFiles
      };
    }).filter(Boolean);
  }
  
  getPublicCollections() {
    return Object.values(this.data.collections)
      .filter(collection => collection.isPublic)
      .map(collection => {
        // Expand file IDs into full file objects
        const expandedFiles = collection.files.map(fileId => {
          const fileData = this.getUploadById(fileId);
          return fileData; // This already includes uploadedBy and other metadata
        }).filter(Boolean); // Remove any files that no longer exist
        
        return {
          ...collection,
          files: expandedFiles
        };
      });
  }
  
  // Subscription methods
  async subscribeToFile(userEmail, fileId) {
    if (!this.data.users[userEmail].subscribedFiles) {
      this.data.users[userEmail].subscribedFiles = [];
    }
    
    if (!this.data.users[userEmail].subscribedFiles.includes(fileId)) {
      this.data.users[userEmail].subscribedFiles.push(fileId);
      await this.saveDatabase();
      console.log(`📎 User ${userEmail} subscribed to file ${fileId}`);
      return true;
    }
    return false;
  }
  
  async unsubscribeFromFile(userEmail, fileId) {
    if (this.data.users[userEmail].subscribedFiles) {
      const index = this.data.users[userEmail].subscribedFiles.indexOf(fileId);
      if (index > -1) {
        this.data.users[userEmail].subscribedFiles.splice(index, 1);
        await this.saveDatabase();
        console.log(`❌ User ${userEmail} unsubscribed from file ${fileId}`);
        return true;
      }
    }
    return false;
  }
  
  async subscribeToCollection(userEmail, collectionId) {
    if (!this.data.users[userEmail].subscribedCollections) {
      this.data.users[userEmail].subscribedCollections = [];
    }
    
    if (!this.data.users[userEmail].subscribedCollections.includes(collectionId)) {
      this.data.users[userEmail].subscribedCollections.push(collectionId);
      await this.saveDatabase();
      console.log(`📚 User ${userEmail} subscribed to collection ${collectionId}`);
      return true;
    }
    return false;
  }
  
  async unsubscribeFromCollection(userEmail, collectionId) {
    if (this.data.users[userEmail].subscribedCollections) {
      const index = this.data.users[userEmail].subscribedCollections.indexOf(collectionId);
      if (index > -1) {
        this.data.users[userEmail].subscribedCollections.splice(index, 1);
        await this.saveDatabase();
        console.log(`❌ User ${userEmail} unsubscribed from collection ${collectionId}`);
        return true;
      }
    }
    return false;
  }
  
  getSubscribedFiles(userEmail) {
    if (!this.data.users[userEmail] || !this.data.users[userEmail].subscribedFiles) {
      return [];
    }
    
    return this.data.users[userEmail].subscribedFiles.map(fileId => {
      const fileData = this.getUploadById(fileId);
      return fileData;
    }).filter(Boolean);
  }
  
  getSubscribedCollections(userEmail) {
    if (!this.data.users[userEmail] || !this.data.users[userEmail].subscribedCollections) {
      return [];
    }
    
    return this.data.users[userEmail].subscribedCollections.map(collectionId => 
      this.data.collections[collectionId]
    ).filter(Boolean);
  }
  
  // Hot-swap file replacement
  async replaceFile(fileId, newFileData, userEmail) {
    for (const email in this.data.users) {
      const uploadIndex = this.data.users[email].uploads.findIndex(upload => upload.id === fileId);
      if (uploadIndex !== -1 && email === userEmail) {
        // Keep the same ID and metadata, but update file details
        const existingUpload = this.data.users[email].uploads[uploadIndex];
        this.data.users[email].uploads[uploadIndex] = {
          ...existingUpload,
          originalName: newFileData.originalName,
          filename: newFileData.filename,
          size: newFileData.size,
          fileType: this.getFileType(newFileData.originalName),
          uploadTime: new Date().toISOString(), // Update upload time
          downloadCount: 0 // Reset download count for new file
        };
        
        await this.saveDatabase();
        console.log(`🔄 Hot-swapped file ${fileId} for user ${userEmail}`);
        return this.data.users[email].uploads[uploadIndex];
      }
    }
    return null;
  }
  
  // User profile methods
  getPublicProfile(userEmail) {
    const user = this.data.users[userEmail];
    if (!user || !user.profilePublic) {
      return null;
    }
    
    return {
      name: user.name,
      email: userEmail,
      uploads: user.uploads.filter(upload => !upload.isPrivate),
      collections: this.getUserCollections(userEmail).filter(collection => collection.isPublic),
      joinedAt: user.createdAt
    };
  }
  
  async updateProfileVisibility(userEmail, isPublic) {
    if (this.data.users[userEmail]) {
      this.data.users[userEmail].profilePublic = isPublic;
      await this.saveDatabase();
      return true;
    }
    return false;
  }

  // Direct Upload Link methods
  async createDirectUploadLink(userEmail, folderName, password = null) {
    const linkId = require('uuid').v4();
    const link = {
      id: linkId,
      createdBy: userEmail,
      folderName: folderName,
      password: password,
      createdAt: new Date().toISOString(),
      uploadCount: 0,
      enabled: true
    };

    this.data.directUploadLinks[linkId] = link;
    await this.saveDatabase();
    console.log(`🔗 Created direct upload link: ${linkId} for folder "${folderName}" by ${userEmail}`);
    return link;
  }

  getDirectUploadLink(linkId) {
    return this.data.directUploadLinks[linkId] || null;
  }

  getUserDirectUploadLinks(userEmail) {
    return Object.values(this.data.directUploadLinks)
      .filter(link => link.createdBy === userEmail);
  }

  getAllDirectUploadLinks() {
    return Object.values(this.data.directUploadLinks);
  }

  async updateDirectUploadLinkStatus(linkId, enabled) {
    if (this.data.directUploadLinks[linkId]) {
      this.data.directUploadLinks[linkId].enabled = enabled;
      await this.saveDatabase();
      console.log(`🔗 Updated direct upload link ${linkId} status to ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    }
    return false;
  }

  async incrementDirectUploadCount(linkId) {
    if (this.data.directUploadLinks[linkId]) {
      this.data.directUploadLinks[linkId].uploadCount++;
      await this.saveDatabase();
      return this.data.directUploadLinks[linkId].uploadCount;
    }
    return 0;
  }

  async deleteDirectUploadLink(linkId, userEmail) {
    const link = this.data.directUploadLinks[linkId];
    if (link && link.createdBy === userEmail) {
      delete this.data.directUploadLinks[linkId];
      await this.saveDatabase();
      console.log(`🗑️ Deleted direct upload link: ${linkId}`);
      return true;
    }
    return false;
  }
}

module.exports = FileDatabase;