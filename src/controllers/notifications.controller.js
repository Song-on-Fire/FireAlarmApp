// Express router setup
const express = require('express');
const router = express.Router();

// Other imports
const path = require('path');
const root_dir = require('app-root-path');
const db = require(`${root_dir}/src/models`);
const env = process.env.NODE_ENV || 'development'
const config = require(`${root_dir}/src/config/config.json`)[env];

// Web-push setup
const push = require('web-push');
const pushDetails = config.push_details;
push.setVapidDetails(`mailto:${pushDetails.email}`, pushDetails.publicKey, pushDetails.privateKey);

// Applying routes
router.post("/notify", notifyAllUsers);
router.get("/confirm", confirmAlarm);
router.get("/response", logResponse);

// Express Routes
/**
 * @openapi
 * /notify:
 *   post:
 *     summary: Notifies all users in the DB - API
 *     description: Notifies all users in the DB of the notification provided
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - notification
 *             properties:
 *               notification:
 *                 type: object
 *                 required:
 *                   - title
 *                   - message
 *                 properties:
 *                   title:
 *                     type: string
 *                     description: The title of the displayed notification
 *                     example: "Fire Detected!"
 *                   message:
 *                     type: string
 *                     description: The message attached to the notification
 *                     example: "Fire confirmed in room 104."
 *     responses:
 *       200:
 *         description: Push notification sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalSubscriptions:
 *                   type: integer
 *                   description: The number of subscriptions the user has (Devices)
 *                   example: 2
 *                 successfulNotifications:
 *                   type: integer
 *                   description: The number of notifications that successfully were sent to the user
 *                   example: 1
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                     example: Error occurred when sending notification
 */
async function notifyAllUsers (req, res) {
    // TODO Need to add security to ensure only the fire alarm server can call this endpoint
    const body = req.body;

    const dbSubscriptions = await db.subscription.findAll();
    if (dbSubscriptions.length === 0) {
        return res.status(200).json({
            "totalSubscriptions": 0,
            "successfulNotifications": 0,
            "errors": []
        });
    }

    let successfulNotifications = 0;
    let errors = [];

    for (let subscription of dbSubscriptions) {
        const sub = {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        };

        const notification = body.notification;

        try {
            await push.sendNotification(sub, JSON.stringify(notification));
            console.log(`Notification sent successfully to user ${subscription.userId}`);
            successfulNotifications++;
        } catch (err) {
            console.log(`Error sending notification to user ${subscription.userId}: `, err);
            errors.push(`Error occurred when sending notification`);
        }
    }

    return res.status(200).json({
        "totalSubscriptions": dbSubscriptions.length,
        "successfulNotifications": successfulNotifications,
        "errors": errors
    });
}


// Map for storing alarm notifications while in processing
let alarmMap = new Map();


/**
 * Returns a promise that delays for the number of seconds specified
 *
 * @param seconds The number of seconds to delay.
 * @return Promise - The promise that will time out for the number of seconds
 * */
function delay (seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}


/**
 * Returns the current UNIX timestamp
 *
 * @return number - The current UNIX timestamp
 * */
function getCurrentTimeStamp () {
    return Date.now();
}


/**
 * @openapi
 *
 * /confirm:
 *   get:
 *     summary: Sends push notification for user to confirm alarm status - API
 *     description: Sends a web-push notification that has prompts the user to confirm/deny the existence of a fire.
 *     parameters:
 *       - in: query
 *         name: alarmId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the alarm to be confirmed
 *     responses:
 *       200:
 *         description: The confirmation prompt was successfully sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 confirmed:
 *                   type: boolean
 *                   description: True if the alarm was confirmed, False if it wasn't, and null if the user didn't respond in time
 *                   example: null
 *                 totalSubscriptions:
 *                   type: integer
 *                   description: The number of subscriptions the user has (Devices)
 *                   example: 2
 *                 successfulNotifications:
 *                   type: integer
 *                   description: The number of notifications that successfully were sent to the user
 *                   example: 1
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                     example: "Error occurred when sending notification"
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Invalid/missing query parameter
 *                   example: "Missing or incorrect parameters"
 *       404:
 *         description: Unable to find alarm, alarm doesn't have user, or user doesn't have subscription
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: The error that occurred
 *                   example: "Couldn't find alarm with provided alarm ID"
 *       500:
 *         description: Unknown server error (Likely DB related)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Unknown error occurred"
 */
