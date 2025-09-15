
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { DAYS_OF_WEEK_ORDER } = require('./config/menu'); 
const { getWeekStartDate, getDayOfWeekNumeric, formatDateToYYYYMMDD } = require('./utils/dateUtils'); 

const DAY_DISPLAY_NAMES = {
    monday: "PONEDJELJAK",
    tuesday: "UTORAK",
    wednesday: "SRIJEDA",
    thursday: "ČETVRTAK",
    friday: "PETAK"
};

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "5432"),
    // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initializeDatabase() {
    const client = await pool.connect();
    try {
        console.log('Successfully connected to the PostgreSQL database for init.');
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL, is_admin BOOLEAN DEFAULT FALSE NOT NULL
            );
        `);
        console.log('Table "users" checked/created.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS daily_menus (
                day_key TEXT PRIMARY KEY, day_name_display TEXT NOT NULL,
                meal_1_description TEXT, has_two_options BOOLEAN DEFAULT FALSE NOT NULL,
                meal_2_description TEXT, option_2_prompt TEXT,
                no_offer_today BOOLEAN DEFAULT FALSE NOT NULL
            );
        `);
        console.log('Table "daily_menus" (template) checked/created.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS archived_weekly_menu_items (
                id SERIAL PRIMARY KEY,
                week_start_date DATE NOT NULL,
                day_key TEXT NOT NULL,
                day_name_display TEXT NOT NULL,
                meal_1_description TEXT,
                has_two_options BOOLEAN DEFAULT FALSE NOT NULL,
                meal_2_description TEXT,
                option_2_prompt TEXT,
                no_offer_today BOOLEAN DEFAULT FALSE NOT NULL,
                published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (week_start_date, day_key)
            );
        `);
        console.log('Table "archived_weekly_menu_items" checked/created.');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_archived_menu_week_day ON archived_weekly_menu_items (week_start_date, day_key);`);
        console.log('Index for "archived_weekly_menu_items" checked/created.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_daily_choices (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                week_start_date DATE NOT NULL,
                day_of_week_numeric INTEGER NOT NULL, 
                chosen_option INTEGER NOT NULL,     
                chosen_meal_description TEXT,       -- Stupac za točan opis jela
                CONSTRAINT unique_user_weekly_daily_choice UNIQUE (user_id, week_start_date, day_of_week_numeric)
            );
        `);
        try {
            await client.query(`
                ALTER TABLE user_daily_choices 
                ADD COLUMN IF NOT EXISTS is_second_shift BOOLEAN NOT NULL DEFAULT FALSE;
            `);
            console.log('Column "is_second_shift" checked/created in "user_daily_choices".');
        } catch(err) {
            console.warn('Could not add "is_second_shift" column, it might already exist with different constraints:', err.message);
        }
        console.log('Table "user_daily_choices" checked/created.');
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_user_daily_choices_week_day ON user_daily_choices (week_start_date, day_of_week_numeric);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_user_daily_choices_user_week ON user_daily_choices (user_id, week_start_date);`);
        console.log('Indexes for "user_daily_choices" checked/created.');

        await initializeDefaultDailyMenus(client);
        console.log('Database initialization complete.');
    } catch (err) {
        console.error('Error during database initialization:', err.stack);
        process.exit(1);
    } finally {
        client.release();
    }
}
initializeDatabase();

async function initializeDefaultDailyMenus(dbClient) {
    const { rows } = await dbClient.query("SELECT COUNT(*) as count FROM daily_menus");
    if (parseInt(rows[0].count) === 0) {
        console.log("[DB Init] Initializing daily_menus (template) table with default days...");
        const sql = `INSERT INTO daily_menus 
                        (day_key, day_name_display, meal_1_description, has_two_options, 
                         meal_2_description, option_2_prompt, no_offer_today) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (day_key) DO NOTHING`;
        for (const dayKey of DAYS_OF_WEEK_ORDER) {
            await dbClient.query(sql, [
                dayKey, 
                DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), 
                "", 
                false, 
                "",  
                "",  
                false 
            ]);
        }
        console.log("[DB Init] daily_menus (template) table initialized.");
    }
}

