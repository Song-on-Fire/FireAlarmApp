// Express router setup
const express = require('express');
const router = express.Router();

// Other imports
const path = require('path');
const bcrypt = require('bcrypt');
const saltRounds = 10;
const jwt = require('jsonwebtoken');

const root_dir = require('app-root-path');
const db = require(`${root_dir}/src/models`);
const env = process.env.NODE_ENV || 'development'
const config = require(`${root_dir}/src/config/config.json`)[env];

// Web-push setup
const push = require('web-push');
const pushDetails = config.push_details;
push.setVapidDetails(`mailto:${pushDetails.email}`, pushDetails.publicKey, pushDetails.privateKey);

// Authentication middleware
const {authenticateToken, authenticateController} = require(`${root_dir}/src/middleware/auth.js`);

// Applying routes
router.post("/subscribe", authenticateToken, subscribe);
router.post('/alarm', authenticateToken, configureAlarm);
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/authenticate", authenticateToken, authenticateUser);
router.post("/authenticateAdmin", authenticateToken, authenticateAdmin);
router.get("/dashboard", authenticateToken, getAdminDashboardInfo);

// Express Routes

/**
 * @openapi
 *
 * /subscribe:
 *   post:
 *     summary: Subscribes user to push notifications - PWA
 *     description: Subscribes user specified in request to receive notifications from the web server
 *     parameters:
 *       - in: header
 *         name: authorization
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sub
 *             properties:
 *               sub:
 *                 type: object
 *                 required:
 *                   - endpoint
 *                   - keys
 *                 description: The subscription object generated by the web API push manager
 *                 properties:
 *                   endpoint:
 *                     type: string
 *                     description: The generated web endpoint
 *                   expirationTime:
 *                     nullable: true
 *                     type: string
 *                     description: The expiration time for the subscription (DOMHighResTimeStamp or null)
 *                     example: "null"
 *                   keys:
 *                     type: object
 *                     required:
 *                       - p256dh
 *                       - auth
 *                     properties:
 *                       p256dh:
 *                         type: string
 *                         description: The Elliptic curve Diffie-Hellman public key
 *                       auth:
 *                         type: string
 *                         description: The authentication secret described in webpush-encryption-08 standard
 *     responses:
 *       200:
 *         description: User successfully subscribed
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: "Subscription linked to bcsotty successfully"
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
 *                   example: "User not found"
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
 *                   example: "Duplicate endpoint error"
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
 *                   example: "An unexpected error has occurred"
 * */
