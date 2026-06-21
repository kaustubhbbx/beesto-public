// middleware/auth.js
// Verifies the Clerk session token from the Authorization: Bearer header.
// Attaches req.clerkUserId (Clerk user ID string) on success.

// Set environment variables cleanly before importing anything else
const PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
const SECRET_KEY      = process.env.CLERK_SECRET_KEY;

if (!PUBLISHABLE_KEY || !SECRET_KEY) {
  console.warn("⚠️ Warning: Clerk Publishable Key or Secret Key is not set in environment variables!");
}

const { verifyToken } = require('@clerk/express');

/**
 * Global application middleware runner
 * Placed in server.js to maintain structure without causing 401 response early blocks
 */
module.exports.installClerkMiddleware = (req, res, next) => {
  next();
};

/**
 * Route-level guard: Decodes and authenticates incoming Bearer JWT tokens manually
 */
module.exports.requireAuth = async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`🔒 [AUTH FAIL] Missing layout bearer token header structure on: ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'Not authenticated — please sign in to Beesto AI' });
    }

    const token = authHeader.split(' ')[1];

    if (!token || token === 'null' || token === 'undefined') {
      console.log(`🔒 [AUTH FAIL] Received blank token parameter payload`);
      return res.status(401).json({ error: 'Invalid authentication format string' });
    }

    // Explicit verification loop — bypasses underlying express route context blinding bugs
    try {
      const decodedPayload = await verifyToken(token, {
        secretKey: SECRET_KEY,
        publishableKey: PUBLISHABLE_KEY,
      });

      const userId = decodedPayload.sub;

      if (!userId) {
        return res.status(401).json({ error: 'Token payload missing valid authority claims' });
      }

      // Securely mount values onto request context stack
      req.clerkUserId = userId;
      return next();

    } catch (verificationError) {
      console.error("❌ [CLERK JWT REJECTION REASON]:", verificationError.message);
      return res.status(401).json({ 
        error: 'Authentication failed', 
        details: verificationError.message 
      });
    }

  } catch (globalRuntimeError) {
    console.error("Critical Authentication Layer Crash:", globalRuntimeError);
    return res.status(500).json({ error: 'Internal validation runner engine error' });
  }
};