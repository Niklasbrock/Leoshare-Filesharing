const FileDatabase = require('./database');
const SQLiteDatabase = require('./sqliteDatabase');

class DatabaseFactory {
  static create(type = 'json') {
    // Check environment variable for database type
    const dbType = process.env.DATABASE_TYPE || type;
    
    switch (dbType.toLowerCase()) {
      case 'sqlite':
        console.log('📋 Using SQLite database');
        return new SQLiteDatabase();
      
      case 'json':
      default:
        console.log('📋 Using JSON file database');
        return new FileDatabase();
    }
  }

  static async migrate() {
    const DatabaseMigration = require('./migration');
    const migration = new DatabaseMigration();
    
    console.log('🚀 Starting database migration...');
    const result = await migration.performMigration();
    
    if (result.success) {
      console.log('✅ Migration completed successfully!');
      console.log('💡 To use SQLite, set DATABASE_TYPE=sqlite in your environment');
      return true;
    } else {
      console.error('❌ Migration failed:', result.error);
      return false;
    }
  }
}

module.exports = DatabaseFactory;