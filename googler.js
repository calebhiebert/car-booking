const google = require('googleapis');
const OAuth2 = google.auth.OAuth2;

let oauth2Client = new OAuth2(
    '801316837381-7d1vd6bi6v3c2do02tdqlis0i5b7dsdi.apps.googleusercontent.com',
    'IgJsH0JuizQLXxrrTQEWGU0x',
    'http://localhost'
);

module.exports = {
    getTokens(code, callback) {
        oauth2Client.getToken(code, (err, tokens) => {
            callback(err, tokens);
        })
    },
    oauth2Client
};

