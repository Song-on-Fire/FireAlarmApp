// Express router setup
const express = require('express');
const router = express.Router();

// Other imports
const path = require('path');
const root_dir = require('app-root-path');
const db = require(`${root_dir}/src/models`);
const env = process.env.NODE_ENV || 'development'
const config = require(`${root_dir}/src/config/config.json`)[env];

// Authentication middleware
const {authenticateToken, authenticateController} = require(`${root_dir}/src/middleware/auth.js`);

// Web-push setup
const push = require('web-push');
const pushDetails = config.push_details;
push.setVapidDetails(`mailto:${pushDetails.email}`, pushDetails.publicKey, pushDetails.privateKey);

// Applying routes
router.post("/notify", authenticateController, notifyAllUsers);
router.get("/confirm", authenticateController, confirmAlarm);
router.get("/response", authenticateToken, logResponse);

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
 * Returns a datetime
 * */
function unixToDate (unix_timestamp) {
    const date = new Date(unix_timestamp * 1000);

    // Hours part from the timestamp
    const hours = date.getHours();

    // Minutes part from the timestamp
    let minutes = date.getMinutes().toString();

    // Seconds part from the timestamp
    let seconds = date.getSeconds().toString();

    if (minutes.length === 1) {
        minutes = "0" + minutes
    }
    if (seconds.length === 1) {
        seconds = "0" + minutes
    }

    return hours + ':' + minutes.substring(-2) + ':' + seconds.substring(-2);
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
 *       - in: query
 *         name: timestamp
 *         required: true
 *         schema:
 *           type: integer
 *         description: Unix timestamp alarm was triggered at
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
 *                 location:
 *                   type: string
 *                   description: The location of the alarm
 *                   example: "University of Michigan - Dearborn"
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
    const timeStamp = params.timestamp;

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
            'message': `Alarm was triggered at ${alarm.location} at ${unixToDate(timeStamp)}. Please confirm the existence of a fire.`,
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
    const key = `${alarm.id}-${timeStamp}`;
    alarmMap.set(key, [res, alarm.userId, dbSubscriptions.length, successfulNotifications, errors, alarm.location]);
    await delay(15);
    if (alarmMap.get(key)) {
        alarmMap.delete(key);
        return res.status(200).json({
            'confirmed': 'null',
            'location': alarm.location,
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
 *                 location:
 *                   type: string
 *                   description: The location of the alarm
 *                   example: "University of Michigan - Dearborn"
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
 */
async function logResponse (req, res) {
    // Receives user response to the confirm alarm prompt and sends the response
    const params = req.query;

    const db_user = await db.user.findOne( {where: { username: req.user.username} })

    const userId = parseInt(db_user.id);
    const confirmed = params.confirmed
    try {
        for (const [key, value] of alarmMap) {
            if (value[1] === userId) {
                value[0].status(200).json({
                    'confirmed': confirmed,
                    "location": value[5],
                    'totalSubscriptions': value[2],
                    'successfulNotifications': value[3],
                    'errors': value[4]
                });
                alarmMap.delete(key);
            }
        }
    } catch (err) {
        console.log("Error occurred: ", err)
        res.status(500).json({"errors": "Error occurred confirming alarm."})
    }

    return res.status(200).send('Response received');
}

module.exports = router;