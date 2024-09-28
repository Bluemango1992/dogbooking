// app.js

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import createDogEventRoute from './api/createDogEvent.js'; // Import the updated route

// __dirname replacement for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files (e.g., index.html, styles.css) from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Use the route for creating the Google Calendar event
app.use('/api', createDogEventRoute);

// Serve index.html for the root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
