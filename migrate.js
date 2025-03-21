require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const migrationsDir = path.join(__dirname, 'migrations');

console.log(process.env.SQLITE_URL);

function runMigrations() {
    const db = new DatabaseSync(process.env.SQLITE_URL);

    try {
        // Create migrations table if not exists
        db.exec(`CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Get already applied migrations
        const mgQuery = db.prepare("SELECT filename FROM migrations");
        const appliedMigrations = mgQuery.all();
        const appliedFiles = appliedMigrations.map(row => row.filename);

        // Read all migration files
        const files = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();

        for (const file of files) {
            if (appliedFiles.includes(file)) {
                console.log(`Skipping already applied migration: ${file}`);
                continue;
            }

            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            db.exec(sql);

            // Record the successful migration
            db.exec(`INSERT INTO migrations (filename) VALUES ('${file}')`);

            console.log(`Migration applied: ${file}`);
        }

        console.log('All migrations completed successfully.');
    } catch (error) {
        console.error('Error running migrations:', error);
    } finally {
        db.close();
    }
}

runMigrations();
