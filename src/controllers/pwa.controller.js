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

router.get("/", home);
router.post("/notify", notifyUser);
router.post("/subscribe", subscribe);

// Express Routes

/**
 * @openapi
 * /:
 *  get:
 *    summary: Index page for website
 *    description: Retrieves index.html from the static directory
 *    responses:
 *      200:
 *        description: Returns the index.html
 */
function home (req, res) {
    let index_path = path.join(root_dir + "/index.html");
    res.sendFile(index_path);
}


/**
 * @openapi
 * /notify:
 *  post:
 *    summary: Notifies user responsible for alarm
 *    description: Notifies a user responsible for the fire alarm based on the ID
 *    requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            properties:
 *              username:
 *                type: string
 *                description: The user's id.
 *                example: bcsotty
 *              notification:
 *                type: object
 *                properties:
 *                  title:
 *                    type: string
 *                    description: The title of the displayed notification
 *                    example: Fire Detected!
 *                  message:
 *                    type: string
 *                    description: The message attached to the notification
 *                    example: Fire confirmed in room 104.
 *    responses:
 *      200:
 *        description: Push notification sent successfully
 *        content:
 *          text/html:
 *            example: Notification sent successfully!
 *      404:
 *        description: User not found in Users/Subscriptions
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                error:
 *                  type: string
 *                  description: The error when finding the user in the DB
 *                  example: Couldn't find user with provided username
 *      500:
 *        description: Internal server error
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                error:
 *                  type: string
 *                  description: Internal error sending push notification
 *                  example: Error occurred when sending notification
 */
async function notifyUser (req, res) {
    // TODO Need to add security to ensure only the fire alarm server can call this endpoint
    const body = req.body;
    const username = body.username;
    const users = await db.user.findAll({
        attributes: ['id'],
        where: {
            username: username
        }
    });
    if (users.length !== 1) {
        return res.status(404).json({"error": "Couldn't find user with provided username"});
    }
    const user = users[0];
    const subscriptions = await db.subscription.findAll({where: { userId: user.id }});
    if (subscriptions.length !== 1) {
        return res.status(404).json({ "error": "Couldn't find user in subscriptions"})
    }
    const subscription = subscriptions[0];
    const sub = {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
        }
    };
    const notification = body.notification;

    push.sendNotification(sub, JSON.stringify(notification))
        .then((response) => {
            console.log('Received push response: ', response);
            return res.status(200).send("Notification sent successfully!");
        })
        .catch((error) => {
            console.log('Error sending notification: ', error);
            return res.status(500).json({"error": "Error occurred when sending notification"})
        });
}


/**
 * @openapi
 *
 * /subscribe:
 *   post:
 *     summary: Subscribes user to push notifications
 *     description: Subscribes user specified in request to receive notifications from the web server
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sub:
 *                 type: object
 *                 description: The subscription object generated by the web API push manager
 *                 properties:
 *                   endpoint:
 *                     type: string
 *                     description: The generated web endpoint
 *                   expirationTime:
 *                     type: string
 *                     description: The expiration time for the subscription (DOMHighResTimeStamp or null)
 *                     example: null
 *                   keys:
 *                     type: object
 *                     properties:
 *                       p256dh:
 *                         type: string
 *                         description: The Elliptic curve Diffie-Hellman public key
 *                       auth:
 *                         type: string
 *                         description: The authentication secret described in webpush-encryption-08 standard
 *               user:
 *                 type: string
 *                 description: The username of the user who is subscribing
 *                 example: bcsotty
 *     responses:
 *       200:
 *         description: User successfully subscribed
 *         content:
 *           text/html:
 *             example: Subscription linked to bcsotty successfully
 *       404:
 *         description: User not found in database
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error displayed when user not in DB
 *                   example: User not found
 *       409:
 *         description: Endpoint already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: The error displayed when duplicate endpoint is submitted
 *                   example: Duplicate endpoint error
 *       500:
 *         description: Unknown internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: The error displayed when an unknown failure occurred
 *                   example: An unexpected error has occurred
 * */
async function subscribe (req, res) {
    const body = req.body;
    const subscription = body.sub;
    const username = body.user;

    const user = await db.user.findOne({ where: {username: username } });
    try {
        if (user) {
            const sub = await user.createSubscription({
                endpoint: subscription.endpoint,
                expirationTime: subscription.expirationTime,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth
            });
            console.log(`Subscription linked to ${username} successfully`);
            return res.status(200).send(`Subscription linked to ${username} successfully`);
        }
        else {
            return res.status(404).json({"error": "User not found"});
        }
    }
    catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({"error": "Duplicate endpoint error"})
        } else {
            console.log("An unexpected error has occurred: ", err);
            return res.status(500).json({"error": "An unexpected error has occurred"});
        }
    }
}


async function confirmAlarm (req, res) {

    return res.status(200)
}

module.exports = router;