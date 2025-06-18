
const { DAYS_OF_WEEK_ORDER } = require('../config/menu'); 

/**
 * Vraća Date objekt koji predstavlja ponedjeljak tjedna u kojem se nalazi zadani datum.
 * @param {Date} d - Ulazni datum (ili string koji se može parsirati u Date).
 * @returns {Date} Objekt datuma koji predstavlja ponedjeljak tog tjedna, postavljen na početak dana (00:00:00).
 */
function getWeekStartDate(d) {
    const date = new Date(d); 
    const day = date.getDay(); 
    
    const diffToMonday = date.getDate() - day + (day === 0 ? -6 : 1); 
    const monday = new Date(date.setDate(diffToMonday));
    monday.setHours(0, 0, 0, 0); 
    return monday;
}

/**
 * Vraća numerički dan u tjednu prema ISO 8601 standardu.
 * Ponedjeljak = 1, Utorak = 2, ..., Nedjelja = 7.
 * @param {Date} d - Ulazni datum.
 * @returns {number} Numerički dan u tjednu (1-7).
 */
function getDayOfWeekNumericISO(d) {
    const date = new Date(d);
    let day = date.getDay(); 
    if (day === 0) { 
        day = 7;
    }
    return day;
}

/**
 * Vraća numerički dan u tjednu kako ga koristi JavaScriptov Date.getDay() (0-6),
 * ali s Nedjeljom kao 7 radi lakšeg mapiranja ili ako je to potrebno negdje.
 * @param {Date} d - Ulazni datum.
 * @returns {number} Numerički dan u tjednu (1-7, gdje je Nedjelja 7).
 */
function getDayOfWeekNumeric(d) {
    const date = new Date(d);
    let day = date.getDay(); 
    if (day === 0) { 
        return 7;    
    }
    return day;      
                     
}


/**
 * Formattira Date objekt u DD.MM.YYYY. string.
 * @param {Date} date - Ulazni Date objekt.
 * @returns {string} Datum u DD.MM.YYYY. formatu.
 */
function formatDateToDDMMYYYY(date) {
    if (!(date instanceof Date) || isNaN(date)) {
        console.warn("formatDateToDDMMYYYY primio neispravan datum:", date);
        return "Nevažeći datum"; 
    }
    const d = new Date(date); 
    const day = ('0' + d.getDate()).slice(-2);
    const month = ('0' + (d.getMonth() + 1)).slice(-2); 
    const year = d.getFullYear();
    return `${day}.${month}.${year}.`; 
}
function formatDateToYYYYMMDD(date) {
    if (!(date instanceof Date) || isNaN(date)) {
        
        console.warn("formatDateToYYYYMMDD primio neispravan datum:", date);
        return ""; 
    }
    const d = new Date(date);
    const year = d.getFullYear();
    const month = ('0' + (d.getMonth() + 1)).slice(-2); 
    const day = ('0' + d.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
}

/**
 * Dohvaća datume i dayKey za radni tjedan (Pon-Pet) koji sadrži zadani referentni datum.
 * @param {Date} referenceDate - Datum unutar tjedna za koji želimo dane.
 * @returns {Array<Object>} Niz objekata, svaki s 'date' (Date objekt), 'dateString' (YYYY-MM-DD) i 'dayKey' ('monday', 'tuesday', ...).
 */
function getWorkWeekDaysForDate(referenceDate) {
    const weekStart = getWeekStartDate(new Date(referenceDate)); 
    const workWeekDays = [];

    for (let i = 0; i < 5; i++) { 
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + i);
        dayDate.setHours(0,0,0,0); 

        if (i < DAYS_OF_WEEK_ORDER.length) { 
            workWeekDays.push({
                date: dayDate,
                dateString: formatDateToYYYYMMDD(dayDate),
                dayKey: DAYS_OF_WEEK_ORDER[i] 
            });
        } else {
            
            console.warn(`Nedostaje dayKey za indeks ${i} u DAYS_OF_WEEK_ORDER.`);
        }
    }
    return workWeekDays;
}

/**
 * Dohvaća datume i dayKey za tekući radni tjedan (Pon-Pet).
 * Wrapper oko getWorkWeekDaysForDate.
 * @returns {Array<Object>} Niz objekata kao što vraća getWorkWeekDaysForDate.
 */
function getCurrentWorkWeekDays() {
    return getWorkWeekDaysForDate(new Date());
}


module.exports = {
    getWeekStartDate,
    getDayOfWeekNumericISO,
    getDayOfWeekNumeric,
    formatDateToYYYYMMDD,
    formatDateToDDMMYYYY, 
    getCurrentWorkWeekDays,
    getWorkWeekDaysForDate 
};