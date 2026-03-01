require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, getDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// Origin verification (Basic Auth bypass prevention)
// CloudFront からの x-origin-verify ヘッダーを検証し、直接アクセスを遮断する
// Lambda環境で未設定の場合は起動を拒否（設定漏れによるサイレントバイパスを防ぐ）
const originSecret = process.env.ORIGIN_VERIFY_SECRET;
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (isLambda && !originSecret) {
    console.error('FATAL: ORIGIN_VERIFY_SECRET is not set in Lambda environment');
    process.exit(1);
}
if (originSecret) {
    app.use((req, res, next) => {
        const receivedSecret = req.headers['x-origin-verify'];
        if (receivedSecret !== originSecret) {
            console.warn(`Unauthorized access attempt blocked. IP: ${req.ip}`);
            return res.status(403).json({ error: 'Forbidden: Direct API access is not allowed' });
        }
        next();
    });
}

// Middleware
app.use(cors());

app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
if (!process.env.S3_IMAGES_BUCKET) {
    app.use('/uploads', express.static(uploadsDir, {
        maxAge: '1y',
        immutable: true
    }));
}

// Routes
const partsRouter = require('./routes/parts');
const categoriesRouter = require('./routes/categories');
const locationsRouter = require('./routes/locations');
const backupRouter = require('./routes/backup');

app.use('/api/parts', partsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/tags', require('./routes/tags'));
app.use('/api/master', require('./routes/master'));
app.use('/api/backup', backupRouter);
app.use('/api/qr', require('./routes/qr'));

// Initialize DB and start server
initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database', err);
});
