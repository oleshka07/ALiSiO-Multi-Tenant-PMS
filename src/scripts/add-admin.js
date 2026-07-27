const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'alisio.db');
const db = new Database(DB_PATH);

const email = '4sv.exe@gmail.com';
const password = '4sv.exe';
const fullName = '4sv.exe Admin';
const role = 'owner';
const orgId = 'org_alisio_001';

try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const id = 'user_' + Date.now();
    
    // Check if user already exists
    const existing = db.prepare('SELECT id FROM app_users WHERE email = ?').get(email);
    
    if (existing) {
        db.prepare('UPDATE app_users SET password_hash = ?, full_name = ?, role = ? WHERE email = ?')
          .run(passwordHash, fullName, role, email);
        console.log(`User ${email} updated successfully.`);
    } else {
        db.prepare('INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, orgId, email, fullName, role, passwordHash);
        console.log(`User ${email} created successfully.`);
    }
} catch (error) {
    console.error('Error adding user:', error.message);
} finally {
    db.close();
}
