const { initDb, getDb } = require('./database');

(async () => {
    try {
        await initDb();
        const db = getDb();
        const parts = await db.all('SELECT * FROM parts');
        console.log('Parts count:', parts.length);
        console.log('Parts:', JSON.stringify(parts, null, 2));
    } catch (err) {
        console.error(err);
    }
})();
