const fs = require('fs');

const locales = [
    {
        lang: 'english',
        file: './dist/locale_en.json'
    },
    {
        lang: 'french',
        file: './dist/locale_fr.json'
    }
];

let dict = {};

module.exports = {
    load() {
        return new Promise((resolve, reject) => {
            try {
                for (locale of locales) {
                    dict[locale.lang] = JSON.parse(fs.readFileSync(locale.file, {encoding: 'utf-8'}));
                }

                resolve(dict);

            } catch (err) {
                switch (err.code) {
                    case 'ENOENT':
                        reject('[There was an error while loading locales. Failed Object: %s]'.replace('%s', err.path));
                        break;
                    default:
                        reject('[Encountered an unknown error while loading locales. Code: %s]'.replace('%s', err.code));
                        break;
                }
            }
        });
    },
    lang(lang) {
        return dict[lang].phrases;
    }
};