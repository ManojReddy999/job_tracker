// File: job-tracker-backend/server.js

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001; // Use port from environment variable or default to 3001

// Enable CORS for all requests. In a production app, you might want to restrict this.
app.use(cors());

// Health check endpoint to make sure the server is running
app.get('/', (req, res) => {
  res.status(200).send('Job Tracker Backend is running!');
});

// The main proxy endpoint
app.get('/proxy', async (req, res) => {
  const urlToFetch = req.query.url;

  if (!urlToFetch) {
    return res.status(400).json({ error: 'A "url" query parameter is required.' });
  }

  console.log(`Fetching URL: ${urlToFetch}`);

  try {
    const response = await fetch(urlToFetch, {
      // Pretend to be a browser to avoid some simple bot blockers
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
      }
    });

    // Check if the request was successful
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const htmlContent = await response.text();
    res.send(htmlContent);

  } catch (error) {
    console.error('Error in proxy request:', error);
    res.status(500).json({ error: 'Failed to fetch the provided URL.', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});