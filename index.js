// Server setup
const express = require('express');
const root_dir = require("app-root-path");
const app = express();

// Swagger UI imports
const OpenApiValidator = require('express-openapi-validator')
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require('swagger-ui-express');

// Importing middlewares
const helmet = require('helmet');
const bodyParser = require('body-parser');
const cors = require('cors');
const errorhandler = require('errorhandler');
const morganMiddleware = require(`${root_dir}/src/middleware/logging.js`);

// Environment/Configuration details
const env = process.env.NODE_ENV || 'development'
const path = require('path');
const config = require(`${root_dir}/src/config/config.json`)[env];
const port = config.port;
const options = {
    "definition": {
        "openapi": "3.0.3",
        "info": {
            "title": "Blaze: Your Smart Home Fire Alarm",
            "version": "0.1.0",
            "description": "The web API for the Blaze smart home fire alarm",
            "license": {
                "name": "MIT",
                "url": "https://spdx.org/licenses/MIT.html"
            },
            "contact": {
                "name": "Blaze",
                "url": "",
                "email": "FAASeniorDesign@umich.edu"
            }
        },
        "servers": [
            {
                "url": `http://127.0.0.1:${port}`,
                "description": "PWA"
            },
            {
                "url": `http://127.0.0.1:${port}/api`,
                "description": "API"
            }
        ]
    },
    "apis": ["./src/controllers/*.js"]
};

const openApiSpecification = swaggerJsdoc(options);

// Routes
const pwa = require(`${root_dir}/src/controllers/pwa.controller.js`);
const api = require(`${root_dir}/src/controllers/notifications.controller.js`)

// DB Stuff
const db = require(`${root_dir}/src/models`);

// Applying middlewares.
app.use(helmet());
// Remove below app.use once in production, only use for testing
app.use(
    helmet.contentSecurityPolicy({
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "connect-src": ["'self'", `http://localhost:${port}`]
        }
    })
);

app.use(cors());
app.options('*', cors());

app.use(morganMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
    OpenApiValidator.middleware({
        apiSpec: openApiSpecification,
        validateRequests: true,
        validateResponses: false,
    }),
);

app.use((err, req, res, next) => {
    if (err.status === 400 || err.status === 500) {
        res.status(err.status).json({
            message: err.message,
            errors: err.errors,
        });
    } else {
        next(err);
    }
});

// Applying routes
app.use("/api", api);

app.use(express.static('public'));

app.use("/", pwa);

app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
        message: err.message,
        errors: err.errors
    });
});

if (env === "development")
    app.use(errorhandler());
    // Setting up Swagger Docs
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpecification));

// Initialize DB models and start server
db.sequelize.sync({ force: false }).then(function () {
    app.listen(port, (err) => {
        if (err) {
            throw err;
        }
        /* eslint-disable no-console */
        console.log('Server listening for connections at http://127.0.0.1:' + port);
    });
});
