const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'attendance.db'));

// inicijalizacija tablica baze podataka
function initializeDatabase() {
    db.serialize(() => {
        // kreiranje tablice attendance_records
        db.run(`CREATE TABLE IF NOT EXISTS attendance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            attended BOOLEAN NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // kreiranje tablice attendance_summary za brzu statistiku
        db.run(`CREATE TABLE IF NOT EXISTS attendance_summary (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            total_attendance INTEGER DEFAULT 0,
            last_attended DATETIME
        )`);
    });
}

// bilježenje prisutnosti korisnika
function recordAttendance(userId, username, attended) {
    const date = new Date().toISOString().split('T')[0];
    
    db.run(
        'INSERT INTO attendance_records (date, user_id, username, attended) VALUES (?, ?, ?, ?)',
        [date, userId, username, attended],
        (err) => {
            if (err) {
                console.error('[greška] neuspjelo bilježenje prisutnosti:', err);
                return;
            }
        }
    );

    // ažuriranje sažetka ako je korisnik prisutan
    if (attended) {
        db.run(`
            INSERT INTO attendance_summary (user_id, username, total_attendance, last_attended)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
            total_attendance = total_attendance + 1,
            last_attended = CURRENT_TIMESTAMP
        `, [userId, username], (err) => {
            if (err) {
                console.error('[greška] neuspjelo ažuriranje sažetka prisutnosti:', err);
            }
        });
    }
}

// dohvaćanje statistike prisutnosti za korisnika
function getAttendanceStats(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM attendance_summary WHERE user_id = ?',
            [userId],
            (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row || { total_attendance: 0 });
            }
        );
    });
}

// dohvaćanje ukupne prisutnosti za sve korisnike
function getAllAttendanceStats() {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT username, total_attendance, last_attended FROM attendance_summary ORDER BY total_attendance DESC',
            [],
            (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows || []);
            }
        );
    });
}

module.exports = {
    initializeDatabase,
    recordAttendance,
    getAttendanceStats,
    getAllAttendanceStats
}; 