// --- USER FUNCTIONS ---
async function addUser(username, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = "INSERT INTO users (username, password, is_admin) VALUES ($1, $2, FALSE) RETURNING id, username, is_admin";
    try { const { rows } = await pool.query(sql, [username, hashedPassword]); return rows[0]; }
    catch (err) { console.error('Error in addUser:', err.message); throw err; }
}
async function findUserByUsername(username) {
    const sql = "SELECT * FROM users WHERE username = $1";
    try { const { rows } = await pool.query(sql, [username]); return rows[0]; }
    catch (err) { console.error('Error in findUserByUsername:', err.message); throw err; }
}
async function verifyPassword(plainPassword, hashedPassword) { return bcrypt.compare(plainPassword, hashedPassword); }

// --- MENU TEMPLATE FUNCTIONS (rade s daily_menus tablicom) ---
async function getMenuTemplate() {
    const sql = "SELECT * FROM daily_menus ORDER BY CASE day_key WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5 ELSE 6 END";
    try {
        const { rows } = await pool.query(sql);
        const menu = {};
        DAYS_OF_WEEK_ORDER.forEach(dayKey => {
            menu[dayKey] = { 
                name: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), 
                meal_1: "Nije definirano", 
                has_two_options: false, 
                meal_2: "", 
                option_2_prompt: "",
                no_offer_today: false 
            };
        });
        rows.forEach(row => {
            menu[row.day_key] = {
                name: row.day_name_display, meal_1: row.meal_1_description,
                has_two_options: !!row.has_two_options, meal_2: row.meal_2_description,
                option_2_prompt: row.option_2_prompt,
                no_offer_today: !!row.no_offer_today 
            };
        });
        return menu;
    } catch (err) { console.error('Error in getMenuTemplate:', err.message); throw err; }
}

async function getSingleDayMenuTemplate(dayKey) {
    const sql = "SELECT * FROM daily_menus WHERE day_key = $1";
    try {
        const { rows } = await pool.query(sql, [dayKey]);
        if (!rows[0]) { 
            return { 
                day_key: dayKey, day_name_display: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), 
                meal_1_description: "", has_two_options: false, meal_2_description: "", option_2_prompt: "",
                no_offer_today: false 
            }; 
        }
        
        rows[0].has_two_options = !!rows[0].has_two_options;
        rows[0].no_offer_today = !!rows[0].no_offer_today;
        return rows[0];
    } catch (err) { console.error('Error in getSingleDayMenuTemplate:', err.message); throw err; }
}

async function upsertDailyMenuTemplate(dayKey, dayNameDisplay, meal1, meal2, hasTwoOptions, option2Prompt, noOfferToday) {
    const isNoOffer = !!noOfferToday;

    //console.log(`UPSERT - dayKey: ${dayKey}, meal1: ${meal1}, meal2: ${meal2}, hasTwoOptions: ${hasTwoOptions}, noOffer: ${isNoOffer}`);

    const sql = `
        INSERT INTO daily_menus (day_key, day_name_display, 
                                 meal_1_description, has_two_options, meal_2_description, 
                                 option_2_prompt, no_offer_today)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT(day_key) DO UPDATE SET
            day_name_display = EXCLUDED.day_name_display, 
            meal_1_description = EXCLUDED.meal_1_description,
            has_two_options = EXCLUDED.has_two_options, 
            meal_2_description = EXCLUDED.meal_2_description,
            option_2_prompt = EXCLUDED.option_2_prompt,
            no_offer_today = EXCLUDED.no_offer_today
        RETURNING *;
    `;
    try { 
        const { rows } = await pool.query(sql, [
            dayKey, dayNameDisplay,
            isNoOffer ? null : meal1,
            isNoOffer ? false : !!hasTwoOptions,
            isNoOffer ? null : (!!hasTwoOptions ? meal2 : null),
            isNoOffer ? null : (!!hasTwoOptions ? option2Prompt : null),
            isNoOffer
        ]); 
        //console.log("Vraćeno iz upsertDailyMenuTemplate:", rows[0]);
        return rows[0];
    } catch (err) { console.error('Error in upsertDailyMenuTemplate:', err.message, err.stack); throw err; }
}

async function clearDailyMenuTemplate(dayKey) {
    const displayName = DAY_DISPLAY_NAMES[dayKey] || dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
    return upsertDailyMenuTemplate(dayKey, displayName, "", "", false, "", false); 
}

