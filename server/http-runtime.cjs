// Electron's bundled Undici can throw an uncaught Parser.finish assertion
// when a peer closes a response while its body is paused. Electron then opens
// a synchronous error dialog, blocking every queue timer and API request.
// Install the pinned, patched client and matching web classes before any
// services capture fetch. Do not suppress uncaught exceptions globally.
const { install } = require('undici');
install();
