import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSourceOptions } from 'typeorm';
import type { Configuration } from './config.types';
import { DEFAULT_FILE_MAX_SIZE } from './constants';

function parseCorsOrigin(origin?: string): string | string[] {
  const raw = origin?.trim();
  if (!raw) {
    return '*';
  }

  const origins = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return '*';
  }

  return origins.length === 1 ? origins[0] : origins;
}

function resolveMigrationFiles(): string[] {
  const migrationsDir = join(__dirname, '..', 'migrations');

  return readdirSync(migrationsDir)
    .filter((file) => /\.(ts|js)$/.test(file))
    .filter((file) => !/\.spec\.(ts|js)$/.test(file))
    .filter((file) => !/\.d\.ts$/.test(file))
    .sort()
    .map((file) => join(migrationsDir, file));
}

/**
 * 获取数据库配置
 * @description 统一的数据库配置，供 NestJS 和 TypeORM CLI 使用
 */
export function getDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DataSourceOptions {
  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';

  return {
    type: 'mysql',
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || '3306', 10),
    username: env.DB_USERNAME || 'root',
    // 生产环境必须提供密码，开发环境允许空密码
    password: isProduction
      ? env.DB_PASSWORD! // 生产环境必须提供，由验证层保证
      : env.DB_PASSWORD || '',
    database: env.DB_DATABASE || 'home',

    // 实体和迁移路径配置
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: resolveMigrationFiles(),
    migrationsTableName: 'migrations',

    // 同步配置：所有环境都禁用，使用migration管理数据库结构
    synchronize: false,

    // 测试环境特殊配置
    dropSchema: isTest && env.DB_DROP_SCHEMA === 'true',

    // 日志配置：生产环境根据配置，其他环境默认启用
    logging: isProduction ? env.DB_LOGGING === 'true' : env.DB_LOGGING !== 'false',

    // MySQL 特定配置
    timezone: '+08:00',
    charset: 'utf8mb4',

    // 额外配置
    extra: {
      charset: 'utf8mb4_unicode_ci',
      // 连接池配置
      connectionLimit: parseInt(env.DB_CONNECTION_LIMIT || '10', 10),
      // 连接超时（毫秒）
      connectTimeout: parseInt(env.DB_CONNECTION_TIMEOUT || '60000', 10),
    },
  };
}

/**
 * 应用配置
 * @description 所有配置项的中央管理，支持环境变量覆盖默认值
 * @note 布尔值统一使用 === 'true' 判断，默认为 false
 */