async function clearWeeklyMenuTemplate() {
    console.log("[DB] Pokušaj resetiranja TEMPLATEA tjednog jelovnika...");
    try {
        for (const dayKey of DAYS_OF_WEEK_ORDER) { await clearDailyMenuTemplate(dayKey); }
        console.log("[DB] Template tjednog jelovnika uspješno resetiran."); return { success: true };
    } catch (error) { console.error("[DB] Greška pri resetiranju templatea tjednog jelovnika:", error); throw error; }
}

// --- ARCHIVED MENU FUNCTIONS ---
async function getArchivedMenuForWeek(weekStartDateString) {
    const sql = "SELECT * FROM archived_weekly_menu_items WHERE week_start_date = $1 ORDER BY CASE day_key WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5 ELSE 6 END";
    try {
        const { rows } = await pool.query(sql, [weekStartDateString]);
        if (rows.length < DAYS_OF_WEEK_ORDER.length && rows.length > 0) { 
            console.warn(`[DB] Arhivirani meni za tjedan ${weekStartDateString} je NEPOTPUN (${rows.length}/5 dana). Vraćam ga takvog.`);
        } else if (rows.length === 0) {
            console.log(`[DB] Nema arhiviranog menija za tjedan ${weekStartDateString}.`);
            return null;
        }
        const menu = {};
        DAYS_OF_WEEK_ORDER.forEach(dayKey => { 
            menu[dayKey] = { name: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(), meal_1: "Nije objavljeno", has_two_options: false, no_offer_today: false };
        });
        rows.forEach(row => { 
            menu[row.day_key] = {
                name: row.day_name_display, meal_1: row.meal_1_description,
                has_two_options: !!row.has_two_options, meal_2: row.meal_2_description,
                option_2_prompt: row.option_2_prompt,
                no_offer_today: !!row.no_offer_today 
            };
        });
        return menu;
    } catch (err) { console.error('Error in getArchivedMenuForWeek:', err.message); throw err; }
}

async function publishMenuForWeek(weekStartDateString) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const templateMenu = await getMenuTemplate(); 

        for (const dayKey of DAYS_OF_WEEK_ORDER) {
            const menuItem = templateMenu[dayKey];
            if (!menuItem) { 
                console.warn(`[DB Publish] Nedostaje template za dan ${dayKey}. Preskačem.`);
                continue;
            }
            const isNoOffer = !!menuItem.no_offer_today;
            const sql = `
                INSERT INTO archived_weekly_menu_items 
                    (week_start_date, day_key, day_name_display, 
                     meal_1_description, has_two_options, meal_2_description, 
                     option_2_prompt, no_offer_today)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (week_start_date, day_key) DO UPDATE SET
                    day_name_display = EXCLUDED.day_name_display, 
                    meal_1_description = EXCLUDED.meal_1_description,
                    has_two_options = EXCLUDED.has_two_options, 
                    meal_2_description = EXCLUDED.meal_2_description,
                    option_2_prompt = EXCLUDED.option_2_prompt,
                    no_offer_today = EXCLUDED.no_offer_today, 
                    published_at = CURRENT_TIMESTAMP;
            `;
            await client.query(sql, [
                weekStartDateString, dayKey,
                menuItem.name, 
                isNoOffer ? null : (menuItem.meal_1 || null), 
                isNoOffer ? false : !!menuItem.has_two_options,
                isNoOffer ? null : (!!menuItem.has_two_options ? (menuItem.meal_2 || null) : null), 
                isNoOffer ? null : (!!menuItem.has_two_options ? (menuItem.option_2_prompt || null) : null),
                isNoOffer 
            ]);
        }
        await client.query('COMMIT');
        console.log(`[DB] Jelovnik uspješno objavljen za tjedan ${weekStartDateString}`);
        return { success: true };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error in publishMenuForWeek:', err.message, err.stack); throw err;
    } finally {
        client.release();
    }
}

