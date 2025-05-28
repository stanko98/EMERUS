const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const DB_SOURCE = "meals.sqlite";
const { DAYS_OF_WEEK_ORDER } = require('./config/menu');

const DAY_DISPLAY_NAMES = {
    monday: "PONEDJELJAK",
    tuesday: "UTORAK",
    wednesday: "SRIJEDA",
    thursday: "ČETVRTAK",
    friday: "PETAK"
};

const db = new sqlite3.Database(DB_SOURCE, (err) => {
    if (err) {
        console.error("Error connecting to DB_SOURCE:", err.message);
        throw err;
    } else {
        console.log('Connected to the SQLite database (meals.sqlite).');
        db.serialize(() => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    is_admin BOOLEAN DEFAULT 0 NOT NULL
                );
                -- Stara tablica, više se ne koristi za nove unose
                CREATE TABLE IF NOT EXISTS user_selected_meal_option_2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    day_of_week TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    UNIQUE (user_id, day_of_week)
                );
                -- Nova tablica za odabire korisnika
                CREATE TABLE IF NOT EXISTS user_daily_choices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    day_key TEXT NOT NULL,
                    chosen_option INTEGER NOT NULL, -- 1 za Jelo 1, 2 za Jelo 2
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    UNIQUE (user_id, day_key)
                );
                CREATE TABLE IF NOT EXISTS daily_menus (
                    day_key TEXT PRIMARY KEY,
                    day_name_display TEXT NOT NULL,
                    meal_1_description TEXT,
                    has_two_options BOOLEAN DEFAULT 0 NOT NULL,
                    meal_2_description TEXT,
                    option_2_prompt TEXT
                );
                -- View se može zadržati ako je koristan za stare podatke, ali nije za novu logiku
                CREATE VIEW IF NOT EXISTS view_user_meal_choices_with_username AS
                SELECT uso.id AS choice_id, uso.user_id, u.username, uso.day_of_week
                FROM user_selected_meal_option_2 uso
                JOIN users u ON uso.user_id = u.id;
            `, (err) => {
                if (err) {
                    console.error("Error during initial table/view setup in database.js:", err.message);
                } else {
                    console.log("Core tables and view in meals.sqlite checked/created successfully.");
                    initializeDefaultDailyMenus();
                }
            });
        });
    }
});

async function initializeDefaultDailyMenus() {
    return new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM daily_menus", (err, row) => {
            if (err) { console.error("[DB Init] Error checking daily_menus count:", err); return reject(err); }
            if (row.count === 0) {
                console.log("[DB Init] Initializing daily_menus table with default days...");
                const stmt = db.prepare("INSERT OR IGNORE INTO daily_menus (day_key, day_name_display, meal_1_description, has_two_options, meal_2_description, option_2_prompt) VALUES (?, ?, ?, ?, ?, ?)");
                DAYS_OF_WEEK_ORDER.forEach(dayKey => {
                    stmt.run(dayKey, DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), "", 0, "", "");
                });
                stmt.finalize((err) => {
                    if (err) { console.error("[DB Init] Error finalizing default daily_menus initialization:", err); return reject(err); }
                    console.log("[DB Init] daily_menus table initialized with default days.");
                    resolve();
                });
            } else { resolve(); }
        });
    });
}

// --- USER FUNCTIONS ---
async function addUser(username, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
        const sql = "INSERT INTO users (username, password, is_admin) VALUES (?, ?, 0)";
        db.run(sql, [username, hashedPassword], function(err) {
            if (err) { reject(err); } 
            else { resolve({ id: this.lastID, username, is_admin: 0 }); }
        });
    });
}

async function findUserByUsername(username) {
    return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM users WHERE username = ?";
        db.get(sql, [username], (err, row) => {
            if (err) { reject(err); } 
            else { resolve(row); }
        });
    });
}

async function verifyPassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
}

// --- MEAL CHOICE FUNCTIONS (NOVA LOGIKA) ---
async function saveUserDailyChoice(userId, dayKey, chosenOption) {
    const option = parseInt(chosenOption);
    return new Promise((resolve, reject) => {
        if (option === 1 || option === 2) {
            const sql = `
                INSERT INTO user_daily_choices (user_id, day_key, chosen_option)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, day_key) DO UPDATE SET chosen_option = excluded.chosen_option;
            `;
            db.run(sql, [userId, dayKey, option], function(err) {
                if (err) reject(err); else resolve({ changes: this.changes });
            });
        } else {
            const sql = `DELETE FROM user_daily_choices WHERE user_id = ? AND day_key = ?;`;
            db.run(sql, [userId, dayKey], function(err) {
                if (err) reject(err); else resolve({ changes: this.changes });
            });
        }
    });
}

async function getUserDailyChoices(userId) {
    return new Promise((resolve, reject) => {
        const sql = "SELECT day_key, chosen_option FROM user_daily_choices WHERE user_id = ?";
        db.all(sql, [userId], (err, rows) => {
            if (err) { reject(err); } 
            else {
                const choices = {};
                rows.forEach(row => { choices[row.day_key] = row.chosen_option; });
                resolve(choices);
            }
        });
    });
}

// --- ADMIN FUNCTIONS (USERS & VOTES STATS) ---
async function getAllUsers() {
    return new Promise((resolve, reject) => {
        const sql = "SELECT id, username, is_admin FROM users ORDER BY username ASC";
        db.all(sql, [], (err, rows) => { if (err) reject(err); else resolve(rows); });
    });
}

async function findUserById(userId) {
    return new Promise((resolve, reject) => {
        const sql = "SELECT id, username, is_admin FROM users WHERE id = ?";
        db.get(sql, [userId], (err, row) => { if (err) reject(err); else resolve(row); });
    });
}

async function deleteUserById(userId) {
    return new Promise((resolve, reject) => {
        const sql = "DELETE FROM users WHERE id = ?";
        db.run(sql, [userId], function(err) { if (err) reject(err); else resolve({ changes: this.changes }); });
    });
}

async function resetAllVotes() {
    return new Promise((resolve, reject) => {
        const sql = "DELETE FROM user_daily_choices";
        db.run(sql, function(err) { if (err) reject(err); else resolve({ changes: this.changes }); });
    });
}

async function getTotalUsersCount() {
    return new Promise((resolve, reject) => {
        const sql = "SELECT COUNT(*) as count FROM users";
        db.get(sql, (err, row) => { if (err) reject(err); else resolve(row.count); });
    });
}

// ISPRAVLJENA/PREIMENOVANA FUNKCIJA
async function getTotalOverallChoicesCount() {
    return new Promise((resolve, reject) => {
        const sql = "SELECT COUNT(*) as count FROM user_daily_choices"; // Broji sve redove u novoj tablici
        db.get(sql, (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
        });
    });
}

async function getVoteCountsByDayAndOption() {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT day_key, chosen_option, COUNT(user_id) as vote_count
            FROM user_daily_choices
            GROUP BY day_key, chosen_option
            ORDER BY 
                CASE day_key
                    WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3
                    WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5 ELSE 6
                END, 
                chosen_option;
        `;
        db.all(sql, [], (err, rows) => {
            if (err) { reject(err); } 
            else {
                const detailedVotes = {};
                DAYS_OF_WEEK_ORDER.forEach(dayKey => {
                    detailedVotes[dayKey] = {
                        dayName: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(),
                        meal1_votes: 0,
                        meal2_votes: 0
                    };
                });
                rows.forEach(row => {
                    if (detailedVotes[row.day_key]) {
                        if (row.chosen_option === 1) {
                            detailedVotes[row.day_key].meal1_votes = row.vote_count;
                        } else if (row.chosen_option === 2) {
                            detailedVotes[row.day_key].meal2_votes = row.vote_count;
                        }
                    }
                });
                resolve(detailedVotes);
            }
        });
    });
}

