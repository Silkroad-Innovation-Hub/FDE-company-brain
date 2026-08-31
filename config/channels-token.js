const { generateServiceToken } = require('@librechat/api');

/**
 * Prints a fresh SILKROAD_SERVICE_TOKEN. Put the same value in the API server's
 * .env and in every connector's .env; rotate by running this again.
 */
console.log(`SILKROAD_SERVICE_TOKEN=${generateServiceToken()}`);