// --- MEAL CHOICE FUNCTIONS ---
async function saveUserDailyChoice(userId, dateString, chosenOptionString, isSecondShift = false) {
    const option = parseInt(chosenOptionString);
    const actualDate = new Date(dateString + "T00:00:00Z");
    const weekStartDateObject = getWeekStartDate(actualDate);
    const weekStartDateFormatted = formatDateToYYYYMMDD(weekStartDateObject);
    const dayOfWeekNumeric = getDayOfWeekNumeric(actualDate);

    if (dayOfWeekNumeric < 1 || dayOfWeekNumeric > 5) { return { changes: 0, message: "Odabir je moguć samo za radne dane." }; }

    try {
        const dayKeyForMenu = DAYS_OF_WEEK_ORDER[dayOfWeekNumeric - 1];
        const currentArchivedMenu = await getArchivedMenuForWeek(weekStartDateFormatted);

        
        if (currentArchivedMenu && currentArchivedMenu[dayKeyForMenu] && currentArchivedMenu[dayKeyForMenu].no_offer_today) {
            console.log(`[DB SaveChoice] Nema ponude za ${dayKeyForMenu} (tjedan ${weekStartDateFormatted}) prema arhiviranom meniju. Glas se neće spremiti/bit će obrisan.`);
            
            const sqlDelete = `DELETE FROM user_daily_choices WHERE user_id = $1 AND week_start_date = $2 AND day_of_week_numeric = $3;`;
            const deleteResult = await pool.query(sqlDelete, [userId, weekStartDateFormatted, dayOfWeekNumeric]);
            return { changes: deleteResult.rowCount, message: "Nema ponude jela za odabrani dan." };
        }

        if (option === 1 || option === 2) {
            let chosenMealDesc = null;
            let sourceMenuItem = null;

            if (currentArchivedMenu && currentArchivedMenu[dayKeyForMenu]) {
                sourceMenuItem = currentArchivedMenu[dayKeyForMenu];
            } else { 
                console.warn(`[DB SaveChoice] Nema arhiviranog menija za ${weekStartDateFormatted} za dan ${dayKeyForMenu}, koristim template za opis jela.`);
                const templateMenu = await getMenuTemplate();
                if (templateMenu && templateMenu[dayKeyForMenu]) {
                    sourceMenuItem = templateMenu[dayKeyForMenu];
                }
            }

            if (sourceMenuItem) {
                if (option === 1) chosenMealDesc = sourceMenuItem.meal_1;
                else if (option === 2 && sourceMenuItem.has_two_options) chosenMealDesc = sourceMenuItem.meal_2;
            }
            
            if (!chosenMealDesc) chosenMealDesc = `Jelo ${option}`;

            const sql = `
                INSERT INTO user_daily_choices (user_id, week_start_date, day_of_week_numeric, chosen_option, chosen_meal_description, is_second_shift)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT(user_id, week_start_date, day_of_week_numeric) DO UPDATE SET
                    chosen_option = EXCLUDED.chosen_option, chosen_meal_description = EXCLUDED.chosen_meal_description, is_second_shift = EXCLUDED.is_second_shift;
            `;
            const result = await pool.query(sql, [userId, weekStartDateFormatted, dayOfWeekNumeric, option, chosenMealDesc, !!isSecondShift]);
            return { changes: result.rowCount };
        } else {
            const sql = `DELETE FROM user_daily_choices WHERE user_id = $1 AND week_start_date = $2 AND day_of_week_numeric = $3;`;
            const result = await pool.query(sql, [userId, weekStartDateFormatted, dayOfWeekNumeric]);
            return { changes: result.rowCount };
        }
    } catch (err) { console.error('Error in saveUserDailyChoice:', err.message, err.stack); throw err; }
}

async function getUserChoicesForWeek(userId, weekStartDateString) {
    const sql = "SELECT day_of_week_numeric, chosen_option, chosen_meal_description, is_second_shift FROM user_daily_choices WHERE user_id = $1 AND week_start_date = $2";
    try {
        const { rows } = await pool.query(sql, [userId, weekStartDateString]);
        const choices = {};
        for (let i = 1; i <= 5; i++) { choices[i] = { option: null, description: null, isSecondShift: false }; }
        rows.forEach(row => { 
            choices[row.day_of_week_numeric] = { option: row.chosen_option, description: row.chosen_meal_description, isSecondShift: !!row.is_second_shift };
        });
        return choices;
    } catch (err) { 
        console.error('Error in getUserChoicesForWeek:', err.message); 
        const emptyChoices = {};
        for (let i = 1; i <= 5; i++) { emptyChoices[i] = { option: null, description: null }; }
        return emptyChoices;
    }
}

