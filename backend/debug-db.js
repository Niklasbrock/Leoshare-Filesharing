const DatabaseFactory = require('./databaseFactory');

(async () => {
  const db = DatabaseFactory.create('sqlite');
  
  try {
    console.log('=== DATABASE DEBUG ===');
    
    // Check user data
    const user = await db.getUserByEmail('niklasbrock@gmail.com');
    console.log('User data:', JSON.stringify(user, null, 2));
    
    // Check approval status
    const status = await db.getUserApprovalStatus('niklasbrock@gmail.com');
    console.log('Approval status:', JSON.stringify(status, null, 2));
    
    // Check stats
    const stats = await db.getStats();
    console.log('Database stats:', JSON.stringify(stats, null, 2));
    
    db.close();
  } catch (error) {
    console.error('Error:', error);
  }
})();