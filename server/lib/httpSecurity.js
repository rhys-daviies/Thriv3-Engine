/**
 * HTTP SECURITY BASELINE — Phase 13K.
 *
 * The headers and the origin policy for a hosted internal tool. Two surfaces
 * live in this one process and they need different answers, which is the whole
 * reason this is a module rather than one `app.use(helmet())`:
 *
 *   THE OPERATOR APP — one origin, cookie-authenticated, no embedding, no
 *   third-party script. It gets a real Content-Security-Policy.
 *
 *   THE PUBLIC ATHLETE PAGES at /p/:slug — generated HTML with an inline
 *   tracker and a YouTube embed, served to coaches who have never signed in to
 *   anything. A policy written for the operator app would break them silently,
 *   and "silently" is the operative word: the August 2026 failure was four
 *   days of dead tracking that nothing reported.
 *
 * So the CSP is applied to the operator app and skipped for /p/. Every other
 * header applies to both, because none of them can break either.
 */
import helmet from 'helmet';
import cors from 'cors';

/** The public athlete pages, which must not get the operator app's CSP. */
const PUBLIC_PAGE = /^\/p(\/|$)/;

export function securityHeaders(config) {
  const base = helmet({
    // Set separately below, per surface.
    contentSecurityPolicy: false,
    /**
     * HSTS only where TLS is real. On http it is either ignored or — worse,
     * on a shared localhost — remembered by the browser and applied to every
     * other project on 127.0.0.1 for the next six months.
     */
    hsts: config.cookieSecure
      ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // Nothing here is meant to be framed, including the athlete pages: an
    // athlete's profile in somebody else's frame is a clickjacking surface and
    // has no legitimate use.
    frameguard: { action: 'deny' },
    crossOriginEmbedderPolicy: false,
    /**
     * `same-origin` would stop the athlete pages loading YouTube's player and
     * a coach's browser from opening them from an email client. The pages are
     * public documents; they are meant to be cross-origin readable.
     */
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  });

  const csp = helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // No inline script and no eval in the operator app: the built bundle is
      // external module files, so this costs nothing and closes the whole
      // class of injection the app could otherwise carry.
      scriptSrc: ["'self'"],
      /**
       * Tailwind's stylesheet is external, but React writes style attributes,
       * which count as inline styles. Unavoidable and low-risk.
       *
       * GOOGLE FONTS, FOUND BY BROWSER QA. `src/index.css` opens with an
       * @import of Space Grotesk and Inter, so a policy of 'self' alone
       * blocked the stylesheet and the app rendered in fallback faces — a
       * silent visual regression with nothing on screen to explain it. Two
       * hosts, both font-only, and no script anywhere in the grant.
       */
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      // College crests are remote https URLs stored per programme, so this
      // cannot be 'self'. Restricted to https so a stored http URL cannot
      // downgrade the page.
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      // Same-origin API only. The operator app talks to nothing else, and if
      // that changes the change should be visible here.
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
    },
  });

  return [
    base,
    (req, res, next) => (PUBLIC_PAGE.test(req.path) ? next() : csp(req, res, next)),
  ];
}

/**
 * CORS, scoped.
 *
 * `cors()` with no arguments — what this app used — reflects every origin,
 * which for a cookie-authenticated API is the difference between "any site
 * can ask your browser for your data" and "none can". Production allows
 * exactly the operator app's own origin and nothing else.
 *
 * NEVER a wildcard with credentials. The browser refuses that combination
 * anyway, and a server that tries it is a server whose author expected
 * credentials to flow.
 *
 * The public event collector is mounted BEFORE this and sets its own headers,
 * because it is deliberately callable from the athlete pages on another
 * origin. It carries no cookies and identifies nobody, so a permissive policy
 * there gives an attacker the ability to post an event they could already post.
 */
export function corsPolicy(config) {
  const allowed = new Set(config.appOrigins);
  return cors({
    credentials: true,
    origin(origin, callback) {
      // No Origin header: a same-origin navigation, curl, or a health check.
      // There is nothing to grant, so there is nothing to refuse.
      if (!origin) return callback(null, true);
      if (allowed.has(origin.replace(/\/$/, ''))) return callback(null, true);
      // Answer without the header rather than with an error: an error here
      // becomes a 500, which reads as a broken server rather than a refused
      // origin.
      return callback(null, false);
    },
  });
}
