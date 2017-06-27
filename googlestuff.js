const google = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const people = google.people('v1');
const calendar = google.calendar('v3');

let CLIENT_ID;
let CLIENT_SECRET;
let REDIRECT_URL;
let oauth2Client;

module.exports = {
    init,
    oauth2Client,
    genAuthUrl,
    getToken,
    people: {
        getMe
    },
    calendar: {
        deleteCalendarEvent,
        getCalendarEvent,
        createCalendarEvent
    }
};

function init(clientId, clientSecret, redirectUrl) {
    CLIENT_ID = clientId;
    CLIENT_SECRET = clientSecret;
    REDIRECT_URL = redirectUrl;

    oauth2Client = new OAuth2(
        CLIENT_ID, CLIENT_SECRET, REDIRECT_URL
    );

    google.options({
        auth: oauth2Client
    });

    return this;
}

function genAuthUrl() {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/user.emails.read',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/calendar'
        ]
    });
}

function getToken(code) {
    return new Promise((resolve, reject) => {
        oauth2Client.getToken(code, (err, tokens) => {
            if(err)
                reject(err);
            else
                resolve(tokens);
        });
    });
}

function getMe(token) {
    return new Promise((resolve, reject) => {
        if(token === undefined) {
            reject('Token missing from getMe request!');
        } else {
            oauth2Client.setCredentials(token);

            people.people.get({
                resourceName: 'people/me', personFields: 'names,emailAddresses'
            }, (err, person) => {
                if (err)
                    reject(err);
                else
                    resolve(person);
            });
        }
    });
}

function createCalendarEvent(options, token) {
    return new Promise((resolve, reject) => {
        if(token === undefined) {
            reject('Token missing from calendar create request!');
        } else {
            oauth2Client.setCredentials(token);

            calendar.events.insert(options, (err, result) => {
                if(err)
                    reject(err);
                else
                    resolve(result);
            });
        }
    })
}

function deleteCalendarEvent(options, token) {
    return new Promise((resolve, reject) => {
        if(token === undefined) {
            reject('Token missing from calendar delete request!');
        } else {
            oauth2Client.setCredentials(token);

            calendar.events.delete(options, (err, result) => {
                if(err)
                    reject(err);
                else
                    resolve(result);
            });
        }
    });
}

function getCalendarEvent(options, token) {
    return new Promise((resolve, reject) => {
        if(token === undefined) {
            reject('Token missing from calendar get request!');
        } else {
            oauth2Client.setCredentials(token);

            calendar.events.get(options, (err, results) => {
                if(err)
                    reject(err);
                else
                    resolve(results);
            });
        }
    })
}