const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class SQLiteDatabase {
  constructor(dbPath = path.join(__dirname, 'database.sqlite')) {
    this.dbPath = dbPath;
    this.db = null;
    this.checkpointInterval = null;
    this.initializeDatabase();
  }

  async initializeDatabase() {
    return new Promise((resolve, reject) => {
      // Configure SQLite for better concurrent performance
      this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
          console.error('Error opening SQLite database:', err);
          reject(err);
        } else {
          console.log('📋 Connected to SQLite database');
          
          // Add error handling for database operations
          this.db.on('error', (err) => {
            console.error('💥 SQLite database error:', err);
          });
          
          // Configure database for better performance and concurrency
          this.db.serialize(() => {
            // Enable WAL mode for better concurrent access
            this.db.run('PRAGMA journal_mode=WAL;', (err) => {
              if (err) console.warn('Failed to enable WAL mode:', err);
            });
            // Configure WAL auto-checkpoint for better performance
            this.db.run('PRAGMA wal_autocheckpoint=1000;'); // Checkpoint every 1000 pages
            this.db.run('PRAGMA wal_checkpoint(TRUNCATE);'); // Initial checkpoint
            
            // Optimize for speed over crash safety
            this.db.run('PRAGMA synchronous=NORMAL;');
            // Increase cache size (20MB for better performance)
            this.db.run('PRAGMA cache_size=20000;');
            // Reduce busy timeout to prevent long waits (10 seconds)
            this.db.run('PRAGMA busy_timeout=10000;');
            // Enable foreign keys
            this.db.run('PRAGMA foreign_keys=ON;');
            // Set temp store to memory for better performance
            this.db.run('PRAGMA temp_store=MEMORY;');
            // Optimize page size for better I/O
            this.db.run('PRAGMA page_size=4096;');
            // Use memory for temporary tables
            this.db.run('PRAGMA temp_store=MEMORY;');
            
            this.createTables().then(() => {
              // Start periodic checkpoint after initialization
              this.startPeriodicCheckpoint();
              resolve();
            }).catch(reject);
          });
        }
      });
    });
  }

  // Start periodic WAL checkpoint to prevent large files
  startPeriodicCheckpoint() {
    // Run checkpoint every 5 minutes
    this.checkpointInterval = setInterval(() => {
      if (this.db) {
        this.db.run('PRAGMA wal_checkpoint(PASSIVE);', (err) => {
          if (err) {
            console.warn('WAL checkpoint failed:', err.message);
          } else {
            console.log('🔄 WAL checkpoint completed');
          }
        });
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    console.log('📋 Started periodic WAL checkpoint (every 5 minutes)');
  }

  async createTables() {
    const schema = `
      -- Users table with proper normalization
      CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          approved BOOLEAN DEFAULT FALSE,
          profile_public BOOLEAN DEFAULT TRUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          approved_at DATETIME,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Files table with proper metadata
      CREATE TABLE IF NOT EXISTS files (
          id VARCHAR(36) PRIMARY KEY,
          user_id INTEGER NOT NULL,
          original_name VARCHAR(255) NOT NULL,
          filename VARCHAR(255) NOT NULL,
          file_size INTEGER NOT NULL,
          file_type VARCHAR(50) NOT NULL,
          mime_type VARCHAR(100),
          is_private BOOLEAN DEFAULT TRUE,
          upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          expiry_time DATETIME,
          download_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Collections table
      CREATE TABLE IF NOT EXISTS collections (
          id VARCHAR(36) PRIMARY KEY,
          user_id INTEGER NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          is_public BOOLEAN DEFAULT TRUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Collection files junction table (many-to-many)
      CREATE TABLE IF NOT EXISTS collection_files (
          collection_id VARCHAR(36) NOT NULL,
          file_id VARCHAR(36) NOT NULL,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (collection_id, file_id),
          FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
          FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      );

      -- File subscriptions
      CREATE TABLE IF NOT EXISTS file_subscriptions (
          user_id INTEGER NOT NULL,
          file_id VARCHAR(36) NOT NULL,
          subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, file_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      );

      -- Collection subscriptions
      CREATE TABLE IF NOT EXISTS collection_subscriptions (
          user_id INTEGER NOT NULL,
          collection_id VARCHAR(36) NOT NULL,
          subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, collection_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      );

      -- System metadata
      CREATE TABLE IF NOT EXISTS system_metadata (
          key VARCHAR(100) PRIMARY KEY,
          value TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Direct upload links table
      CREATE TABLE IF NOT EXISTS direct_upload_links (
          id VARCHAR(36) PRIMARY KEY,
          user_id INTEGER NOT NULL,
          folder_name VARCHAR(255) NOT NULL,
          password VARCHAR(255),
          upload_count INTEGER DEFAULT 0,
          enabled BOOLEAN DEFAULT TRUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
      CREATE INDEX IF NOT EXISTS idx_files_upload_time ON files(upload_time);
      CREATE INDEX IF NOT EXISTS idx_files_expiry_time ON files(expiry_time);
      CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type);
      CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
      CREATE INDEX IF NOT EXISTS idx_collection_files_file_id ON collection_files(file_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_approved ON users(approved);
      
      -- Composite indexes for common query patterns
      CREATE INDEX IF NOT EXISTS idx_files_user_type ON files(user_id, file_type);
      CREATE INDEX IF NOT EXISTS idx_files_expiry_user ON files(expiry_time, user_id);
      CREATE INDEX IF NOT EXISTS idx_collection_files_composite ON collection_files(collection_id, file_id);
      CREATE INDEX IF NOT EXISTS idx_files_user_upload_time ON files(user_id, upload_time);
      CREATE INDEX IF NOT EXISTS idx_files_private_user ON files(is_private, user_id);
      CREATE INDEX IF NOT EXISTS idx_collections_user_created ON collections(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_users_approved_created ON users(approved, created_at);
      CREATE INDEX IF NOT EXISTS idx_direct_upload_links_user_id ON direct_upload_links(user_id);
      CREATE INDEX IF NOT EXISTS idx_direct_upload_links_enabled ON direct_upload_links(enabled);

      -- Views for common queries
      CREATE VIEW IF NOT EXISTS user_file_stats AS
      SELECT 
          u.id,
          u.email,
          u.name,
          COUNT(f.id) as total_files,
          COALESCE(SUM(f.file_size), 0) as total_size,
          COALESCE(SUM(f.download_count), 0) as total_downloads
      FROM users u
      LEFT JOIN files f ON u.id = f.user_id
      GROUP BY u.id, u.email, u.name;

      CREATE VIEW IF NOT EXISTS collection_details AS
      SELECT 
          c.*,
          u.name as creator_name,
          COUNT(cf.file_id) as file_count
      FROM collections c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN collection_files cf ON c.id = cf.collection_id
      GROUP BY c.id;
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(schema, (err) => {
        if (err) {
          console.error('Error creating database schema:', err);
          reject(err);
        } else {
          console.log('✅ Database schema created successfully');
          resolve();
        }
      });
    });
  }

  // User management methods
  async addUser(email, name, approved = false) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO users (email, name, approved, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run([email, name, approved], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
      
      stmt.finalize();
    });
  }

  async getUserByEmail(email) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async getUserApprovalStatus(email) {
    const user = await this.getUserByEmail(email);
    if (!user) return null;
    
    return {
      exists: true,
      approved: Boolean(user.approved), // Convert SQLite 1/0 to JavaScript true/false
      name: user.name
    };
  }

  async approveUser(email) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET approved = TRUE, approved_at = CURRENT_TIMESTAMP WHERE email = ?',
        [email],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  async unapproveUser(email) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET approved = FALSE, approved_at = NULL WHERE email = ?',
        [email],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  async getAllUsers() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT email, name, approved, created_at, approved_at FROM users ORDER BY created_at DESC',
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async getUserFiles(email) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
        if (err) return reject(err);
        if (!user) return resolve([]);
        
        this.db.all(
          'SELECT filename FROM files WHERE user_id = ?',
          [user.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
    });
  }

  async removeUser(email) {
    return new Promise((resolve, reject) => {
      const db = this.db; // Store reference to avoid context issues
      db.serialize(() => {
        // Start transaction
        db.run('BEGIN TRANSACTION');
        
        // Get user ID and files first
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          
          if (!user) {
            db.run('ROLLBACK');
            return resolve({ success: false, message: 'User not found' });
          }
          
          const userId = user.id;
          
            // Get user's files for physical deletion
            db.all('SELECT filename FROM files WHERE user_id = ?', [userId], (err, userFiles) => {
              if (err) {
                db.run('ROLLBACK');
                return reject(err);
              }
            
              // Delete user's collections (CASCADE will handle collection_files)
              db.run('DELETE FROM collections WHERE user_id = ?', [userId], (err) => {
                if (err) {
                  db.run('ROLLBACK');
                  return reject(err);
                }
                
                // Delete user's files (CASCADE will handle collection_files and subscriptions)
                db.run('DELETE FROM files WHERE user_id = ?', [userId], (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    return reject(err);
                  }
                  
                  // Delete the user
                  db.run('DELETE FROM users WHERE id = ?', [userId], (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      return reject(err);
                    }
                    
                    // Commit transaction
                    db.run('COMMIT', (err) => {
                      if (err) {
                        db.run('ROLLBACK');
                        return reject(err);
                      }
                      
                      resolve({ 
                        success: true, 
                        message: 'User and all associated data removed',
                        userFiles: userFiles || [],
                        deletedRows: 1 // User was deleted successfully
                      });
                    });
                  });
                });
              });
            });
          });
      });
    });
  }

  // File management methods
  async addUpload(userEmail, fileData) {
    const user = await this.getUserByEmail(userEmail);
    if (!user) throw new Error('User not found');

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO files (
          id, user_id, original_name, filename, file_size, file_type, 
          mime_type, is_private, upload_time, expiry_time, download_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        fileData.id,
        user.id,
        fileData.originalName,
        fileData.filename,
        fileData.size,
        fileData.fileType,
        fileData.mimeType || null,
        fileData.isPrivate,
        fileData.uploadTime,
        fileData.expiryTime,
        fileData.downloadCount || 0
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(fileData);
        }
      });
      
      stmt.finalize();
    });
  }

  async getUploadById(fileId) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT f.*, u.email as uploaded_by 
        FROM files f 
        JOIN users u ON f.user_id = u.id 
        WHERE f.id = ?
      `, [fileId], (err, row) => {
        if (err) reject(err);
        else if (row) {
          // Convert to format expected by existing code
          resolve({
            id: row.id,
            originalName: row.original_name,
            filename: row.filename,
            size: row.file_size,
            fileType: row.file_type,
            mimeType: row.mime_type,
            isPrivate: Boolean(row.is_private),
            uploadTime: row.upload_time,
            expiryTime: row.expiry_time,
            downloadCount: row.download_count,
            uploadedBy: row.uploaded_by,
            downloadLink: `/api/download/${row.id}`
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async getUserUploads(userEmail) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT f.* FROM files f
        JOIN users u ON f.user_id = u.id
        WHERE u.email = ?
        ORDER BY f.upload_time DESC
      `, [userEmail], (err, rows) => {
        if (err) reject(err);
        else {
          const uploads = rows.map(row => ({
            id: row.id,
            originalName: row.original_name,
            filename: row.filename,
            size: row.file_size,
            fileType: row.file_type,
            mimeType: row.mime_type,
            isPrivate: Boolean(row.is_private),
            uploadTime: row.upload_time,
            expiryTime: row.expiry_time,
            downloadCount: row.download_count,
            uploadedBy: userEmail,
            downloadLink: `/api/download/${row.id}`
          }));
          resolve(uploads);
        }
      });
    });
  }

  async incrementDownloadCount(fileId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE files SET download_count = download_count + 1 WHERE id = ?',
        [fileId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async updateDownloadCount(fileId) {
    return new Promise((resolve, reject) => {
      // First update the count
      this.db.run(
        'UPDATE files SET download_count = download_count + 1 WHERE id = ?',
        [fileId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            // Then get the updated count
            this.db.get(
              'SELECT download_count FROM files WHERE id = ?',
              [fileId],
              (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.download_count : 0);
              }
            );
          }
        }
      );
    });
  }

  async deleteUpload(fileId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM files WHERE id = ?',
        [fileId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  async removeUpload(fileId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM files WHERE id = ?',
        [fileId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  // Collection management methods
  async createCollection(userEmail, name, description = '', isPrivate = false) {
    const user = await this.getUserByEmail(userEmail);
    if (!user) throw new Error('User not found');

    const collectionId = uuidv4();
    
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO collections (id, user_id, name, description, is_public, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run([collectionId, user.id, name, description, !isPrivate], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: collectionId,
            name: name,
            description: description,
            createdBy: userEmail,
            createdAt: new Date().toISOString(),
            files: [],
            isPublic: !isPrivate
          });
        }
      });
      
      stmt.finalize();
    });
  }

  async getUserCollections(userEmail) {
    try {
      // Single optimized query to get all collections and their files in one go
      const collectionsData = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('getUserCollections timeout after 5 seconds - database may be locked'));
        }, 5000);

        this.db.all(`
          SELECT 
            c.id as collection_id,
            c.name as collection_name,
            c.description as collection_description,
            c.created_at as collection_created_at,
            c.is_public as collection_is_public,
            f.id as file_id,
            f.original_name as file_original_name,
            f.filename as file_filename,
            f.file_size as file_size,
            f.file_type as file_type,
            f.upload_time as file_upload_time,
            f.expiry_time as file_expiry_time,
            f.is_private as file_is_private,
            f.download_count as file_download_count,
            cf.added_at as file_added_at,
            fu.email as file_uploaded_by
          FROM collections c
          JOIN users u ON c.user_id = u.id
          LEFT JOIN collection_files cf ON c.id = cf.collection_id
          LEFT JOIN files f ON cf.file_id = f.id
          LEFT JOIN users fu ON f.user_id = fu.id
          WHERE u.email = ?
          ORDER BY c.created_at DESC, cf.added_at DESC
          LIMIT 1000
        `, [userEmail], (err, rows) => {
          clearTimeout(timeoutId);
          
          if (err) {
            reject(err);
            return;
          }
          
          resolve(rows);
        });
      });

      // Group the flat result set into collections with files
      const collectionsMap = new Map();
      
      for (const row of collectionsData) {
        const collectionId = row.collection_id;
        
        // Initialize collection if not exists
        if (!collectionsMap.has(collectionId)) {
          collectionsMap.set(collectionId, {
            id: collectionId,
            name: row.collection_name,
            description: row.collection_description,
            createdBy: userEmail,
            createdAt: row.collection_created_at,
            isPublic: Boolean(row.collection_is_public),
            files: [],
            fileCount: 0
          });
        }
        
        const collection = collectionsMap.get(collectionId);
        
        // Add file if exists and not already added (limit to 50 files per collection)
        if (row.file_id && collection.files.length < 50) {
          const existingFile = collection.files.find(f => f.id === row.file_id);
          if (!existingFile) {
            collection.files.push({
              id: row.file_id,
              filename: row.file_filename,
              originalName: row.file_original_name,
              originalFilename: row.file_original_name, // Keep both for compatibility
              size: row.file_size,
              uploadTime: row.file_upload_time,
              uploadDate: row.file_upload_time, // Keep both for compatibility
              expiryTime: row.file_expiry_time,
              fileType: row.file_type,
              isPrivate: Boolean(row.file_is_private),
              uploadedBy: row.file_uploaded_by,
              downloadCount: row.file_download_count || 0,
              downloadLink: `/api/download/${row.file_id}`
            });
          }
        }
      }
      
      // Convert map to array and set file counts
      const collections = Array.from(collectionsMap.values());
      collections.forEach(collection => {
        collection.fileCount = collection.files.length;
      });

      return collections;
    } catch (error) {
      console.error('Error in getUserCollections for user', userEmail, ':', error);
      throw error;
    }
  }

  async getCollection(collectionId) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('getCollection timeout after 3 seconds - database may be locked'));
      }, 3000);

      this.db.get(`
        SELECT c.*, u.email as created_by_email
        FROM collections c
        JOIN users u ON c.user_id = u.id
        WHERE c.id = ?
      `, [collectionId], (err, row) => {
        clearTimeout(timeoutId);
        
        if (err) {
          console.error(`Error fetching collection ${collectionId}:`, err);
          reject(err);
        } else if (row) {
          try {
            resolve({
              id: row.id,
              name: row.name,
              description: row.description,
              createdBy: row.created_by_email,
              createdAt: row.created_at,
              isPublic: Boolean(row.is_public)
            });
          } catch (mappingError) {
            console.error(`Error mapping collection ${collectionId}:`, mappingError);
            reject(mappingError);
          }
        } else {
          resolve(null);
        }
      });
    });
  }

  async getCollectionFiles(collectionId) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('getCollectionFiles timeout after 3 seconds - database may be locked'));
      }, 3000);

      this.db.all(`
        SELECT f.*, u.email as uploaded_by_email
        FROM files f
        JOIN collection_files cf ON f.id = cf.file_id
        JOIN users u ON f.user_id = u.id
        WHERE cf.collection_id = ?
        ORDER BY cf.added_at DESC
        LIMIT 100
      `, [collectionId], (err, rows) => {
        clearTimeout(timeoutId);
        
        if (err) {
          console.error(`Error fetching files for collection ${collectionId}:`, err);
          reject(err);
        } else {
          try {
            const files = rows.map(row => ({
              id: row.id,
              filename: row.filename,
              originalName: row.original_name,
              originalFilename: row.original_name, // Keep both for compatibility
              size: row.file_size,
              uploadTime: row.upload_time,
              uploadDate: row.upload_time, // Keep both for compatibility
              expiryTime: row.expiry_time,
              fileType: row.file_type,
              isPrivate: Boolean(row.is_private),
              uploadedBy: row.uploaded_by_email,
              downloadCount: 0, // Add missing field
              downloadLink: `/api/download/${row.id}` // Add download link
            }));
            resolve(files);
          } catch (mappingError) {
            console.error(`Error mapping files for collection ${collectionId}:`, mappingError);
            reject(mappingError);
          }
        }
      });
    });
  }

  async deleteCollection(collectionId, userEmail) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        DELETE FROM collections 
        WHERE id = ? AND user_id = (SELECT id FROM users WHERE email = ?)
      `, [collectionId, userEmail], function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
  }

  async addFileToCollection(collectionId, fileId) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO collection_files (collection_id, file_id, added_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run([collectionId, fileId], function(err) {
        if (err) {
          reject(err);
        } else {
          // Return true if a row was inserted, false if it was ignored (already exists)
          resolve(this.changes > 0);
        }
      });
      
      stmt.finalize();
    });
  }

  async removeFileFromCollection(collectionId, fileId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM collection_files WHERE collection_id = ? AND file_id = ?',
        [collectionId, fileId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  // Subscription methods
  async subscribeToFile(userEmail, fileId) {
    const user = await this.getUserByEmail(userEmail);
    if (!user) throw new Error('User not found');

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO file_subscriptions (user_id, file_id)
        VALUES (?, ?)
      `);
      
      stmt.run([user.id, fileId], function(err) {
        if (err) reject(err);
        else resolve();
      });
      
      stmt.finalize();
    });
  }

  async unsubscribeFromFile(userEmail, fileId) {
    const user = await this.getUserByEmail(userEmail);
    if (!user) throw new Error('User not found');

    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM file_subscriptions WHERE user_id = ? AND file_id = ?',
        [user.id, fileId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getSubscribedFiles(userEmail) {
    const user = await this.getUserByEmail(userEmail);
    if (!user) return [];

    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT f.*, u.email as uploaded_by
        FROM file_subscriptions fs
        JOIN files f ON fs.file_id = f.id
        JOIN users u ON f.user_id = u.id
        WHERE fs.user_id = ?
        ORDER BY fs.subscribed_at DESC
      `, [user.id], (err, rows) => {
        if (err) reject(err);
        else {
          const files = rows.map(row => ({
            id: row.id,
            originalName: row.original_name,
            filename: row.filename,
            size: row.file_size,
            fileType: row.file_type,
            mimeType: row.mime_type,
            isPrivate: Boolean(row.is_private),
            uploadTime: row.upload_time,
            expiryTime: row.expiry_time,
            downloadCount: row.download_count,
            uploadedBy: row.uploaded_by,
            downloadLink: `/api/download/${row.id}`
          }));
          resolve(files);
        }
      });
    });
  }

  // Utility methods
  async getAllUploads() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT f.*, u.email as uploaded_by 
        FROM files f 
        JOIN users u ON f.user_id = u.id
      `, [], (err, rows) => {
        if (err) reject(err);
        else {
          const uploads = new Map();
          rows.forEach(row => {
            uploads.set(row.id, {
              id: row.id,
              originalName: row.original_name,
              filename: row.filename,
              size: row.file_size,
              fileType: row.file_type,
              mimeType: row.mime_type,
              isPrivate: Boolean(row.is_private),
              uploadTime: row.upload_time,
              expiryTime: row.expiry_time,
              downloadCount: row.download_count,
              uploadedBy: row.uploaded_by,
              downloadLink: `/api/download/${row.id}`
            });
          });
          resolve(uploads);
        }
      });
    });
  }

  async cleanupExpiredFiles() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id FROM files WHERE expiry_time IS NOT NULL AND expiry_time < CURRENT_TIMESTAMP',
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(row => row.id));
        }
      );
    });
  }

  async getStats() {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE approved = 1) as approved_users,
          (SELECT COUNT(*) FROM files) as total_files,
          (SELECT COALESCE(SUM(file_size), 0) FROM files) as total_size,
          (SELECT COUNT(*) FROM collections) as total_collections
      `, [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // Transaction support
  async beginTransaction() {
    return new Promise((resolve, reject) => {
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async commit() {
    return new Promise((resolve, reject) => {
      this.db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async rollback() {
    return new Promise((resolve, reject) => {
      this.db.run('ROLLBACK', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Close database connection
  close() {
    // Stop periodic checkpoint
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
      console.log('⏹️ Stopped periodic WAL checkpoint');
    }
    
    if (this.db) {
      // Final checkpoint before closing
      this.db.run('PRAGMA wal_checkpoint(TRUNCATE);', (err) => {
        if (err) console.warn('Final checkpoint failed:', err.message);
      });
      
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('📋 Database connection closed');
        }
      });
    }
  }

  // Remove expired files
  async removeExpiredFiles() {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();

      this.db.run(
        'DELETE FROM files WHERE expiry_time IS NOT NULL AND expiry_time < ?',
        [now],
        function(err) {
          if (err) {
            console.error('❌ Error removing expired files from database:', err);
            reject(err);
          } else {
            const removedCount = this.changes;
            if (removedCount > 0) {
              console.log(`🧹 Removed ${removedCount} expired files from database`);
            }
            resolve(removedCount);
          }
        }
      );
    });
  }

  // Direct Upload Link methods
  async createDirectUploadLink(userEmail, folderName, password = null) {
    const user = await this.getUserByEmail(userEmail);
    if (!user) throw new Error('User not found');

    const linkId = uuidv4();

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO direct_upload_links (id, user_id, folder_name, password, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run([linkId, user.id, folderName, password], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: linkId,
            createdBy: userEmail,
            folderName: folderName,
            password: password,
            uploadCount: 0,
            enabled: true,
            createdAt: new Date().toISOString()
          });
        }
      });

      stmt.finalize();
    });
  }

  async getDirectUploadLink(linkId) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT dl.*, u.email as created_by_email
        FROM direct_upload_links dl
        JOIN users u ON dl.user_id = u.id
        WHERE dl.id = ?
      `, [linkId], (err, row) => {
        if (err) reject(err);
        else if (row) {
          resolve({
            id: row.id,
            createdBy: row.created_by_email,
            folderName: row.folder_name,
            password: row.password,
            uploadCount: row.upload_count,
            enabled: Boolean(row.enabled),
            createdAt: row.created_at
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async getUserDirectUploadLinks(userEmail) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT dl.*, u.email as created_by_email
        FROM direct_upload_links dl
        JOIN users u ON dl.user_id = u.id
        WHERE u.email = ?
        ORDER BY dl.created_at DESC
      `, [userEmail], (err, rows) => {
        if (err) reject(err);
        else {
          const links = rows.map(row => ({
            id: row.id,
            createdBy: row.created_by_email,
            folderName: row.folder_name,
            password: row.password,
            uploadCount: row.upload_count,
            enabled: Boolean(row.enabled),
            createdAt: row.created_at
          }));
          resolve(links);
        }
      });
    });
  }

  async getAllDirectUploadLinks() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT dl.*, u.email as created_by_email
        FROM direct_upload_links dl
        JOIN users u ON dl.user_id = u.id
        ORDER BY dl.created_at DESC
      `, [], (err, rows) => {
        if (err) reject(err);
        else {
          const links = rows.map(row => ({
            id: row.id,
            createdBy: row.created_by_email,
            folderName: row.folder_name,
            password: row.password,
            uploadCount: row.upload_count,
            enabled: Boolean(row.enabled),
            createdAt: row.created_at
          }));
          resolve(links);
        }
      });
    });
  }

  async updateDirectUploadLinkStatus(linkId, enabled) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE direct_upload_links SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [enabled ? 1 : 0, linkId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  async incrementDirectUploadCount(linkId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE direct_upload_links SET upload_count = upload_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [linkId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            this.db.get(
              'SELECT upload_count FROM direct_upload_links WHERE id = ?',
              [linkId],
              (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.upload_count : 0);
              }
            );
          }
        }
      );
    });
  }

  async deleteDirectUploadLink(linkId, userEmail) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        DELETE FROM direct_upload_links
        WHERE id = ? AND user_id = (SELECT id FROM users WHERE email = ?)
      `, [linkId, userEmail], function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
  }
}

module.exports = SQLiteDatabase;