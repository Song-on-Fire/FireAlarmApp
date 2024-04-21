module.exports = (sequelize, Sequelize) => {
    const User = sequelize.define("user", {
        firstName: {
            type: Sequelize.STRING,
            allowNull: false
        },
        lastName: {
            type: Sequelize.STRING,
            allowNull: false
        },
        password: {
            type: Sequelize.STRING,
            allowNull: false
        },
        username: {
            type: Sequelize.STRING,
            allowNull: false
        },
        admin: {
            type: Sequelize.BOOLEAN,
            defaultValue: false
        },
        email: {
            type: Sequelize.STRING,
            allowNull: false
        }
    });
    User.associate = function (models) {
        User.hasMany(models.subscription);
        User.hasOne(models.alarm);
    };
    return User;
};