// --- ADMIN STATS FUNCTIONS ---
async function getAllUsers(searchTerm = '') {
    let sql = "SELECT id, username, is_admin FROM users";
    const params = [];
    if (searchTerm) {
        sql += " WHERE username ILIKE $1"; 
        params.push(`%${searchTerm}%`); 
    }
    sql += " ORDER BY username ASC";
    
    try {
        const { rows } = await pool.query(sql, params);
        return rows;
    } catch (err) { 
        console.error('Error in getAllUsers:', err.message, err.stack); 
        throw err; 
    }
}
async function findUserById(userId) {
    const sql = "SELECT id, username, is_admin FROM users WHERE id = $1";
    try { const { rows } = await pool.query(sql, [userId]); return rows[0]; }
    catch (err) { console.error('Error in findUserById:', err.message); throw err; }
}
async function deleteUserById(userId) {
    const sql = "DELETE FROM users WHERE id = $1 RETURNING id;"; // RETURNING da vidimo je li obrisan
    try { const result = await pool.query(sql, [userId]); return { changes: result.rowCount }; }
    catch (err) { console.error('Error in deleteUserById:', err.message); throw err; }
}
async function resetAllVotesForWeek(weekStartDateString) {
    const sql = "DELETE FROM user_daily_choices WHERE week_start_date = $1";
    try {
        const result = await pool.query(sql, [weekStartDateString]);
        console.log(`[DB] Resetirani glasovi za tjedan ${weekStartDateString}: ${result.rowCount} redova obrisano.`);
        return { changes: result.rowCount };
    } catch (err) { console.error('Error in resetAllVotesForWeek:', err.message); throw err; }
}
async function getTotalUsersCount() {
    const sql = "SELECT COUNT(*) as count FROM users";
    try { const { rows } = await pool.query(sql); return parseInt(rows[0].count); }
    catch (err) { console.error('Error in getTotalUsersCount:', err.message); throw err; }
}
async function getTotalOverallChoicesCountForWeek(weekStartDateString) {
    const sql = "SELECT COUNT(*) as count FROM user_daily_choices WHERE week_start_date = $1";
    try { const { rows } = await pool.query(sql, [weekStartDateString]); return parseInt(rows[0].count); }
    catch (err) { console.error('Error in getTotalOverallChoicesCountForWeek:', err.message); throw err; }
}
async function getVoteCountsByDayAndOptionForWeek(weekStartDateString) {
    const sql = `
        SELECT day_of_week_numeric, chosen_option, COUNT(user_id) as vote_count
        FROM user_daily_choices WHERE week_start_date = $1
        GROUP BY day_of_week_numeric, chosen_option
        ORDER BY day_of_week_numeric, chosen_option;
    `;
    try {
        const { rows } = await pool.query(sql, [weekStartDateString]);
        const detailedVotes = {};
        DAYS_OF_WEEK_ORDER.forEach((dayKey, index) => {
            detailedVotes[index + 1] = {
                dayName: DAY_DISPLAY_NAMES[dayKey] || dayKey.toUpperCase(),
                meal1_votes: 0, meal2_votes: 0
            };
        });
        rows.forEach(row => {
            if (detailedVotes[row.day_of_week_numeric]) {
                if (row.chosen_option === 1) detailedVotes[row.day_of_week_numeric].meal1_votes = parseInt(row.vote_count);
                else if (row.chosen_option === 2) detailedVotes[row.day_of_week_numeric].meal2_votes = parseInt(row.vote_count);
            }
        });
        return detailedVotes;
    } catch (err) { console.error('Error in getVoteCountsByDayAndOptionForWeek:', err.message); throw err; }
}
async function getUsersWhoChoseOptionOnDate(weekStartDateString, dayOfWeekNumeric, optionNumber) {
    const sql = `
        SELECT u.username, udc.is_second_shift FROM user_daily_choices udc
        JOIN users u ON udc.user_id = u.id
        WHERE udc.week_start_date = $1 AND udc.day_of_week_numeric = $2 AND udc.chosen_option = $3 
        ORDER BY u.username ASC;
    `;
    try {
        const { rows } = await pool.query(sql, [weekStartDateString, dayOfWeekNumeric, parseInt(optionNumber)]);
        return rows.map(row => ({
            username: row.username,
            isSecondShift: !!row.is_second_shift
        }));
    } catch (err) { console.error('Error in getUsersWhoChoseOptionOnDate:', err.message); throw err; }
}
async function getMealPopularityStats(weekStartDateString = null) {
    let sql = `
        SELECT chosen_meal_description, COUNT(*) as times_chosen
        FROM user_daily_choices
    `;
    const params = [];
    if (weekStartDateString) {
        sql += ` WHERE week_start_date = $1 `;
        params.push(weekStartDateString);
    }
    sql += ` GROUP BY chosen_meal_description
             HAVING chosen_meal_description IS NOT NULL AND chosen_meal_description != '' 
             ORDER BY times_chosen DESC, chosen_meal_description ASC;`;
    try {
        const { rows } = await pool.query(sql, params);
        return rows.map(row => ({ meal: row.chosen_meal_description, count: parseInt(row.times_chosen) }));
    } catch (err) { console.error('Error in getMealPopularityStats:', err.message); return []; }
}
async function getAvailableWeeksForChoices() {
    const sql = `SELECT DISTINCT week_start_date FROM user_daily_choices ORDER BY week_start_date DESC;`;
    try {
        const { rows } = await pool.query(sql);
        return rows.map(row => formatDateToYYYYMMDD(new Date(row.week_start_date)));
    } catch (err) { console.error("Error fetching available weeks for choices:", err); return []; }
}

