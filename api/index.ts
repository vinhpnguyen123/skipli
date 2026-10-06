// Vercel serverless entry: /api/* and /socket.io/* are rewritten here (see vercel.json).
// ponytail: REST only for now — Socket.IO on Vercel Functions is verified when phase 4 deploys.
import { createApp } from '../server/src/app.js';

export default createApp();
