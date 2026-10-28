// expo-crypto is a native module and cannot load under plain node. The
// migration only uses randomUUID, which node:crypto provides identically.
const { randomUUID } = require('node:crypto');
exports.randomUUID = randomUUID;
