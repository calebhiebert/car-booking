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
    people: {
        getMe
    }
};

function init(clientId, clientSecret, redirectUrl) {
    CLIENT_ID = clientId;
    CLIENT_SECRET = clientSecret;
    REDIRECT_URL = redirectUrl;

    let oauth2Client = new OAuth2(
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

function getMe(tokens) {
    return new Promise((resolve, reject) => {

        if(tokens === undefined) {
            reject('Tokens missing from getMe request!');
        } else {
            oauth2Client.setCredentials(tokens);

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