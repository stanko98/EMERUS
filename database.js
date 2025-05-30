require('dotenv').config(); 
const { Pool } = require('pg'); 
const bcrypt = require('bcrypt');
const { DAYS_OF_WEEK_ORDER } = require('./config/menu');

const DAY_DISPLAY_NAMES = {
    monday: "PONEDJELJAK", tuesday: "UTORAK", wednesday: "SRIJEDA",
    thursday: "ČETVRTAK", friday: "PETAK"
};

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: isProduction ? { rejectUnauthorized: false } : false 
});

/*
// Konfiguracija PostgreSQL konekcije
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "5432"),
    // Možete dodati i druge opcije, npr. SSL za cloud baze:
    // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
*/

// Funkcija za provjeru konekcije i inicijalizaciju tablica
async function initializeDatabase() {
    const client = await pool.connect(); 
    console.log('Attempting to connect and initialize database...');
    
    try {
        console.log('Successfully connected to the PostgreSQL database.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE NOT NULL
            );
        `);
        console.log('Table "users" checked/created.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_daily_choices (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                day_key TEXT NOT NULL,
                chosen_option INTEGER NOT NULL, -- 1 za Jelo 1, 2 za Jelo 2
                UNIQUE (user_id, day_key)
            );
        `);
        console.log('Table "user_daily_choices" checked/created.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS daily_menus (
                day_key TEXT PRIMARY KEY,
                day_name_display TEXT NOT NULL,
                meal_1_description TEXT,
                has_two_options BOOLEAN DEFAULT FALSE NOT NULL,
                meal_2_description TEXT,
                option_2_prompt TEXT
            );
        `);
        console.log('Table "daily_menus" checked/created.');

        await initializeDefaultDailyMenus(client);
        console.log('Database tables checked/created and default data initialized.');

    } catch (err) {
        console.error('Error during database initialization:', err.stack);
        
        throw err; 
        
    } finally {
        if (client) { 
            client.release();
            console.log('Database client released after initialization process.');
        }
    }
}

(async () => {
    try {
        console.log("Starting database initialization from module root...");
        await initializeDatabase();
        console.log("Database initialization process completed successfully from module root.");
    } catch (error) {
        console.error("CRITICAL: Failed to initialize database from module root:", error);
        
        process.exit(1);
    }
})();

async function initializeDefaultDailyMenus(dbClient) { 
    const { rows } = await dbClient.query("SELECT COUNT(*) as count FROM daily_menus");
    if (parseInt(rows[0].count) === 0) {
        console.log("[DB Init] Initializing daily_menus table with default days...");
        for (const dayKey of DAYS_OF_WEEK_ORDER) {
            await dbClient.query(
                "INSERT INTO daily_menus (day_key, day_name_display, meal_1_description, has_two_options, meal_2_description, option_2_prompt) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (day_key) DO NOTHING",
                [dayKey, DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), "", false, "", ""]
            );
        }
        console.log("[DB Init] daily_menus table initialized with default days.");
    } else {
        console.log("[DB Init] daily_menus table already contains data, skipping default initialization.");
    }
}

/*
async function initializeDefaultDailyMenus(dbClient) { 
    const { rows } = await dbClient.query("SELECT COUNT(*) as count FROM daily_menus");
    if (parseInt(rows[0].count) === 0) {
        console.log("[DB Init] Initializing daily_menus table with default days...");
        for (const dayKey of DAYS_OF_WEEK_ORDER) {
            
            await dbClient.query(
                "INSERT INTO daily_menus (day_key, day_name_display, meal_1_description, has_two_options, meal_2_description, option_2_prompt) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (day_key) DO NOTHING",
                [dayKey, DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), "", false, "", ""]
            );
        }
        console.log("[DB Init] daily_menus table initialized with default days.");
    }
}
*/
// --- USER FUNCTIONS ---
async function addUser(username, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = "INSERT INTO users (username, password, is_admin) VALUES ($1, $2, FALSE) RETURNING id, username, is_admin";
    try {
        const { rows } = await pool.query(sql, [username, hashedPassword]);
        return rows[0];
    } catch (err) {
        console.error('Error in addUser:', err.message);
        throw err; 
    }
}

async function findUserByUsername(username) {
    const sql = "SELECT * FROM users WHERE username = $1";
    try {
        const { rows } = await pool.query(sql, [username]);
        return rows[0]; 
    } catch (err) {
        console.error('Error in findUserByUsername:', err.message);
        throw err;
    }
}

async function verifyPassword(plainPassword, hashedPassword) { 
    return bcrypt.compare(plainPassword, hashedPassword);
}

// --- MEAL CHOICE FUNCTIONS ---
async function saveUserDailyChoice(userId, dayKey, chosenOption) {
    const option = parseInt(chosenOption);
    try {
        if (option === 1 || option === 2) {
            const sql = `
                INSERT INTO user_daily_choices (user_id, day_key, chosen_option)
                VALUES ($1, $2, $3)
                ON CONFLICT(user_id, day_key) DO UPDATE SET chosen_option = EXCLUDED.chosen_option;
            `;
            const result = await pool.query(sql, [userId, dayKey, option]);
            return { changes: result.rowCount }; 
        } else {
            const sql = `DELETE FROM user_daily_choices WHERE user_id = $1 AND day_key = $2;`;
            const result = await pool.query(sql, [userId, dayKey]);
            return { changes: result.rowCount };
        }
    } catch (err) {
        console.error('Error in saveUserDailyChoice:', err.message);
        throw err;
    }
}

async function getUserDailyChoices(userId) {
    const sql = "SELECT day_key, chosen_option FROM user_daily_choices WHERE user_id = $1";
    try {
        const { rows } = await pool.query(sql, [userId]);
        const choices = {};
        rows.forEach(row => { choices[row.day_key] = row.chosen_option; });
        return choices;
    } catch (err) {
        console.error('Error in getUserDailyChoices:', err.message);
        throw err;
    }
}

// --- ADMIN FUNCTIONS ---
async function getAllUsers() {
    const sql = "SELECT id, username, is_admin FROM users ORDER BY username ASC";
    try {
        const { rows } = await pool.query(sql);
        return rows;
    } catch (err) { console.error('Error in getAllUsers:', err.message); throw err; }
}

async function findUserById(userId) {
    const sql = "SELECT id, username, is_admin FROM users WHERE id = $1";
    try {
        const { rows } = await pool.query(sql, [userId]);
        return rows[0];
    } catch (err) { console.error('Error in findUserById:', err.message); throw err; }
}

async function deleteUserById(userId) {
    const sql = "DELETE FROM users WHERE id = $1";
    try {
        const result = await pool.query(sql, [userId]);
        return { changes: result.rowCount };
    } catch (err) { console.error('Error in deleteUserById:', err.message); throw err; }
}

async function resetAllVotes() {
    const sql = "DELETE FROM user_daily_choices";
    try {
        const result = await pool.query(sql);
        return { changes: result.rowCount };
    } catch (err) { console.error('Error in resetAllVotes:', err.message); throw err; }
}

async function getTotalUsersCount() {
    const sql = "SELECT COUNT(*) as count FROM users";
    try {
        const { rows } = await pool.query(sql);
        return parseInt(rows[0].count);
    } catch (err) { console.error('Error in getTotalUsersCount:', err.message); throw err; }
}

async function getTotalOverallChoicesCount() {
    const sql = "SELECT COUNT(*) as count FROM user_daily_choices";
    try {
        const { rows } = await pool.query(sql);
        return parseInt(rows[0].count);
    } catch (err) { console.error('Error in getTotalOverallChoicesCount:', err.message); throw err; }
}

async function getVoteCountsByDayAndOption() {
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
    try {
        const { rows } = await pool.query(sql);
        const detailedVotes = {};
        DAYS_OF_WEEK_ORDER.forEach(dayKey => {
            detailedVotes[dayKey] = {
                dayName: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(),
                meal1_votes: 0, meal2_votes: 0
            };
        });
        rows.forEach(row => {
            if (detailedVotes[row.day_key]) {
                if (row.chosen_option === 1) detailedVotes[row.day_key].meal1_votes = parseInt(row.vote_count);
                else if (row.chosen_option === 2) detailedVotes[row.day_key].meal2_votes = parseInt(row.vote_count);
            }
        });
        return detailedVotes;
    } catch (err) { console.error('Error in getVoteCountsByDayAndOption:', err.message); throw err; }
}

async function getUsersWhoChoseOptionOnDay(dayKey, optionNumber) {
    const sql = `
        SELECT u.username FROM user_daily_choices udc
        JOIN users u ON udc.user_id = u.id
        WHERE udc.day_key = $1 AND udc.chosen_option = $2 ORDER BY u.username ASC;
    `;
    try {
        const { rows } = await pool.query(sql, [dayKey, parseInt(optionNumber)]);
        return rows.map(row => row.username);
    } catch (err) { console.error('Error in getUsersWhoChoseOptionOnDay:', err.message); throw err; }
}

// --- MENU MANAGEMENT FUNCTIONS ---
async function getMenuDataFromDB() {
    const sql = "SELECT * FROM daily_menus ORDER BY CASE day_key WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5 ELSE 6 END";
    try {
        const { rows } = await pool.query(sql);
        const menu = {};
        rows.forEach(row => {
            menu[row.day_key] = {
                name: row.day_name_display, meal_1: row.meal_1_description,
                has_two_options: !!row.has_two_options, meal_2: row.meal_2_description,
                option_2_prompt: row.option_2_prompt
            };
        });
        DAYS_OF_WEEK_ORDER.forEach(dayKey => {
            if (!menu[dayKey]) {
                menu[dayKey] = { name: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), meal_1: "Nije definirano", has_two_options: false, meal_2: "", option_2_prompt: "" };
            }
        });
        return menu;
    } catch (err) { console.error('Error in getMenuDataFromDB:', err.message); throw err; }
}

async function getSingleDayMenuFromDB(dayKey) {
    const sql = "SELECT * FROM daily_menus WHERE day_key = $1";
    try {
        const { rows } = await pool.query(sql, [dayKey]);
        if (!rows[0]) {
            return { day_key: dayKey, day_name_display: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), meal_1_description: "", has_two_options: false, meal_2_description: "", option_2_prompt: "" };
        }
        return rows[0];
    } catch (err) { console.error('Error in getSingleDayMenuFromDB:', err.message); throw err; }
}

async function upsertDailyMenu(dayKey, dayNameDisplay, meal1, meal2, hasTwoOptions, option2Prompt) {
    const sql = `
        INSERT INTO daily_menus (day_key, day_name_display, meal_1_description, has_two_options, meal_2_description, option_2_prompt)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(day_key) DO UPDATE SET
            day_name_display = EXCLUDED.day_name_display,
            meal_1_description = EXCLUDED.meal_1_description,
            has_two_options = EXCLUDED.has_two_options,
            meal_2_description = EXCLUDED.meal_2_description,
            option_2_prompt = EXCLUDED.option_2_prompt
        RETURNING *;
    `;
    try {
        const { rows } = await pool.query(sql, [dayKey, dayNameDisplay, meal1, !!hasTwoOptions, meal2, option2Prompt]);
        return rows[0];
    } catch (err) { console.error('Error in upsertDailyMenu:', err.message); throw err; }
}

async function clearDailyMenu(dayKey) {
    const displayName = DAY_DISPLAY_NAMES[dayKey] || dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
    return upsertDailyMenu(dayKey, displayName, "", "", false, "");
}

async function clearWeeklyMenu() {
    console.log("[DB] Pokušaj brisanja (resetiranja) tjednog jelovnika...");
    try {
        for (const dayKey of DAYS_OF_WEEK_ORDER) {
            await clearDailyMenu(dayKey);
        }
        console.log("[DB] Tjedni jelovnik uspješno resetiran.");
        return { success: true, message: "Tjedni jelovnik resetiran." };
    } catch (error) { console.error("[DB] Greška pri resetiranju tjednog jelovnika:", error); throw error; }
}

module.exports = {
    
    DAY_DISPLAY_NAMES,
    addUser, findUserByUsername, verifyPassword,
    saveUserDailyChoice, getUserDailyChoices,
    getAllUsers, findUserById, deleteUserById,
    resetAllVotes, getTotalUsersCount, getTotalOverallChoicesCount,
    getVoteCountsByDayAndOption, getUsersWhoChoseOptionOnDay,
    getMenuDataFromDB, getSingleDayMenuFromDB, upsertDailyMenu,
    clearDailyMenu, clearWeeklyMenu,
    pool 
};