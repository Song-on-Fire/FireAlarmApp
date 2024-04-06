'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const root_dir_module = require('app-root-path');
const root_dir = root_dir_module.toString();
const sqlite3 = require('sqlite3');


const basename = 'index.js';
const env = process.env.NODE_ENV || 'development';
const config_path = path.join(root_dir, 'src', 'config', 'config.json').toString()
const config = require(config_path)[env];
const db = {};
let sequelize;

if (config.use_env_variable) {
    sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
    const db_info = config.database;

    const dbPath = path.join(root_dir, db_info.dbFile);
    if (!fs.existsSync(dbPath)) {
        console.log(`DB not found at ${dbPath}. Creating database.`)
        new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err)
                console.error('Failed to create db with error:', err);
        });
    }
    sequelize = new Sequelize({ dialect: 'sqlite', storage: db_info.dbFile });
}
fs
    .readdirSync(path.join(root_dir, "src", "models"))
    .filter(file => {
        return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js');
    })
    .forEach(file => {
        const model_func = require(path.join(root_dir, "src", "models", file))
        const model = model_func(sequelize, Sequelize.DataTypes);
        db[model.name] = model;
    });

Object.keys(db).forEach(modelName => {
    if (db[modelName].associate) {
        db[modelName].associate(db);
    }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

if (env === "development")
    // Loading test data for demo purposes
    var _ = insertTestData();


async function insertTestData() {
    await sequelize.sync({ force: false });
    const users = await db.user.findAll()
    if (users.length === 0) {
        // TODO Update to insert via method instead so that passwords are bcrypted so we can actually login
        db.user.create({ firstName: 'Brett', lastName: 'Csotty', username: 'bcsotty', password: '123', email: 'bcsotty@umich.edu', admin: true });
        db.alarm.create({ alarmSerial: '1', location: 'Unknown'});
    }
}

module.exports = db;