async function subscribe (req, res) {
    const body = req.body;
    const subscription = body.sub;
    const user = req.user;

    const db_user = await db.user.findOne({ where: {username: user.username } });
    try {
        if (db_user) {
            const sub = await db_user.createSubscription({
                endpoint: subscription.endpoint,
                expirationTime: subscription.expirationTime,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth
            });
            console.log(`Subscription linked to ${user.username} successfully`);
            return res.status(200).send(`Subscription linked to ${user.username} successfully`);
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


/**
 * @openapi
 *
 * /alarm:
 *   post:
 *     summary: Configures existing alarms - PWA
 *     description: Sets up and configures new/existing alarms.
 *     parameters:
 *       - in: header
 *         name: authorization
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               alarmSerial:
 *                 type: string
 *                 description: Serial number of alarm to configure
 *               location:
 *                 type: string
 *                 description: The location of the alarm
 *               username:
 *                 type: string
 *                 description: The username of the active user to assign to alarm.
 *     responses:
 *       200:
 *         description: The alarm was successfully linked
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               description: Success message
 *               example: "Alarm successfully linked"
 *       404:
 *         description: Unable to find alarm or user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: The error that occurred
 *                   example: "Unable to find alarm"
 *       500:
 *         description: Unexpected error occurred
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message
 *                   example: "Unexpected error occurred"
 *
 */
async function configureAlarm (req, res) {
    const body = req.body;
    const serial = body.alarmSerial;
    const location = body.location;
    const username = body.username;

    const alarm = await db.alarm.findOne({ where: { alarmSerial: serial } });
    try {
        if (alarm) {
            alarm.location = location;

            db.user.findOne({ where: {username: username} }).then(user => {
                if (user) {
                    user.setAlarm(alarm)
                        .then( () => {
                            console.log(`Alarm successfully linked to ${username}`);
                            return res.status(200).send('Alarm successfully linked');
                        })
                        .catch(err => {
                            console.error(`Error linking alarm to ${username}: `, err);
                            return res.status(500).send('Error linking alarm');
                        });
                } else {
                    res.status(404).json({ 'error': 'Unable to find user' });
                }
            });
        } else {
            return res.status(404).json({ 'error': 'Unable to find alarm' });
        }
    } catch (err) {
        console.log('Unknown error occurred: ', err);
        return res.status(500).json({ 'error': 'Unexpected error occurred' });
    }
}


/**
 * @openapi
 *
 * /register:
 *   post:
 *     summary: Creates a new User account - PWA
 *     description: Creates a new user account in the database if the username isn't taken.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *               - firstName
 *               - lastName
 *               - email
 *             properties:
 *               username:
 *                 type: string
 *                 description: The username for the user
 *                 example: "bcsotty"
 *               password:
 *                 type: string
 *                 description: The password for the user. Will be encrypted before saved to DB.
 *                 example: "123"
 *               firstName:
 *                 type: string
 *                 description: The users first name
 *                 example: "Brett"
 *               lastName:
 *                 type: string
 *                 description: The users last name
 *                 example: "Csotty"
 *               email:
 *                 type: string
 *                 description: The users email
 *                 example: "bcsotty@umich.edu"
 *     responses:
 *       200:
 *         description: The user was successfully registered
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               description: Success message
 *               example: "User successfully registered"
 *       422:
 *         description: Invalid/missing parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message
 *                   example: "Password doesn't meet validation criteria"
 *       500:
 *         description: Unexpected error occurred
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message
 *                   example: "Unexpected error occurred"
 */
async function registerUser (req, res) {
    const body = req.body;
    const username = body.username;
    const user = await db.user.findOne( { where: {username: username} } );
    try {
        if (!user) {
            const password = body.password;
            bcrypt.hash(password, saltRounds, function(err, hash) {
                if (err) {
                    console.log("Error occurred hashing password");
                    throw err;
                }
                console.log("Creating user");
                const new_user = db.user.create({
                    firstName: body.firstName,
                    lastName: body.lastName,
                    username: body.username,
                    password: hash,
                    email: body.email
                });

                console.log("Successfully created user ", username);
                return res.status(200).send("User created successfully!");
            });
        } else {
            return res.status(422).json({"error": "User already exists"});
        }
    }
    catch (err) {
        console.log("An unexpected error has occurred ", err);
        return res.status(500).json({"error": "An unexpected error occurred"});
    }
}


/**
 * @openapi
 *
 * /login:
 *   post:
 *     summary: Logs a user in - PWA
 *     description: Creates a JWT for the user if the login credentials are successful
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: The username for the user
 *                 example: "bcsotty"
 *               password:
 *                 type: string
 *                 description: The password for the user.
 *                 example: "123"
 *     responses:
 *       200:
 *         description: The user was successfully logged in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: The JWT for the user. (Expires after an hour)
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message
 *                   example: "Invalid username/password"
 *       500:
 *         description: Unexpected error occurred
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message
 *                   example: "Unexpected error occurred"
 */
async function loginUser (req, res) {
    const body = req.body;
    const username = body.username;
    const user = await db.user.findOne( { where: { username: username } });
    try {
        if (!user || ! await bcrypt.compare(body.password, user.password)) {
            return res.status(401).send('Authentication failed');
        }

        const token = jwt.sign({ username: username }, config.jwt_secret, { expiresIn: '1h'});
        return res.status(200).json({ token });
    } catch (err) {
        console.log("An unexpected error has occurred: ", err);
        return res.status(500).json({"error": "An unexpected error has occurred"});
    }
}


/**
 * @openapi
 *
 * /authenticate:
 *   post:
 *     summary: Checks if user has valid JWT.
 *     description: Checks if user has a valid JWT. Uses the JWT in the authorization header
 *     parameters:
 *       - in: header
 *         name: authorization
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: The user has a valid JWT
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               description: Success message
 *               example: bcsotty has a valid JWT
 *       401:
 *         description: Authentication failed - Invalid JWT
 *       422:
 *         description: Unprocessable entity - Missing Headers
 */
async function authenticateUser (req, res) {
    const user = req.user;
    return res.status(200).send(`${user.username} has a valid JWT`);
}


/**
 * @openapi
 *
 * /authenticateAdmin:
 *   post:
 *     summary: Checks if user has valid JWT and is an admin.
 *     description: Checks if user has a valid JWT. Uses the JWT in the authorization header and verifies user is an admin
 *     parameters:
 *       - in: header
 *         name: authorization
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: The user has a valid JWT
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               description: Success message
 *               example: bcsotty has a valid JWT
 *       401:
 *         description: Authentication failed - Invalid JWT or user isn't Admin
 *       422:
 *         description: Unprocessable entity - Missing Headers
 */
async function authenticateAdmin (req, res) {
    const user = req.user;

    const db_user = await db.user.findOne({where: { username: user.username}});
    if (!db_user.admin) {
        return res.status(401); // Not admin
    }
    return res.status(200).send(`${user.username} has a valid JWT and is an admin`);
}


/**
 * @openapi
 *
 * /dashboard:
 *   get:
 *     summary: Returns all information needed to populate the dashboard
 *     parameters:
 *       - in: header
 *         name: authorization
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Data for the admin dashboard
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alarms:
 *                   type: array
 *                 users:
 *                   type: array
 */
async function getAdminDashboardInfo (req, res) {
    // Returns all the information needed for the dashboard.
    const alarms = await db.alarm.findAll();
    const users = await db.alarm.findAll({attributes: ['name']});
    const data = [];

    for (let i = 0; i < alarms.length; i++) {
        if (alarms[i].location === "Unknown") {
            data.push([alarms[i].alarmSerial, alarms[i].location, null]);
        } else {
            const user = await db.user.findOne({where: {id: alarms[i].userId}});
            data.push([alarms[i].alarmSerial, alarms[i].location, user.username]);
        }
    }
    return res.status(200).json({"alarms": data, "users": users});
}


module.exports = router;