async function getDetailedChoicesForWeekExport(weekStartDateString) {
    const sql = `
        SELECT 
            u.username,
            udc.week_start_date, 
            udc.day_of_week_numeric,
            udc.is_second_shift,
            dm_template.day_name_display,
            udc.chosen_option,
            udc.chosen_meal_description
        FROM user_daily_choices udc
        JOIN users u ON udc.user_id = u.id
        LEFT JOIN daily_menus dm_template ON dm_template.day_key = (
            SELECT day_key FROM (
                SELECT 'monday' as day_key, 1 as num UNION ALL SELECT 'tuesday', 2 UNION ALL
                SELECT 'wednesday', 3 UNION ALL SELECT 'thursday', 4 UNION ALL SELECT 'friday', 5
            ) as day_map WHERE day_map.num = udc.day_of_week_numeric
        )
        WHERE udc.week_start_date = $1
        ORDER BY udc.day_of_week_numeric, u.username; -- Promijenjen order radi lakšeg grupiranja po danu
    `;
    try {
        const { rows } = await pool.query(sql, [weekStartDateString]);
        return rows.map(row => ({
            username: row.username,
            dayName: row.day_name_display || (DAY_DISPLAY_NAMES[DAYS_OF_WEEK_ORDER[row.day_of_week_numeric-1]] || `Dan ${row.day_of_week_numeric}`),
            dayNumeric: row.day_of_week_numeric,
            chosenOption: row.chosen_option, 
            chosenMealDescription: row.chosen_meal_description || `Jelo ${row.chosen_option} - opis nije spremljen`,
            isSecondShift: !!row.is_second_shift
        }));
    } catch (err) {
        console.error('Error in getDetailedChoicesForWeekExport:', err.message); 
        throw err; 
    }
}

module.exports = {
    pool,
    DAY_DISPLAY_NAMES,
    addUser, findUserByUsername, verifyPassword,
    getMenuTemplate, getSingleDayMenuTemplate, upsertDailyMenuTemplate,
    clearDailyMenuTemplate, clearWeeklyMenuTemplate,
    getArchivedMenuForWeek, publishMenuForWeek,
    saveUserDailyChoice, getUserChoicesForWeek,
    getAllUsers, findUserById, deleteUserById,
    resetAllVotesForWeek, 
    getTotalUsersCount, getTotalOverallChoicesCountForWeek,
    getVoteCountsByDayAndOptionForWeek, getUsersWhoChoseOptionOnDate,
    getMealPopularityStats, getAvailableWeeksForChoices,
    getDetailedChoicesForWeekExport 
};