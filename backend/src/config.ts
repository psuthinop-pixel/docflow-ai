export const config = {
  port: Number(process.env.PORT ?? 8000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://localhost:5432/docflow',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  // Comma-separated; `*` is a wildcard, e.g. https://docflow-*.vercel.app for preview deployments.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
};

if ((process.env.NODE_ENV === 'production' || process.env.VERCEL) && config.jwtSecret === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
