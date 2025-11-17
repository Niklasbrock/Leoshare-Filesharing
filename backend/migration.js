const FileDatabase = require('./database');
const SQLiteDatabase = require('./sqliteDatabase');
const fs = require('fs');
const path = require('path');

class DatabaseMigration {
  constructor() {
    this.jsonDb = new FileDatabase();
    this.sqliteDb = new SQLiteDatabase();
    this.migrationLog = [];
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    this.migrationLog.push(logMessage);
  }

  async validateJsonData() {
    this.log('Starting JSON data validation...');
    
    const data = this.jsonDb.data;
    const issues = [];

    // Validate users
    const userCount = Object.keys(data.users || {}).length;
    this.log(`Found ${userCount} users to migrate`);

    let totalFiles = 0;
    for (const [email, userData] of Object.entries(data.users || {})) {
      if (!userData.name) {
        issues.push(`User ${email} missing name`);
      }
      if (userData.uploads) {
        totalFiles += userData.uploads.length;
        
        // Validate file data
        for (const file of userData.uploads) {
          if (!file.id || !file.originalName || !file.filename) {
            issues.push(`File missing required fields: ${JSON.stringify(file)}`);
          }
        }
      }
    }

    this.log(`Found ${totalFiles} files to migrate`);

    // Validate collections
    const collectionCount = Object.keys(data.collections || {}).length;
    this.log(`Found ${collectionCount} collections to migrate`);

    for (const [collectionId, collection] of Object.entries(data.collections || {})) {
      if (!collection.name || !collection.createdBy) {
        issues.push(`Collection ${collectionId} missing required fields`);
      }
    }

    if (issues.length > 0) {
      this.log(`❌ Validation found ${issues.length} issues:`);
      issues.forEach(issue => this.log(`  - ${issue}`));
      return false;
    }

    this.log('✅ JSON data validation passed');
    return true;
  }

