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

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('mongoDB connection successful'))
  .catch((err) => console.error(' mongoDB connection error:', err));

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