async function confirmAlarm (req, res) {
    // Receives alarm ID from controller -> Gets primary user for alarm from DB -> Notifies primary user of the fire and
    // asks for confirmation -> Wait for response to come from the PWA -> If response not received within 10 seconds,
    // return "null", otherwise return "true" or "false" corresponding to confirmed/denied.
    const params = req.query;
    if (!params.alarmId)
        return res.status(400).json({"error": "Missing or incorrect parameters"});

    const alarmId = params.alarmId;
    let alarm = null;
    let dbSubscriptions = null;
    try {
        const alarms = await db.alarm.findAll({
            where: {
                alarmSerial: alarmId
            }
        });
        if (alarms.length === 0)
            return res.status(404).json({"error": "Couldn't find alarm with provided alarm ID"});

        alarm = alarms[0];
        if (!alarm.userId)
            return res.status(404).json({"error": "Alarm doesn't have a user assigned"});

        dbSubscriptions = await db.subscription.findAll({where: {userId: alarm.userId}});
        if (dbSubscriptions.length === 0)
            return res.status(404).json({"error": "Couldn't find user in subscriptions"});
    } catch (err) {
        console.error('Unknown error occurred: ', err);
        return res.status(500).json({ 'error': 'Unknown error occurred' });
    }

    let successfulNotifications = 0;
    let errors = [];

    for (let subscription of dbSubscriptions) {
        const sub = {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        };

        const notification = {
            'title': 'Alarm Confirmation',
            'message': `Alarm was triggered at ${alarm.location}. Please confirm the existence of a fire.`,
            'actions': [
                {
                    'action': 'confirm',
                    'title': 'Confirm Alarm',
                    'type': 'button'
                },
                {
                    'action': 'deny',
                    'title': 'False Alarm',
                    'type': 'button'
                }
            ]
        };

        try {
            await push.sendNotification(sub, JSON.stringify(notification));
            console.log(`Confirm prompt successfully sent`);
            successfulNotifications++;
        } catch (err) {
            console.log(`Error sending confirm prompt: `, err);
            errors.push(`Error occurred when sending notification`);
        }
    }

    // Below code handles communicating back to controller
    const currentTime = getCurrentTimeStamp();
    const key = `${alarm.id}-${currentTime}`;
    alarmMap.set(key, [res, alarm.userId, dbSubscriptions.length, successfulNotifications, errors]);
    await delay(15);
    if (alarmMap.get(key)) {
        alarmMap.delete(key);
        return res.status(200).json({
            'confirmed': 'null',
            'totalSubscriptions': dbSubscriptions.length,
            'successfulNotifications': successfulNotifications,
            'errors': errors
        });
    }
}


/**
 * @openapi
 * /response:
 *   get:
 *     summary: Log user response to alarm confirmation - API
 *     description: Takes user response to the alarm confirmation and sends it back to the controller
 *     parameters:
 *       - in: query
 *         name: confirmed
 *         required: true
 *         schema:
 *           type: boolean
 *         description: Whether the alarm has been confirmed or is a false alarm
 *       - in: query
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The user ID of the user giving response. (Replaced with token in future)
 *     responses:
 *       200:
 *         description: Response received by server
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: "Response received."
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Missing or incorrect parameters"
 */
async function logResponse (req, res) {
    // Receives user response to the confirm alarm prompt and sends the response
    // TODO: Add validation on the query parameters per openAPI spec
    // TODO: Needs to retrieve user info based on tokens for selecting the correct response
    const params = req.query;
    if (!params.confirmed || !params.userId)
        return res.status(400).json({ 'error': 'Missing or incorrect parameters' });

    const userId = parseInt(params.userId);
    const confirmed = (params.confirmed === 'true'); // Since params are strings, this converts to the proper type
    for (const [key, value] of alarmMap) {
        console.log(value[1], userId);
        if (value[1] === userId) {
            value[0].status(200).json({
                'confirmed': confirmed,
                'totalSubscriptions': value[2],
                'successfulNotifications': value[3],
                'errors': value[4]
            });
            alarmMap.delete(key);
        }
    }
    return res.status(200).send('Response received');
}

module.exports = router;