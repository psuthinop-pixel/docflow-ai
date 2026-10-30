export const config = {
  port: Number(process.env.PORT ?? 8000),
  dbPath: process.env.DB_PATH ?? 'docflow.db',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),
  ocrEngine: process.env.OCR_ENGINE ?? 'auto', // auto (typhoon → claude → tesseract) | typhoon | tesseract | claude
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
};

if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