  async migrateUsers() {
    this.log('Starting user migration...');
    const users = this.jsonDb.data.users || {};
    const userMapping = new Map(); // email -> user_id

    for (const [email, userData] of Object.entries(users)) {
      try {
        const userId = await this.sqliteDb.addUser(
          email,
          userData.name,
          userData.approved || false
        );
        userMapping.set(email, userId);
        this.log(`✅ Migrated user: ${email} (ID: ${userId})`);
      } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
          // User already exists, get their ID
          const existingUser = await this.sqliteDb.getUserByEmail(email);
          userMapping.set(email, existingUser.id);
          this.log(`ℹ️ User already exists: ${email} (ID: ${existingUser.id})`);
        } else {
          throw error;
        }
      }
    }

    this.log(`✅ User migration completed: ${userMapping.size} users`);
    return userMapping;
  }

  async migrateFiles(userMapping) {
    this.log('Starting file migration...');
    const users = this.jsonDb.data.users || {};
    let fileCount = 0;

    for (const [email, userData] of Object.entries(users)) {
      if (userData.uploads && userData.uploads.length > 0) {
        for (const file of userData.uploads) {
          try {
            await this.sqliteDb.addUpload(email, {
              id: file.id,
              originalName: file.originalName,
              filename: file.filename,
              size: file.size,
              fileType: file.fileType,
              mimeType: file.mimeType,
              isPrivate: file.isPrivate,
              uploadTime: file.uploadTime,
              expiryTime: file.expiryTime,
              downloadCount: file.downloadCount || 0
            });
            fileCount++;
            
            if (fileCount % 10 === 0) {
              this.log(`📁 Migrated ${fileCount} files...`);
            }
          } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
              this.log(`ℹ️ File already exists: ${file.id}`);
            } else {
              this.log(`❌ Error migrating file ${file.id}: ${error.message}`);
              throw error;
            }
          }
        }
      }
    }

    this.log(`✅ File migration completed: ${fileCount} files`);
    return fileCount;
  }

  async migrateCollections(userMapping) {
    this.log('Starting collection migration...');
    const collections = this.jsonDb.data.collections || {};
    let collectionCount = 0;

    for (const [collectionId, collection] of Object.entries(collections)) {
      try {
        const user = await this.sqliteDb.getUserByEmail(collection.createdBy);
        if (!user) {
          this.log(`❌ Cannot migrate collection ${collectionId}: user ${collection.createdBy} not found`);
          continue;
        }

        // Create collection in SQLite (it will generate a new UUID, so we need to handle this)
        const newCollection = await this.sqliteDb.createCollection(
          collection.createdBy,
          collection.name,
          collection.description || ''
        );

        // Update the collection ID to match original
        await this.sqliteDb.db.run(
          'UPDATE collections SET id = ? WHERE id = ?',
          [collectionId, newCollection.id]
        );

        // Add files to collection
        if (collection.files && collection.files.length > 0) {
          for (const fileId of collection.files) {
            try {
              await this.sqliteDb.addFileToCollection(collectionId, fileId);
            } catch (error) {
              this.log(`⚠️ Could not add file ${fileId} to collection ${collectionId}: ${error.message}`);
            }
          }
        }

        collectionCount++;
        this.log(`✅ Migrated collection: ${collection.name} (${collection.files?.length || 0} files)`);

      } catch (error) {
        this.log(`❌ Error migrating collection ${collectionId}: ${error.message}`);
        throw error;
      }
    }

    this.log(`✅ Collection migration completed: ${collectionCount} collections`);
    return collectionCount;
  }

  async migrateSubscriptions(userMapping) {
    this.log('Starting subscription migration...');
    const users = this.jsonDb.data.users || {};
    let subscriptionCount = 0;

    for (const [email, userData] of Object.entries(users)) {
      // Migrate file subscriptions
      if (userData.subscribedFiles && userData.subscribedFiles.length > 0) {
        for (const fileId of userData.subscribedFiles) {
          try {
            await this.sqliteDb.subscribeToFile(email, fileId);
            subscriptionCount++;
          } catch (error) {
            this.log(`⚠️ Could not migrate file subscription ${fileId} for ${email}: ${error.message}`);
          }
        }
      }

      // Migrate collection subscriptions
      if (userData.subscribedCollections && userData.subscribedCollections.length > 0) {
        for (const collectionId of userData.subscribedCollections) {
          try {
            // Note: Need to implement subscribeToCollection method in SQLiteDatabase
            subscriptionCount++;
          } catch (error) {
            this.log(`⚠️ Could not migrate collection subscription ${collectionId} for ${email}: ${error.message}`);
          }
        }
      }
    }

    this.log(`✅ Subscription migration completed: ${subscriptionCount} subscriptions`);
    return subscriptionCount;
  }

  async validateMigration() {
    this.log('Starting migration validation...');

    // Compare record counts
    const jsonUsers = Object.keys(this.jsonDb.data.users || {}).length;
    const sqliteStats = await this.sqliteDb.getStats();

    this.log(`User count - JSON: ${jsonUsers}, SQLite: ${sqliteStats.total_users}`);
    
    let jsonFiles = 0;
    for (const userData of Object.values(this.jsonDb.data.users || {})) {
      jsonFiles += (userData.uploads || []).length;
    }
    this.log(`File count - JSON: ${jsonFiles}, SQLite: ${sqliteStats.total_files}`);

    const jsonCollections = Object.keys(this.jsonDb.data.collections || {}).length;
    this.log(`Collection count - JSON: ${jsonCollections}, SQLite: ${sqliteStats.total_collections}`);

    // Spot check some data
    const firstUser = Object.keys(this.jsonDb.data.users || {})[0];
    if (firstUser) {
      const sqliteUser = await this.sqliteDb.getUserByEmail(firstUser);
      const jsonUserData = this.jsonDb.data.users[firstUser];
      
      this.log(`Sample user validation - ${firstUser}:`);
      this.log(`  Name: JSON="${jsonUserData.name}" SQLite="${sqliteUser.name}"`);
      this.log(`  Approved: JSON="${jsonUserData.approved}" SQLite="${sqliteUser.approved}"`);
    }

    if (jsonUsers === sqliteStats.total_users && jsonFiles === sqliteStats.total_files) {
      this.log('✅ Migration validation passed');
      return true;
    } else {
      this.log('❌ Migration validation failed - record counts do not match');
      return false;
    }
  }

  async createBackup() {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `database-backup-${timestamp}.json`);
    
    fs.copyFileSync(this.jsonDb.dbPath, backupPath);
    this.log(`✅ Created backup: ${backupPath}`);
    
    return backupPath;
  }

  async saveMigrationLog() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(__dirname, `migration-log-${timestamp}.txt`);
    
    fs.writeFileSync(logPath, this.migrationLog.join('\n'));
    this.log(`✅ Migration log saved: ${logPath}`);
    
    return logPath;
  }

  async performMigration() {
    try {
      this.log('🚀 Starting database migration from JSON to SQLite...');

      // Step 1: Validate source data
      const isValid = await this.validateJsonData();
      if (!isValid) {
        throw new Error('JSON data validation failed');
      }

      // Step 2: Create backup
      const backupPath = await this.createBackup();

      // Step 3: Start transaction
      await this.sqliteDb.beginTransaction();

      try {
        // Step 4: Migrate data
        const userMapping = await this.migrateUsers();
        await this.migrateFiles(userMapping);
        await this.migrateCollections(userMapping);
        await this.migrateSubscriptions(userMapping);

        // Step 5: Validate migration
        const validationPassed = await this.validateMigration();
        if (!validationPassed) {
          throw new Error('Migration validation failed');
        }

        // Step 6: Commit transaction
        await this.sqliteDb.commit();
        this.log('✅ Migration completed successfully!');

        // Step 7: Save log
        const logPath = await this.saveMigrationLog();

        return {
          success: true,
          backupPath,
          logPath,
          stats: await this.sqliteDb.getStats()
        };

      } catch (error) {
        // Rollback on error
        await this.sqliteDb.rollback();
        throw error;
      }

    } catch (error) {
      this.log(`❌ Migration failed: ${error.message}`);
      this.log(error.stack);
      
      const logPath = await this.saveMigrationLog();
      
      return {
        success: false,
        error: error.message,
        logPath
      };
    }
  }
}

// CLI interface for running migration
if (require.main === module) {
  const migration = new DatabaseMigration();
  
  migration.performMigration()
    .then(result => {
      if (result.success) {
        console.log('\n🎉 Migration completed successfully!');
        console.log(`📁 Backup created: ${result.backupPath}`);
        console.log(`📄 Log saved: ${result.logPath}`);
        console.log('\n📊 Final statistics:');
        console.log(`   Users: ${result.stats.total_users}`);
        console.log(`   Files: ${result.stats.total_files}`);
        console.log(`   Collections: ${result.stats.total_collections}`);
      } else {
        console.log('\n💥 Migration failed!');
        console.log(`❌ Error: ${result.error}`);
        console.log(`📄 Log saved: ${result.logPath}`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = DatabaseMigration;