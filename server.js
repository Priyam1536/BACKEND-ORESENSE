// src/index.js

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import express, { json } from 'express';
import cors from 'cors';
import lcaRoutes from './routes/lcaRoutes.js';
import authRoutes from './routes/authRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
dotenv.config(); 

const app = express();
const PORT = process.env.PORT || 8000; 
console.log('USE_MOCK_RESPONSES=', process.env.USE_MOCK_RESPONSES);
// If .env contains a different value than the environment, prefer the .env file value for dev runs
import fs from 'fs';
import path from 'path';
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/^USE_MOCK_RESPONSES=(.*)$/m);
        if (match && typeof match[1] === 'string') {
            const fileVal = match[1].trim();
            if (fileVal.length > 0) {
                process.env.USE_MOCK_RESPONSES = fileVal;
                console.log('Overriding USE_MOCK_RESPONSES from .env ->', fileVal);
            }
        }
    }
} catch (e) {
    console.warn('Could not read .env file to determine USE_MOCK_RESPONSES:', e.message);
}

if (!process.env.USE_MOCK_RESPONSES || process.env.USE_MOCK_RESPONSES === 'false') {
    const useMock = String(process.env.USE_MOCK_RESPONSES || '').toLowerCase() === 'true';
    if (!useMock && process.env.MONGO_URI) {
        mongoose.connect(process.env.MONGO_URI)
            .then(() => console.log('mongoDB connection successful'))
            .catch((err) => console.error(' mongoDB connection error:', err));
    } else {
        console.log('Skipping MongoDB connection - mock responses enabled or MONGO_URI not provided.');
    }

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception thrown:', err);
    });
} else {
    console.log('USE_MOCK_RESPONSES=true — skipping MongoDB connection');
}

app.use(cors());
app.use(json());


app.get('/', (req, res) => {
    res.send('Welcome to CircuMetal AI Backend! API endpoints are at /api/lca');
});


app.use('/api/lca', lcaRoutes); 
app.use('/api/auth', authRoutes); 
app.use('/api/team', teamRoutes);


app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});


app.listen(PORT, () => {
    console.log(`CircuMetal AI Backend server running on http://localhost:${PORT}`);
    console.log(`Explore API at http://localhost:${PORT}/api/lca`);
    console.log(`Auth endpoints available at http://localhost:${PORT}/api/auth`);
});
