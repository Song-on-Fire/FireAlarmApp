const jwt = require('jsonwebtoken');
const root_dir = require('app-root-path');
const env = process.env.NODE_ENV || 'development'
const config = require(`${root_dir}/src/config/config.json`)[env];

function authenticateToken (req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader;
    if (!token || authHeader === undefined) return res.sendStatus(422);

    jwt.verify(token, config.jwt_secret, (err, user) => {
        if (err) return res.sendStatus(401); // Invalid token
        req.user = user;
        next();
    });
}

function authenticateController (req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader;
    if (!token || authHeader === undefined) return res.sendStatus(422);

    if (token === config.jwt_secret) {
        next();
    } else {
        return res.sendStatus(401);
    }
}

module.exports = {authenticateToken, authenticateController};