async function getUsersWhoChoseOptionOnDay(dayKey, optionNumber) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT u.username FROM user_daily_choices udc
            JOIN users u ON udc.user_id = u.id
            WHERE udc.day_key = ? AND udc.chosen_option = ? ORDER BY u.username ASC;
        `;
        db.all(sql, [dayKey, parseInt(optionNumber)], (err, rows) => {
            if (err) { reject(err); } 
            else { resolve(rows.map(row => row.username)); }
        });
    });
}

// --- MENU MANAGEMENT FUNCTIONS ---
async function getMenuDataFromDB() {
    return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM daily_menus";
        db.all(sql, [], (err, rows) => {
            if (err) { reject(err); } 
            else {
                const menu = {};
                rows.forEach(row => {
                    menu[row.day_key] = { name: row.day_name_display, meal_1: row.meal_1_description, has_two_options: !!row.has_two_options, meal_2: row.meal_2_description, option_2_prompt: row.option_2_prompt };
                });
                DAYS_OF_WEEK_ORDER.forEach(dayKey => {
                    if (!menu[dayKey]) { menu[dayKey] = { name: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), meal_1: "Nije definirano", has_two_options: false, meal_2: "", option_2_prompt: "" }; }
                });
                resolve(menu);
            }
        });
    });
}

async function getSingleDayMenuFromDB(dayKey) {
    return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM daily_menus WHERE day_key = ?";
        db.get(sql, [dayKey], (err, row) => {
            if (err) { reject(err); } 
            else if (!row) { resolve({ day_key: dayKey, day_name_display: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), meal_1_description: "", has_two_options: false, meal_2_description: "", option_2_prompt: "" }); }
            else { resolve(row); }
        });
    });
}

async function upsertDailyMenu(dayKey, dayNameDisplay, meal1, meal2, hasTwoOptions, option2Prompt) {
    return new Promise((resolve, reject) => {
        const sql = `
            INSERT INTO daily_menus (day_key, day_name_display, meal_1_description, has_two_options, meal_2_description, option_2_prompt)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(day_key) DO UPDATE SET
                day_name_display = excluded.day_name_display, meal_1_description = excluded.meal_1_description,
                has_two_options = excluded.has_two_options, meal_2_description = excluded.meal_2_description,
                option_2_prompt = excluded.option_2_prompt;
        `;
        db.run(sql, [dayKey, dayNameDisplay, meal1, hasTwoOptions ? 1 : 0, meal2, option2Prompt], function(err) {
            if (err) { reject(err); } 
            else { resolve({ changes: this.changes, lastID: this.lastID }); }
        });
    });
}

async function clearDailyMenu(dayKey) {
    const displayName = DAY_DISPLAY_NAMES[dayKey] || dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
    return upsertDailyMenu(dayKey, displayName, "", "", false, "");
}

async function clearWeeklyMenu() {
    console.log("[DB] Pokušaj brisanja (resetiranja) tjednog jelovnika...");
    const promises = DAYS_OF_WEEK_ORDER.map(dayKey => clearDailyMenu(dayKey));
    try { await Promise.all(promises); console.log("[DB] Tjedni jelovnik uspješno resetiran."); return { success: true, message: "Tjedni jelovnik resetiran." };
    } catch (error) { console.error("[DB] Greška pri resetiranju tjednog jelovnika:", error); throw error; }
}

module.exports = {
    db,
    DAY_DISPLAY_NAMES, 
    addUser, 
    findUserByUsername, 
    verifyPassword,
    saveUserDailyChoice,
    getUserDailyChoices,
    getAllUsers, 
    findUserById, 
    deleteUserById,
    resetAllVotes, 
    getTotalUsersCount, 
    getTotalOverallChoicesCount, 
    getVoteCountsByDayAndOption,
    getUsersWhoChoseOptionOnDay,
    getMenuDataFromDB,
    getSingleDayMenuFromDB,
    upsertDailyMenu,
    clearDailyMenu, 
    clearWeeklyMenu 
};