/**
 * 配置验证（简化版 - 适合小团队）
 * @description 使用 Joi 验证核心环境变量，确保生产环境安全
 */

import * as Joi from 'joi';
import { DEFAULT_FILE_MAX_SIZE } from './constants';

/**
 * 检查是否为不安全的默认密钥
 */
const isInsecureKey = (value: string): boolean => {
  const keywords = ['dev-', 'change-this', 'your-', 'secret-key', 'default', 'example'];
  return keywords.some((keyword) => value.toLowerCase().includes(keyword));
};

const optionalEmptyString = Joi.string().allow('').optional();

/**
 * 环境变量验证 Schema
 */
export const configValidationSchema = Joi.object({
  // ========================================
  // 应用配置
  // ========================================
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),

  PORT: Joi.number().port().default(3000),

  APP_NAME: Joi.string().default('home-admin'),

  API_PREFIX: Joi.string().default('api'),

  API_VERSION: Joi.string().default('1'),

  TRUST_PROXY: Joi.boolean().default(false),

  // ========================================
  // 数据库配置
  // ========================================
  DB_HOST: Joi.string().default('localhost'),

  DB_PORT: Joi.number().port().default(3306),

  DB_USERNAME: Joi.string().default('root'),

  DB_PASSWORD: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(8).required().messages({
      'string.min': '⚠️  DB_PASSWORD 在生产环境必须至少8个字符',
      'any.required': '⚠️  DB_PASSWORD 在生产环境是必需的',
    }),
    otherwise: Joi.string().allow('').default(''),
  }),

  DB_DATABASE: Joi.string().default('home'),

  DB_LOGGING: Joi.boolean().default(false),

  DB_DROP_SCHEMA: Joi.boolean().default(false),

  DB_CONNECTION_LIMIT: Joi.number().min(1).max(100).default(10),

  DB_CONNECTION_TIMEOUT: Joi.number().default(60000),

  // ========================================
  // JWT 配置（核心安全检查）
  // ========================================
  JWT_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .min(32)
      .required()
      .custom((value, helpers) => {
        if (isInsecureKey(value)) {
          return helpers.error('jwt.insecure');
        }
        return value;
      })
      .messages({
        'string.min': '⚠️  JWT_SECRET 在生产环境必须至少32个字符',
        'any.required': '⚠️  JWT_SECRET 在生产环境是必需的',
        'jwt.insecure':
          '⚠️  JWT_SECRET 使用了不安全的默认值，请使用强密钥（如 openssl rand -base64 32）',
      }),
    otherwise: Joi.string().min(8).default('dev-secret-key-change-this'),
  }),

  JWT_EXPIRES_IN: Joi.string().default('7d'),

  JWT_REFRESH_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .min(32)
      .required()
      .custom((value, helpers) => {
        if (isInsecureKey(value)) {
          return helpers.error('jwt.refresh.insecure');
        }
        // 检查是否与 JWT_SECRET 相同
        const jwtSecret = process.env.JWT_SECRET;
        if (jwtSecret && value === jwtSecret) {
          return helpers.error('jwt.refresh.duplicate');
        }
        return value;
      })
      .messages({
        'string.min': '⚠️  JWT_REFRESH_SECRET 在生产环境必须至少32个字符',
        'any.required': '⚠️  JWT_REFRESH_SECRET 在生产环境是必需的',
        'jwt.refresh.insecure': '⚠️  JWT_REFRESH_SECRET 使用了不安全的默认值，请使用强密钥',
        'jwt.refresh.duplicate': '⚠️  JWT_REFRESH_SECRET 不能与 JWT_SECRET 相同',
      }),
    otherwise: Joi.string().min(8).default('dev-refresh-secret-change-this'),
  }),

  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  // ========================================
  // 微信小程序配置（可选，未配置时相关接口不可用）
  // ========================================
  WEAPP_APP_ID: optionalEmptyString,
  WEAPP_APP_SECRET: optionalEmptyString,

  // ========================================
  // 日志配置
  // ========================================
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').default('debug'),

  LOG_DIR: Joi.string().default('./logs'),

  LOG_CONSOLE: Joi.boolean().default(true),

  // ========================================
  // Swagger 配置
  // ========================================
  SWAGGER_ENABLE: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(false).messages({
      'any.only': '⚠️  生产环境必须关闭 Swagger 文档（设置 SWAGGER_ENABLE=false）',
    }),
    otherwise: Joi.boolean().default(true),
  }),

  SWAGGER_TITLE: Joi.string().default('Home Admin API'),

  SWAGGER_DESCRIPTION: Joi.string().default('Home Admin API Documentation'),

  SWAGGER_VERSION: Joi.string().default('1.0.0'),

  SWAGGER_PATH: Joi.string().default('api-docs'),

  // ========================================
  // CORS 配置
  // ========================================
  CORS_ORIGIN: Joi.string().default('*'),

  CORS_CREDENTIALS: Joi.boolean().default(false),

  // ========================================
  // 限流配置
  // ========================================
  THROTTLE_TTL: Joi.number().min(1).default(60),

  THROTTLE_LIMIT: Joi.number().min(1).default(100),

  // ========================================
  // 文件配置（简化版 - 只保留核心配置）
  // ========================================
  FILE_STORAGE: Joi.string().valid('local', 'oss').default('local'),

  FILE_UPLOAD_DIR: Joi.string().default('uploads'),

  FILE_BASE_URL: Joi.string().default('/api/v1/files'),

  FILE_MAX_SIZE: Joi.number().min(1024).default(DEFAULT_FILE_MAX_SIZE), // 50MB

  FILE_ALLOWED_TYPES: Joi.string().default(
    '.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.mp4,.mov,.webm,.mkv,.avi,.wmv,.pdf,.doc,.docx,.ppt,.pptx,.txt,.zip',
  ),

  FILE_PRIVATE_LINK_TTL_SECONDS: Joi.number().min(60).default(86400),
  FILE_OSS_DIRECT_UPLOAD_TTL_SECONDS: Joi.number().min(60).max(3600).default(900),

  // OSS 配置（可选）
  FILE_OSS_ENABLE: Joi.boolean().default(false),
  FILE_OSS_REGION: optionalEmptyString,
  FILE_OSS_BUCKET: optionalEmptyString,
  FILE_OSS_ENDPOINT: optionalEmptyString,
  FILE_OSS_ACCESS_KEY_ID: optionalEmptyString,
  FILE_OSS_ACCESS_KEY_SECRET: optionalEmptyString,
  FILE_OSS_SECURE: Joi.boolean().default(true),
  FILE_OSS_BASE_URL: optionalEmptyString,

  // ========================================
  // 通知配置（简化）
  // ========================================
  NOTIFY_BARK_BASE_URL: optionalEmptyString,

  NOTIFY_FEISHU_APP_ID: optionalEmptyString,
  NOTIFY_FEISHU_APP_SECRET: optionalEmptyString,
});
