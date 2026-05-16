/**
 * 配置类型定义
 * @description 提供完整的配置类型定义，确保类型安全
 */

import { DataSourceOptions } from 'typeorm';

/**
 * 应用基础配置
 */
export interface AppConfig {
  /** 应用名称 */
  name: string;
  /** 服务端口号 */
  port: number;
  /** 运行环境 */
  environment: 'development' | 'test' | 'production';
  /** API 路径前缀 */
  apiPrefix: string;
  /** API 版本号 */
  apiVersion: string;
  /** 是否信任反向代理传入的客户端 IP 头 */
  trustProxy: boolean;
}

/**
 * JWT 配置
 */
export interface JwtConfig {
  secret: string;
  expiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

/**
 * 微信小程序配置
 */
export interface WeappConfig {
  appId?: string;
  appSecret?: string;
}

/**
 * 日志配置
 */
export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  dir: string;
  console: boolean;
}

/**
 * Swagger 配置
 */
export interface SwaggerConfig {
  enable: boolean;
  title: string;
  description: string;
  version: string;
  path: string;
}

/**
 * 跨域配置
 */
export interface CorsConfig {
  origin: string | string[];
  credentials: boolean;
}

/**
 * 限流配置
 */
export interface ThrottleConfig {
  ttl: number;
  limit: number;
}

/**
 * 文件上传配置
 */
export interface FileConfig {
  storage: 'local' | 'oss';
  uploadDir: string;
  baseUrl: string;
  maxSize: number;
  allowedTypes: string[];
  privateLinkTtlSeconds: number;
  ossDirectUploadTtlSeconds: number;

  external: {
    oss: {
      enable: boolean;
      region?: string;
      bucket?: string;
      endpoint?: string;
      accessKeyId?: string;
      accessKeySecret?: string;
      secure: boolean;
      baseUrl?: string;
    };
  };
}

/**
 * 通知配置
 */
export interface NotificationConfig {
  channels: {
    bark: {
      baseUrl?: string;
    };
    feishu: {
      appId?: string;
      appSecret?: string;
    };
  };
}

/**
 * 完整配置接口
 */
export interface Configuration {
  app: AppConfig;
  database: DataSourceOptions;
  jwt: JwtConfig;
  logging: LoggingConfig;
  swagger: SwaggerConfig;
  cors: CorsConfig;
  throttle: ThrottleConfig;
  file: FileConfig;
  notification: NotificationConfig;
  weapp: WeappConfig;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
}

/**
 * 配置工厂函数类型
 */
export type ConfigFactory = () => Configuration;