export const configuration = (): Configuration => ({
  /**
   * 应用基础配置
   */
  app: {
    /** 应用名称 */
    name: process.env.APP_NAME || 'home-admin',
    /** 服务端口号 */
    port: parseInt(process.env.PORT || '3000', 10),
    /** 运行环境：development | test | production */
    environment: (process.env.NODE_ENV as 'development' | 'test' | 'production') || 'development',
    /** API 路径前缀，如 /api */
    apiPrefix: process.env.API_PREFIX || 'api',
    /** API 版本号 */
    apiVersion: process.env.API_VERSION || '1',
    /** 是否信任反向代理传入的客户端 IP 头 */
    trustProxy: process.env.TRUST_PROXY === 'true',
  },

  /**
   * 数据库配置
   * @see database.config.ts 统一的数据库配置管理
   */
  database: getDatabaseConfig(process.env),

  /**
   * JWT 认证配置
   */
  jwt: {
    /** JWT 签名密钥（生产环境必须设置，开发环境使用默认值） */
    secret:
      process.env.NODE_ENV === 'production'
        ? process.env.JWT_SECRET! // 生产环境必须提供，由验证层保证
        : process.env.JWT_SECRET || 'dev-secret-key-change-this',
    /** 访问令牌过期时间（支持 ms 格式，如 7d, 24h） */
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    /** 刷新令牌密钥（生产环境必须设置） */
    refreshSecret:
      process.env.NODE_ENV === 'production'
        ? process.env.JWT_REFRESH_SECRET! // 生产环境必须提供，由验证层保证
        : process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-this',
    /** 刷新令牌过期时间 */
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  /**
   * 微信小程序配置
   */
  weapp: {
    appId: process.env.WEAPP_APP_ID,
    appSecret: process.env.WEAPP_APP_SECRET,
  },

  /**
   * 日志配置
   */
  logging: {
    /** 日志级别：debug | info | warn | error */
    level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'debug',
    /** 日志文件存储目录 */
    dir: process.env.LOG_DIR || './logs',
    /** 是否输出到控制台（生产默认开启，测试可关闭以减少噪音） */
    console: process.env.LOG_CONSOLE === undefined ? true : process.env.LOG_CONSOLE === 'true',
  },

  /**
   * Swagger 文档配置
   */
  swagger: {
    /** 是否启用 Swagger（开发/测试默认开启，生产默认关闭） */
    enable:
      process.env.SWAGGER_ENABLE === undefined
        ? process.env.NODE_ENV !== 'production'
        : process.env.SWAGGER_ENABLE === 'true',
    /** 文档标题 */
    title: process.env.SWAGGER_TITLE || 'Home Admin API',
    /** 文档描述 */
    description: process.env.SWAGGER_DESCRIPTION || 'Home Admin API Documentation',
    /** API 版本号 */
    version: process.env.SWAGGER_VERSION || '1.0.0',
    /** 文档访问路径 */
    path: process.env.SWAGGER_PATH || 'api-docs',
  },

  /**
   * 跨域配置
   */
  cors: {
    /** 允许的来源（* 表示所有，生产环境应指定具体域名） */
    origin: parseCorsOrigin(process.env.CORS_ORIGIN),
    /** 是否发送 Cookie（默认 false） */
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },

  /**
   * 限流配置
   */
  throttle: {
    /** 时间窗口（秒） */
    ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
    /** 时间窗口内最大请求数 */
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },

  /**
   * 文件上传配置
   */
  file: {
    /** 存储方式：local（本地） | oss（阿里云） */
    storage: (process.env.FILE_STORAGE as 'local' | 'oss') || 'local',
    /** 上传文件保存目录 */
    uploadDir: process.env.FILE_UPLOAD_DIR || 'uploads',
    /** 本地公开文件下载基础 URL */
    baseUrl: process.env.FILE_BASE_URL || '/api/v1/files',
    /** 最大文件大小（字节），默认 50MB */
    maxSize: parseInt(process.env.FILE_MAX_SIZE || `${DEFAULT_FILE_MAX_SIZE}`, 10),
    /** 允许的文件类型（扩展名列表） */
    allowedTypes: (
      process.env.FILE_ALLOWED_TYPES ||
      '.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.mp4,.mov,.webm,.mkv,.avi,.wmv,.pdf,.doc,.docx,.ppt,.pptx,.txt,.zip'
    )
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    /** 私有文件访问链接有效期（秒），默认 24 小时 */
    privateLinkTtlSeconds: parseInt(process.env.FILE_PRIVATE_LINK_TTL_SECONDS || '86400', 10),
    /** OSS 浏览器直传签名有效期（秒），默认 15 分钟 */
    ossDirectUploadTtlSeconds: parseInt(
      process.env.FILE_OSS_DIRECT_UPLOAD_TTL_SECONDS || '900',
      10,
    ),

    /**
     * 外部存储服务配置
     */
    external: {
      /**
       * 阿里云 OSS 配置
       */
      oss: {
        /** 是否启用（默认 false） */
        enable: process.env.FILE_OSS_ENABLE === 'true',
        /** OSS 区域 */
        region: process.env.FILE_OSS_REGION,
        /** 存储桶名称 */
        bucket: process.env.FILE_OSS_BUCKET,
        /** OSS 端点 */
        endpoint: process.env.FILE_OSS_ENDPOINT,
        /** 访问密钥 ID */
        accessKeyId: process.env.FILE_OSS_ACCESS_KEY_ID,
        /** 访问密钥 */
        accessKeySecret: process.env.FILE_OSS_ACCESS_KEY_SECRET,
        /** 是否使用 HTTPS（默认 true） */
        secure:
          process.env.FILE_OSS_SECURE === undefined ? true : process.env.FILE_OSS_SECURE === 'true',
        /** CDN 或自定义域名 */
        baseUrl: process.env.FILE_OSS_BASE_URL,
      },
    },
  },

  /**
   * 通知配置
   */
  notification: {
    /**
     * 通知渠道配置
     */
    channels: {
      /**
       * Bark 推送（iOS 推送通知）
       */
      bark: {
        /** Bark 服务地址 */
        baseUrl: process.env.NOTIFY_BARK_BASE_URL,
      },

      /**
       * 飞书应用机器人通知
       */
      feishu: {
        /** 飞书应用 App ID */
        appId: process.env.NOTIFY_FEISHU_APP_ID,
        /** 飞书应用 App Secret */
        appSecret: process.env.NOTIFY_FEISHU_APP_SECRET,
      },
    },
  },

  /** 是否为开发环境 */
  isDevelopment: process.env.NODE_ENV === 'development',
  /** 是否为生产环境 */
  isProduction: process.env.NODE_ENV === 'production',
  /** 是否为测试环境 */
  isTest: process.env.NODE_ENV === 'test',
});
