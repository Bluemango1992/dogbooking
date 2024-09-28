// api/createDogEvent.js

import express from 'express';
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// Define the scopes and paths
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Mapping of service types to colorIds
const SERVICE_TYPE_COLORS = {
  "Day Care": "1",   // Lavender
  "Walk": "2",       // Sage
  "Boarding": "3",   // Grape
  // Add more service types and their corresponding colorIds as needed
};

/**
 * Route to initiate OAuth2 authorization.
 * Users should visit this route to grant the application access to their Google Calendar.
 */
router.get('/authorize', async (req, res) => {
  try {
    // Load client credentials from credentials.json
    const content = await fs.readFile(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.installed;

    // Create an OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Generate the authorization URL
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    // Redirect the user to the authorization URL
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error loading client secret file:', error);
    res.status(500).send('Error loading client secret file.');
  }
});

/**
 * OAuth2 callback route.
 * Google will redirect users to this route after they authorize the application.
 */
router.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Authorization code not found.');
  }

  try {
    // Load client credentials
    const content = await fs.readFile(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.installed;

    // Create an OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Exchange the authorization code for access tokens
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Store the tokens to token.json for future use
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    console.log('Token stored to', TOKEN_PATH);

    res.send('Authorization successful! You can now close this window and use the application.');
  } catch (error) {
    console.error('Error retrieving access token:', error);
    res.status(500).send('Error retrieving access token.');
  }
});

/**
 * Helper function to authorize and obtain an OAuth2 client.
 * Throws an error if authorization is required.
 */
async function authorize() {
  try {
    // Load client credentials
    const content = await fs.readFile(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.installed;

    // Create an OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Load previously saved tokens
    const token = await fs.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));

    // Listen for token refresh events
    oAuth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        // Store the refresh_token in your database or file system
        fs.writeFile(TOKEN_PATH, JSON.stringify(tokens))
          .then(() => console.log('Refresh token stored to', TOKEN_PATH))
          .catch(err => console.error('Error storing refresh token:', err));
      }
      console.log('Access token refreshed:', tokens.access_token);
    });

    return oAuth2Client;
  } catch (error) {
    console.log('No token found. Authorization is required.');
    throw new Error('Authorization required.');
  }
}

/**
 * Route to create a dog event in Google Calendar.
 * Expects a POST request with JSON body containing:
 * - dogName
 * - pickUpTime
 * - dropOffTime
 * - serviceType
 */
router.post('/createDogEvent', async (req, res) => {
  const { dogName, pickUpTime, dropOffTime, serviceType } = req.body;

  try {
    // Authorize and get OAuth2 client
    const auth = await authorize();

    // Insert the event into Google Calendar
    const event = await insertEvent(auth, dogName, pickUpTime, dropOffTime, serviceType);

    res.json({ message: 'Event created!', eventLink: event.htmlLink });
  } catch (error) {
    if (error.message === 'Authorization required.') {
      // If not authorized, prompt the user to authorize
      res.status(401).json({ message: 'Authorization required. Please authorize the app.', authorizeUrl: '/api/authorize' });
    } else {
      console.error('Error creating dog event:', error);
      res.status(500).json({ message: 'Error creating the event.', errorDetails: error.message });
    }
  }
});

/**
 * Function to insert an event into Google Calendar.
 * @param {OAuth2Client} auth - The authorized OAuth2 client.
 * @param {string} dogName - Name of the dog.
 * @param {string} pickUpTime - ISO string of pick-up time.
 * @param {string} dropOffTime - ISO string of drop-off time.
 * @param {string} serviceType - Type of service (e.g., Day Care, Walk, Boarding).
 * @returns {object} - The created event data.
 */
async function insertEvent(auth, dogName, pickUpTime, dropOffTime, serviceType) {
  const calendar = google.calendar({ version: 'v3', auth });

  // Normalize the serviceType to ensure consistent mapping
  const normalizedServiceType = toTitleCase(serviceType.trim());
  console.log('Normalized serviceType:', normalizedServiceType);

  // Determine the colorId based on the serviceType
  const colorId = SERVICE_TYPE_COLORS[normalizedServiceType] || "9"; // Default to Blueberry if not mapped
  console.log(`Assigned colorId for serviceType "${normalizedServiceType}":`, colorId);

  // Create the event object without attendees
  const event = {
    summary: `${dogName} - ${normalizedServiceType}`,
    location: '123 Dog Street, City',
    description: `${dogName}'s ${normalizedServiceType} service.`,
    start: {
      dateTime: pickUpTime,
      timeZone: 'Europe/London',
    },
    end: {
      dateTime: dropOffTime,
      timeZone: 'Europe/London',
    },
    // Removed attendees since ownerEmail is no longer used
    extendedProperties: {
      private: {
        dogName,
        pickUpTime,
        dropOffTime,
        serviceType: normalizedServiceType,
      },
    },
    colorId: colorId, // Assign the colorId based on serviceType
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 }, // Email reminder 24 hours before
        { method: 'popup', minutes: 10 },      // Popup reminder 10 minutes before
      ],
    },
  };

  // Log the event payload for debugging
  console.log('Event Payload:', JSON.stringify(event, null, 2));

  try {
    // Insert the event into the primary calendar
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    console.log('Event created: %s', response.data.htmlLink);
    return response.data;
  } catch (error) {
    console.error('Error inserting event into Google Calendar:', error);
    throw error;
  }
}

/**
 * Helper function to convert string to Title Case
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  return str.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

export default router;
