import { PATH_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  it('does not expose a register route', () => {
    const routeMethods = Object.getOwnPropertyNames(AuthController.prototype).filter(
      (name) => name !== 'constructor',
    );

    const paths = routeMethods
      .map((name) => Reflect.getMetadata(PATH_METADATA, AuthController.prototype[name]))
      .filter(Boolean);

    expect(paths).not.toContain('register');
  });

  it('does not duplicate current-user endpoints that belong to users/profile', () => {
    const routeMethods = Object.getOwnPropertyNames(AuthController.prototype).filter(
      (name) => name !== 'constructor',
    );

    const paths = routeMethods
      .map((name) => Reflect.getMetadata(PATH_METADATA, AuthController.prototype[name]))
      .filter(Boolean);

    expect(paths).not.toContain('profile');
    expect(paths).not.toContain('check');
  });

  it('passes the current access-token session id to logout', async () => {
    const authService = {
      logout: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn(),
    };
    const controller = new AuthController(authService as any, configService as any);

    await controller.logout({ id: 1, sessionId: 'access-session' } as any, 'bad-refresh-token');

    expect(authService.logout).toHaveBeenCalledWith(1, 'bad-refresh-token', 'access-session');
  });

  it('exposes WeChat mini-program login and bind routes', () => {
    const routeMethods = Object.getOwnPropertyNames(AuthController.prototype).filter(
      (name) => name !== 'constructor',
    );

    const paths = routeMethods
      .map((name) => Reflect.getMetadata(PATH_METADATA, AuthController.prototype[name]))
      .filter(Boolean);

    expect(paths).toContain('weapp/login');
    expect(paths).toContain('weapp/bind');
  });
});
